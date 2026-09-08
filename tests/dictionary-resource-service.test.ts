import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MddResourceAdapter } from '../src/mdx/mdd-resource-adapter.js';
import { DictionaryResourceService } from '../src/resources/dictionary-resource-service.js';
import { DictionaryPackageStorage } from '../src/storage/dictionary-package-storage.js';

describe('DictionaryResourceService', () => {
  let root: string;
  let storage: DictionaryPackageStorage;
  const packages = new Map<string, string | null>();

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'resource-service-'));
    storage = new DictionaryPackageStorage(root);
    packages.set('dictionary-a', 'dictionaries/dictionary-a');
    packages.set('dictionary-b', 'dictionaries/dictionary-b');
    packages.set('old-dictionary', null);
    for (const id of ['dictionary-a', 'dictionary-b']) {
      await fsp.mkdir(path.join(root, 'dictionaries', id, 'resources'), { recursive: true });
    }
  });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  function service(hits: Record<string, Record<string, Buffer>>, calls: string[] = []) {
    const database = { dictionary: { findUnique: async ({ where }: { where: { id: string } }) => {
      const value = packages.get(where.id);
      return value === undefined ? null : { packageStorageKey: value };
    } } } as unknown as PrismaClient;
    const adapter: MddResourceAdapter = { lookupResource(volume, key) {
      calls.push(`${path.basename(volume)}:${key}`);
      return hits[path.basename(volume)]?.[key] ?? null;
    } };
    return new DictionaryResourceService(database, storage, adapter);
  }

  it('checks base then numbered volumes and returns a numbered-volume hit', async () => {
    const directory = path.join(root, 'dictionaries/dictionary-a/resources');
    await Promise.all(['source.2.mdd', 'source.1.mdd', 'source.mdd'].map((name) => fsp.writeFile(path.join(directory, name), 'x')));
    const calls: string[] = [];
    const result = await service({ 'source.1.mdd': { '\\audio\\日本語\\東京.ogg': Buffer.from('OggSnumbered') } }, calls)
      .getResource('dictionary-a', 'audio/日本語/東京.ogg');
    expect(result?.bytes).toEqual(Buffer.from('OggSnumbered'));
    expect(result?.contentType).toBe('audio/ogg');
    expect(calls).toEqual([
      'source.mdd:\\audio\\日本語\\東京.ogg',
      'source.1.mdd:\\audio\\日本語\\東京.ogg',
    ]);
  });

  it('uses the first matching volume for duplicate keys', async () => {
    const directory = path.join(root, 'dictionaries/dictionary-a/resources');
    await Promise.all(['source.1.mdd', 'source.mdd'].map((name) => fsp.writeFile(path.join(directory, name), 'x')));
    const result = await service({
      'source.mdd': { '\\same': Buffer.from('base') },
      'source.1.mdd': { '\\same': Buffer.from('numbered') },
    }).getResource('dictionary-a', 'same');
    expect(result?.bytes.toString()).toBe('base');
  });

  it('returns not found for missing resources and dictionaries without package MDD storage', async () => {
    await expect(service({}).getResource('dictionary-a', 'missing.bin')).resolves.toBeNull();
    await expect(service({}).getResource('old-dictionary', 'missing.bin')).resolves.toBeNull();
    await expect(service({}).getResource('unknown', 'missing.bin')).resolves.toBeNull();
  });

  it('keeps lookup dictionary-scoped', async () => {
    await fsp.writeFile(path.join(root, 'dictionaries/dictionary-b/resources/source.mdd'), 'x');
    const result = await service({ 'source.mdd': { '\\private.bin': Buffer.from('dictionary-b') } })
      .getResource('dictionary-a', 'private.bin');
    expect(result).toBeNull();
  });
});
