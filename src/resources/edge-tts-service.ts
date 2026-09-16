import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const CACHE_VERSION = 'edge-tts-mp3-v3';
const MAX_WORD_LENGTH = 100;
export const MAX_TTS_TEXT_LENGTH = 2_000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_TTS_PITCH = '+0Hz';
const DEFAULT_TTS_VOLUME = 100;
export const MIN_TTS_RATE = 0.5;
export const MAX_TTS_RATE = 2;

export type EdgeTtsVoice = 'female' | 'male';

const EDGE_TTS_VOICES: Record<EdgeTtsVoice, string> = {
  female: 'en-US-AvaNeural',
  male: 'en-US-BrianNeural',
};

export class EdgeTtsError extends Error {
  constructor(readonly code: 'INVALID_EDGE_TTS_REQUEST' | 'EDGE_TTS_UNAVAILABLE', message: string) {
    super(message);
  }
}

export interface EdgeTtsAudio {
  bytes: Buffer;
  contentType: 'audio/mpeg';
  voice: string | null;
  cacheHit: boolean;
}

export interface EdgeTtsProvider {
  synthesize(text: string, voice: string, rate: number): Promise<Buffer>;
}

export class MsEdgeTtsProvider implements EdgeTtsProvider {
  async synthesize(text: string, voice: string, rate: number): Promise<Buffer> {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(escapeXml(text), {
        rate, pitch: DEFAULT_TTS_PITCH, volume: DEFAULT_TTS_VOLUME,
      });
      return await collectAudio(audioStream, tts, REQUEST_TIMEOUT_MS);
    } catch (error) {
      throw asUnavailable(error);
    } finally {
      tts.close();
    }
  }
}

export class EdgeTtsService {
  private readonly pending = new Map<string, Promise<EdgeTtsAudio>>();

  constructor(
    private readonly cacheDirectory: string,
    private readonly provider: EdgeTtsProvider = new MsEdgeTtsProvider(),
  ) {}

  async getAudio(inputWord: string, voiceSelection: EdgeTtsVoice): Promise<EdgeTtsAudio> {
    const word = inputWord.trim().normalize('NFC');
    if (!word || Array.from(word).length > MAX_WORD_LENGTH || /[\u0000-\u001f\u007f]/u.test(word)) {
      throw new EdgeTtsError('INVALID_EDGE_TTS_REQUEST', 'word must contain 1 to 100 safe characters');
    }
    return this.getTextAudio(word, voiceSelection, 1);
  }

  async getTextAudio(inputText: string, voiceSelection: EdgeTtsVoice, rate: number): Promise<EdgeTtsAudio> {
    const text = validateText(inputText);
    if (voiceSelection !== 'female' && voiceSelection !== 'male') {
      throw new EdgeTtsError('INVALID_EDGE_TTS_REQUEST', 'voice must be female or male');
    }
    if (!Number.isFinite(rate) || rate < MIN_TTS_RATE || rate > MAX_TTS_RATE) {
      throw new EdgeTtsError('INVALID_EDGE_TTS_REQUEST', `rate must be between ${MIN_TTS_RATE} and ${MAX_TTS_RATE}`);
    }
    const voice = EDGE_TTS_VOICES[voiceSelection];
    const cacheKey = crypto.createHash('sha256').update(JSON.stringify({
      text,
      voice,
      rate,
      pitch: DEFAULT_TTS_PITCH,
      volume: DEFAULT_TTS_VOLUME,
      output: OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      version: CACHE_VERSION,
    })).digest('hex');
    const cached = await this.readCache(cacheKey);
    if (cached) return { bytes: cached, contentType: 'audio/mpeg', voice: null, cacheHit: true };

    const active = this.pending.get(cacheKey);
    if (active) return active;
    const synthesis = this.synthesizeAndCache(cacheKey, text, voice, rate).finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, synthesis);
    return synthesis;
  }

  private cachePath(cacheKey: string): string {
    return path.join(this.cacheDirectory, cacheKey.slice(0, 2), `${cacheKey}.mp3`);
  }

  private async readCache(cacheKey: string): Promise<Buffer | null> {
    try {
      const bytes = await fsp.readFile(this.cachePath(cacheKey));
      return isMp3(bytes) && bytes.length <= MAX_AUDIO_BYTES ? bytes : null;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null;
      throw error;
    }
  }

  private async synthesizeAndCache(cacheKey: string, text: string, voice: string, rate: number): Promise<EdgeTtsAudio> {
    let bytes: Buffer;
    try {
      bytes = await this.provider.synthesize(text, voice, rate);
    } catch (error) {
      throw asUnavailable(error);
    }
    if (!isMp3(bytes) || bytes.length > MAX_AUDIO_BYTES) {
      throw new EdgeTtsError('EDGE_TTS_UNAVAILABLE', 'Edge TTS returned invalid audio');
    }
    const destination = this.cachePath(cacheKey);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const temporary = path.join(path.dirname(destination), `.${cacheKey}.${crypto.randomUUID()}.tmp`);
    try {
      await fsp.writeFile(temporary, bytes, { flag: 'wx' });
      await fsp.rename(temporary, destination);
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
    return { bytes, contentType: 'audio/mpeg', voice, cacheHit: false };
  }
}

function validateText(input: string): string {
  const text = input.trim().normalize('NFC');
  if (!text || Array.from(text).length > MAX_TTS_TEXT_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new EdgeTtsError('INVALID_EDGE_TTS_REQUEST', `text must contain 1 to ${MAX_TTS_TEXT_LENGTH} safe characters`);
  }
  return text;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

async function collectAudio(stream: NodeJS.ReadableStream, tts: MsEdgeTTS, timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => {
      tts.close();
      finish(new EdgeTtsError('EDGE_TTS_UNAVAILABLE', 'Edge TTS request timed out'));
    }, timeoutMs);
    stream.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_AUDIO_BYTES) {
        tts.close();
        finish(new EdgeTtsError('EDGE_TTS_UNAVAILABLE', 'Edge TTS audio exceeds the size limit'));
        return;
      }
      chunks.push(bytes);
    });
    stream.once('end', () => finish());
    stream.once('error', () => finish(new EdgeTtsError('EDGE_TTS_UNAVAILABLE', 'Edge TTS stream failed')));
  });
}

function isMp3(bytes: Buffer): boolean {
  return bytes.length >= 3 && (
    bytes.subarray(0, 3).equals(Buffer.from('ID3'))
    || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
}

function asUnavailable(error: unknown): EdgeTtsError {
  return error instanceof EdgeTtsError
    ? error
    : new EdgeTtsError('EDGE_TTS_UNAVAILABLE', 'Edge TTS is unavailable');
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
