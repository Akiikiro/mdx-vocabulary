import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { PrismaClient } from '@prisma/client';
import type { DictionaryResourceService } from './dictionary-resource-service.js';
import { normalizeLogicalResourcePath } from './logical-resource-path.js';

const TRANSCODE_VERSION = 'speex-to-mp3-v1';
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 10_000;

export type PronunciationAudioFailureCode =
  | 'INVALID_PRONUNCIATION_AUDIO'
  | 'PRONUNCIATION_TRANSCODER_UNAVAILABLE'
  | 'PRONUNCIATION_TRANSCODE_FAILED';

export class PronunciationAudioError extends Error {
  constructor(readonly code: PronunciationAudioFailureCode, message: string) {
    super(message);
  }
}

export interface PronunciationAudio {
  bytes: Buffer;
  contentType: 'audio/mpeg';
  cacheHit: boolean;
}

export interface PronunciationTranscoder {
  transcode(source: Buffer, outputPath: string): Promise<void>;
}

export class FfmpegPronunciationTranscoder implements PronunciationTranscoder {
  constructor(
    private readonly executable = process.env.FFMPEG_PATH ?? 'ffmpeg',
    private readonly timeoutMs = FFMPEG_TIMEOUT_MS,
  ) {}

  async transcode(source: Buffer, outputPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.executable, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'ogg', '-i', 'pipe:0',
        '-vn', '-ac', '1', '-t', '30', '-codec:a', 'libmp3lame', '-b:a', '48k',
        '-fs', String(MAX_OUTPUT_BYTES), '-f', 'mp3', '-y', outputPath,
      ], { shell: false, stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new PronunciationAudioError('PRONUNCIATION_TRANSCODE_FAILED', 'Pronunciation transcoding timed out'));
      }, this.timeoutMs);
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 16_384) stderr += chunk.toString('utf8', 0, 16_384 - stderr.length);
      });
      child.once('error', (error: NodeJS.ErrnoException) => {
        finish(new PronunciationAudioError(
          error.code === 'ENOENT' ? 'PRONUNCIATION_TRANSCODER_UNAVAILABLE' : 'PRONUNCIATION_TRANSCODE_FAILED',
          error.code === 'ENOENT' ? 'Pronunciation transcoder is unavailable' : 'Pronunciation transcoder could not start',
        ));
      });
      child.once('close', (code) => {
        if (code === 0) finish();
        else finish(new PronunciationAudioError(
          /unknown encoder|encoder.*not found/iu.test(stderr)
            ? 'PRONUNCIATION_TRANSCODER_UNAVAILABLE'
            : 'PRONUNCIATION_TRANSCODE_FAILED',
          'Pronunciation transcoding failed',
        ));
      });
      child.stdin.on('error', () => {});
      child.stdin.end(source);
    });
  }
}

export class PronunciationAudioService {
  private readonly pending = new Map<string, Promise<PronunciationAudio>>();

  constructor(
    private readonly database: PrismaClient,
    private readonly resources: DictionaryResourceService,
    private readonly cacheDirectory: string,
    private readonly transcoder: PronunciationTranscoder = new FfmpegPronunciationTranscoder(),
  ) {}

  async getAudio(dictionaryId: string, logicalResourcePath: string): Promise<PronunciationAudio | null> {
    normalizeLogicalResourcePath(logicalResourcePath);
    if (path.posix.extname(logicalResourcePath).toLowerCase() !== '.spx') {
      throw new PronunciationAudioError('INVALID_PRONUNCIATION_AUDIO', 'Resource is not a supported pronunciation audio file');
    }
    const dictionary = await this.database.dictionary.findUnique({
      where: { id: dictionaryId }, select: { fileChecksum: true },
    });
    if (!dictionary) return null;
    if (!dictionary.fileChecksum) {
      throw new PronunciationAudioError('INVALID_PRONUNCIATION_AUDIO', 'Dictionary package identity is unavailable');
    }
    const resource = await this.resources.getResource(dictionaryId, logicalResourcePath);
    if (!resource) return null;
    if (!isOggSpeex(resource.bytes) || resource.bytes.length > MAX_SOURCE_BYTES) {
      throw new PronunciationAudioError('INVALID_PRONUNCIATION_AUDIO', 'Resource is not valid Ogg/Speex pronunciation audio');
    }

    const contentHash = crypto.createHash('sha256').update(resource.bytes).digest('hex');
    const cacheKey = crypto.createHash('sha256').update(JSON.stringify({
      dictionaryChecksum: dictionary.fileChecksum,
      logicalResourcePath,
      contentHash,
      output: 'mp3-mono-48k',
      version: TRANSCODE_VERSION,
    })).digest('hex');
    const cached = await this.readCache(cacheKey);
    if (cached) return { bytes: cached, contentType: 'audio/mpeg', cacheHit: true };

    const active = this.pending.get(cacheKey);
    if (active) return active;
    const conversion = this.transcodeAndCache(cacheKey, resource.bytes).finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, conversion);
    return conversion;
  }

  private cachePath(cacheKey: string): string {
    return path.join(this.cacheDirectory, cacheKey.slice(0, 2), `${cacheKey}.mp3`);
  }

  private async readCache(cacheKey: string): Promise<Buffer | null> {
    try {
      const bytes = await fsp.readFile(this.cachePath(cacheKey));
      if (bytes.length > MAX_OUTPUT_BYTES || !isMp3(bytes)) return null;
      return bytes;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null;
      throw error;
    }
  }

  private async transcodeAndCache(cacheKey: string, source: Buffer): Promise<PronunciationAudio> {
    const destination = this.cachePath(cacheKey);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const temporary = path.join(path.dirname(destination), `.${cacheKey}.${crypto.randomUUID()}.tmp`);
    try {
      await this.transcoder.transcode(source, temporary);
      const stat = await fsp.stat(temporary);
      if (stat.size === 0 || stat.size > MAX_OUTPUT_BYTES) {
        throw new PronunciationAudioError('PRONUNCIATION_TRANSCODE_FAILED', 'Pronunciation transcoder produced invalid output');
      }
      await fsp.rename(temporary, destination);
      const bytes = await fsp.readFile(destination);
      if (!isMp3(bytes)) {
        await fsp.rm(destination, { force: true });
        throw new PronunciationAudioError('PRONUNCIATION_TRANSCODE_FAILED', 'Pronunciation transcoder produced invalid output');
      }
      return { bytes, contentType: 'audio/mpeg', cacheHit: false };
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
  }
}

function isOggSpeex(bytes: Buffer): boolean {
  if (bytes.length < 36 || !bytes.subarray(0, 4).equals(Buffer.from('OggS')) || bytes[4] !== 0) return false;
  const firstPacketOffset = 27 + bytes[26];
  return firstPacketOffset + 8 <= bytes.length
    && bytes.subarray(firstPacketOffset, firstPacketOffset + 8).equals(Buffer.from('Speex   '));
}

function isMp3(bytes: Buffer): boolean {
  return bytes.length >= 3 && (
    bytes.subarray(0, 3).equals(Buffer.from('ID3'))
    || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
