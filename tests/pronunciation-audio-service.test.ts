import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictionaryResourceService } from '../src/resources/dictionary-resource-service.js';
import {
  FfmpegPronunciationTranscoder,
  PronunciationAudioError,
  PronunciationAudioService,
  type PronunciationTranscoder,
} from '../src/resources/pronunciation-audio-service.js';

function speexBytes(): Buffer {
  const bytes = Buffer.alloc(100);
  bytes.write('OggS', 0);
  bytes[26] = 1;
  bytes.write('Speex   ', 28);
  return bytes;
}

describe('PronunciationAudioService', () => {
  let root: string;
  const dictionaryId = '11111111-1111-4111-8111-111111111111';
  const database = { dictionary: { findUnique: vi.fn(async () => ({ fileChecksum: 'package-sha256' })) } } as unknown as PrismaClient;
  const getResource = vi.fn(async () => ({ bytes: speexBytes(), contentType: 'audio/ogg', mddKey: '\\audio\\東京.spx', volumePath: 'hidden' }));
  const resources = { getResource } as unknown as DictionaryResourceService;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pronunciation-audio-'));
    vi.clearAllMocks();
  });

  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('transcodes once, deduplicates concurrent work, and reads subsequent requests from disk cache', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const transcode = vi.fn(async (_source: Buffer, output: string) => {
      await gate;
      await fsp.writeFile(output, Buffer.from('ID3fixture-mp3'));
    });
    const service = new PronunciationAudioService(database, resources, root, { transcode });

    const first = service.getAudio(dictionaryId, 'audio/日本語/東京.spx');
    const concurrent = service.getAudio(dictionaryId, 'audio/日本語/東京.spx');
    release();
    const [a, b] = await Promise.all([first, concurrent]);
    const cached = await service.getAudio(dictionaryId, 'audio/日本語/東京.spx');

    expect(transcode).toHaveBeenCalledTimes(1);
    expect(a?.bytes).toEqual(Buffer.from('ID3fixture-mp3'));
    expect(b?.bytes).toEqual(a?.bytes);
    expect(a?.cacheHit).toBe(false);
    expect(cached?.cacheHit).toBe(true);
  });

  it('preserves case in resource lookup and changes cache identity with source content', async () => {
    const transcode: PronunciationTranscoder = { transcode: async (source, output) => fsp.writeFile(output, Buffer.concat([Buffer.from('ID3'), source])) };
    const service = new PronunciationAudioService(database, resources, root, transcode);
    await service.getAudio(dictionaryId, 'Audio/Test.SPX');
    getResource.mockResolvedValueOnce({ bytes: Buffer.concat([speexBytes(), Buffer.from('changed')]), contentType: 'audio/ogg', mddKey: '', volumePath: '' });
    await service.getAudio(dictionaryId, 'Audio/Test.SPX');
    expect(getResource).toHaveBeenNthCalledWith(1, dictionaryId, 'Audio/Test.SPX');
    expect(getResource).toHaveBeenNthCalledWith(2, dictionaryId, 'Audio/Test.SPX');
  });

  it('rejects non-SPX paths and bytes that are not Ogg/Speex', async () => {
    const service = new PronunciationAudioService(database, resources, root, { transcode: vi.fn() });
    await expect(service.getAudio(dictionaryId, 'audio/test.ogg')).rejects.toMatchObject({ code: 'INVALID_PRONUNCIATION_AUDIO' });
    getResource.mockResolvedValueOnce({ bytes: Buffer.alloc(100), contentType: 'application/octet-stream', mddKey: '', volumePath: '' });
    await expect(service.getAudio(dictionaryId, 'audio/test.spx')).rejects.toMatchObject({ code: 'INVALID_PRONUNCIATION_AUDIO' });
  });

  it('classifies a missing FFmpeg executable without exposing its path', async () => {
    const transcoder = new FfmpegPronunciationTranscoder('definitely-not-an-installed-ffmpeg-command', 1_000);
    await expect(transcoder.transcode(speexBytes(), path.join(root, 'out.mp3'))).rejects.toEqual(
      new PronunciationAudioError('PRONUNCIATION_TRANSCODER_UNAVAILABLE', 'Pronunciation transcoder is unavailable'),
    );
  });
});
