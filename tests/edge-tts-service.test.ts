import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { EdgeTtsService, type EdgeTtsProvider } from '../src/resources/edge-tts-service.js';

describe('EdgeTtsService', () => {
  let root: string;
  const mp3 = Buffer.from('ID3experimental-audio');
  let provider: EdgeTtsProvider;
  let synthesize: Mock<(word: string, voice: string) => Promise<Buffer>>;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edge-tts-'));
    synthesize = vi.fn(async (_word: string, _voice: string) => mp3);
    provider = { synthesize };
  });

  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('uses the fixed en-US voice for each selection', async () => {
    const service = new EdgeTtsService(root, provider);
    const female = await service.getAudio('vocabulary', 'female');
    const male = await service.getAudio('vocabulary', 'male');
    expect(female.voice).toBe('en-US-AvaNeural');
    expect(male.voice).toBe('en-US-BrianNeural');
    expect(synthesize).toHaveBeenNthCalledWith(1, 'vocabulary', 'en-US-AvaNeural');
    expect(synthesize).toHaveBeenNthCalledWith(2, 'vocabulary', 'en-US-BrianNeural');
  });

  it('deduplicates concurrent synthesis and then uses the disk cache', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    synthesize.mockImplementationOnce(async () => { await gate; return mp3; });
    const service = new EdgeTtsService(root, provider);
    const first = service.getAudio('important', 'female');
    const concurrent = service.getAudio('important', 'female');
    release();
    const [a, b] = await Promise.all([first, concurrent]);
    const cached = await service.getAudio('important', 'female');
    const offlineProvider: EdgeTtsProvider = {
      synthesize: vi.fn(async () => { throw new Error('offline'); }),
    };
    const cachedAfterRestart = await new EdgeTtsService(root, offlineProvider).getAudio('important', 'female');
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(a.bytes).toEqual(mp3);
    expect(b.voice).toBe(a.voice);
    expect(a.cacheHit).toBe(false);
    expect(cached.cacheHit).toBe(true);
    expect(cachedAfterRestart.cacheHit).toBe(true);
    expect(offlineProvider.synthesize).not.toHaveBeenCalled();
  });

  it('caches female and male audio independently and rejects malformed input', async () => {
    const service = new EdgeTtsService(root, provider);
    const female = await service.getAudio('system', 'female');
    const male = await service.getAudio('system', 'male');
    expect(female.bytes).toEqual(mp3);
    expect(male.bytes).toEqual(mp3);
    expect(synthesize).toHaveBeenCalledTimes(2);
    await expect(service.getAudio('\u0000unsafe', 'female')).rejects.toMatchObject({ code: 'INVALID_EDGE_TTS_REQUEST' });
    await expect(service.getAudio('word', 'other' as 'female')).rejects.toMatchObject({ code: 'INVALID_EDGE_TTS_REQUEST' });
  });

  it('fails cleanly when synthesis is unavailable', async () => {
    provider.synthesize = vi.fn(async () => { throw new Error('private network detail'); });
    await expect(new EdgeTtsService(root, provider).getAudio('test', 'female')).rejects.toMatchObject({
      code: 'EDGE_TTS_UNAVAILABLE', message: 'Edge TTS is unavailable',
    });
  });
});
