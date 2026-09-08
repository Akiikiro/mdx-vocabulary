import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MddResourceAdapter } from '../src/mdx/mdd-resource-adapter.js';
import { createApiServer } from '../src/http/server.js';
import { DictionaryPackageStorage } from '../src/storage/dictionary-package-storage.js';
import { PronunciationAudioError } from '../src/resources/pronunciation-audio-service.js';

describe('dictionary resource HTTP API', () => {
  const dictionaryA = '11111111-1111-4111-8111-111111111111';
  const dictionaryB = '22222222-2222-4222-8222-222222222222';
  let root: string;
  let server: FastifyInstance;
  const lookupResource = vi.fn((volume: string, key: string) => {
    if (volume.includes(dictionaryA) && key === '\\audio\\日本語\\東京.ogg') return Buffer.from('OggSunicode');
    if (volume.includes(dictionaryA) && key === '\\Audio\\Test.OGG') return Buffer.from('OggScase');
    return null;
  });

  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'resource-api-'));
    for (const id of [dictionaryA, dictionaryB]) {
      const directory = path.join(root, 'dictionaries', id, 'resources');
      await fsp.mkdir(directory, { recursive: true });
      await fsp.writeFile(path.join(directory, 'source.mdd'), 'fixture');
    }
    const packageKeys: Record<string, string> = {
      [dictionaryA]: `dictionaries/${dictionaryA}`,
      [dictionaryB]: `dictionaries/${dictionaryB}`,
    };
    const database = { dictionary: {
      findMany: async () => [],
      findUnique: async ({ where }: { where: { id: string } }) => packageKeys[where.id]
        ? { packageStorageKey: packageKeys[where.id] }
        : null,
    } } as unknown as PrismaClient;
    const adapter: MddResourceAdapter = { lookupResource, close: vi.fn() };
    server = await createApiServer(database, {
      packageStorage: new DictionaryPackageStorage(root), mddResourceAdapter: adapter,
      pronunciationAudioService: {
        getAudio: async (dictionaryId, logicalPath) => {
          if (logicalPath === 'uk/unavailable.spx') {
            throw new PronunciationAudioError('PRONUNCIATION_TRANSCODER_UNAVAILABLE', 'Pronunciation transcoder is unavailable');
          }
          return dictionaryId === dictionaryA && logicalPath === 'uk/test.spx'
            ? { bytes: Buffer.from('ID3browser'), contentType: 'audio/mpeg', cacheHit: true }
            : null;
        },
      },
      startImportJob: () => {},
    });
  });

  afterAll(async () => {
    await server.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('returns exact binary bytes and magic-byte Content-Type for a Unicode path', async () => {
    const logicalPath = 'audio/日本語/東京.ogg';
    const response = await server.inject({
      method: 'GET', url: `/api/dictionaries/${dictionaryA}/resources/${logicalPath}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('audio/ogg');
    expect(response.rawPayload).toEqual(Buffer.from('OggSunicode'));
    expect(lookupResource).toHaveBeenCalledWith(expect.stringContaining(dictionaryA), '\\audio\\日本語\\東京.ogg');
  });

  it('preserves case and does not silently retry a folded key', async () => {
    const exact = await server.inject({ method: 'GET', url: `/api/dictionaries/${dictionaryA}/resources/Audio/Test.OGG` });
    const folded = await server.inject({ method: 'GET', url: `/api/dictionaries/${dictionaryA}/resources/audio/test.ogg` });
    expect(exact.statusCode).toBe(200);
    expect(folded.statusCode).toBe(404);
  });

  it('returns 404 for missing resources and enforces dictionary isolation', async () => {
    const missing = await server.inject({ method: 'GET', url: `/api/dictionaries/${dictionaryA}/resources/missing.bin` });
    const isolated = await server.inject({ method: 'GET', url: `/api/dictionaries/${dictionaryB}/resources/audio/%E6%97%A5%E6%9C%AC%E8%AA%9E/%E6%9D%B1%E4%BA%AC.ogg` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('DICTIONARY_RESOURCE_NOT_FOUND');
    expect(isolated.statusCode).toBe(404);
  });

  it('documents the binary resource endpoint in OpenAPI', async () => {
    const response = await server.inject({ method: 'GET', url: '/docs/json' });
    const route = response.json().paths['/api/dictionaries/{dictionaryId}/resources/{*}'].get;
    expect(route.responses['200'].content['application/octet-stream'].schema).toEqual({ type: 'string', format: 'binary' });
  });

  it('returns browser-compatible pronunciation audio from a separate endpoint', async () => {
    const response = await server.inject({
      method: 'GET', url: `/api/dictionaries/${dictionaryA}/browser-audio/uk/test.spx`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('audio/mpeg');
    expect(response.rawPayload).toEqual(Buffer.from('ID3browser'));

    const missing = await server.inject({
      method: 'GET', url: `/api/dictionaries/${dictionaryB}/browser-audio/uk/test.spx`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('PRONUNCIATION_AUDIO_NOT_FOUND');
  });

  it('documents browser-compatible pronunciation audio in OpenAPI', async () => {
    const response = await server.inject({ method: 'GET', url: '/docs/json' });
    const route = response.json().paths['/api/dictionaries/{dictionaryId}/browser-audio/{*}'].get;
    expect(route.responses['200'].content['audio/mpeg'].schema).toEqual({ type: 'string', format: 'binary' });
  });

  it('returns a controlled error when the transcoder is unavailable', async () => {
    const response = await server.inject({
      method: 'GET', url: `/api/dictionaries/${dictionaryA}/browser-audio/uk/unavailable.spx`,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: {
      code: 'PRONUNCIATION_TRANSCODER_UNAVAILABLE', message: 'Pronunciation transcoder is unavailable',
    } });
  });
});
