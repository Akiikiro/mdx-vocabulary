import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MdxLocatorBackfillService } from '../src/entries/mdx-locator-backfill-service.js';
import type { LazyMdxAdapter, MdxEntryLocator } from '../src/mdx/lazy-mdx-adapter.js';
import { mdxLocatorFromPersistedFields, PartialPersistedMdxLocatorError, persistedFieldsFromMdxLocator } from '../src/mdx/mdx-locator-persistence.js';
import { LazyDictionaryDetailPocService } from '../src/query/lazy-dictionary-detail-poc-service.js';

const checksum = 'e'.repeat(64);
const keys = ['same', 'same', '東京', 'redirect', 'target'];
const raw = ['<b>first</b>', '<i>second</i>', '<a href="sound://Audio/日本語/東京.OGG"></a>', '@@@LINK=target', '<img src="/pic/猫.png">'];
const locators: MdxEntryLocator[] = keys.map((keyText, index) => ({ version: 1, fileChecksum: checksum, keyText, keyBlockIndex: index < 2 ? 0 : 1, recordStartOffset: BigInt(index) * 10_000_000_000_000_000n, recordEndOffset: BigInt(index) * 10_000_000_000_000_000n + 50n }));

describe('persisted MDX locator backfill', () => {
  const database = new PrismaClient();
  const dictionaryIds: string[] = [];
  let dictionaryId: string;
  let entryIds: string[];
  let vocabularyId: string;
  const adapter: LazyMdxAdapter = {
    listEntryLocators: async (_path, expected) => expected === checksum ? locators : [],
    getEntryLocator: async (_path, expected, ordinal) => expected === checksum ? locators[ordinal] ?? null : null,
    fetchByLocator: async (_path, expected, locator) => {
      if (expected !== locator.fileChecksum) throw new Error('checksum mismatch');
      const index = locators.findIndex((value) => value.recordStartOffset === locator.recordStartOffset && value.keyText === locator.keyText);
      if (index < 0) throw new Error('unknown locator');
      return { headword: keys[index], rawEntry: raw[index], redirectTarget: index === 3 ? 'target' : null };
    }, close: () => {},
  };

  beforeAll(async () => {
    const dictionary = await database.dictionary.create({ data: { name: 'locator-backfill', sourceFilename: 'fixture.mdx', fileChecksum: checksum, storageKey: `locator-${crypto.randomUUID()}.mdx`, status: 'ready' } });
    dictionaryId = dictionary.id; dictionaryIds.push(dictionaryId);
    const created = [];
    for (let index = 0; index < keys.length; index++) created.push(await database.dictionaryEntry.create({ data: {
      dictionaryId, headwordOriginal: keys[index], headwordNormalized: keys[index].toLocaleLowerCase('en-US'), sortKey: keys[index].toLocaleLowerCase('en-US'),
      sourceOrdinal: index, entryRaw: raw[index], entrySanitizedHtml: `stored-${index}`, entryPlainText: `plain-${index}`,
      entryKind: index === 3 ? 'redirect' : 'definition', redirectTargetOriginal: index === 3 ? 'target' : null,
    } }));
    entryIds = created.map((entry) => entry.id);
    vocabularyId = (await database.vocabularyItem.create({ data: { entryId: entryIds[1] } })).id;
  });

  afterAll(async () => { await database.dictionary.deleteMany({ where: { id: { in: dictionaryIds } } }); await database.$disconnect(); });
  const service = () => new MdxLocatorBackfillService(database, adapter, (key) => `/fixtures/${key}`);

  it('round-trips a bigint locator beyond Number.MAX_SAFE_INTEGER and rejects partial fields', () => {
    const fields = persistedFieldsFromMdxLocator(locators[2]);
    expect(fields.mdxLocatorRecordStartOffset).toBe(20_000_000_000_000_000n);
    expect(mdxLocatorFromPersistedFields(fields)).toEqual(locators[2]);
    expect(() => mdxLocatorFromPersistedFields({ ...fields, mdxLocatorKeyText: null })).toThrow(PartialPersistedMdxLocatorError);
  });

  it('dry-run validates every row without writing', async () => {
    const before = await database.dictionaryEntry.findMany({ where: { dictionaryId }, orderBy: { sourceOrdinal: 'asc' } });
    const result = await service().backfill(dictionaryId, { batchSize: 2 });
    const after = await database.dictionaryEntry.findMany({ where: { dictionaryId }, orderBy: { sourceOrdinal: 'asc' } });
    expect(result).toEqual(expect.objectContaining({ mode: 'dry-run', total: 5, processed: 5, mappable: 5, alreadyPopulated: 0, written: 0, mismatches: 0, collisions: 0, failures: 0 }));
    expect(after).toEqual(before);
  });

  it('apply persists only distinct locators in place and preserves content, UUIDs, and VocabularyItem', async () => {
    const before = await database.dictionaryEntry.findMany({ where: { dictionaryId }, orderBy: { sourceOrdinal: 'asc' } });
    const result = await service().backfill(dictionaryId, { apply: true, batchSize: 2 });
    expect(result).toEqual(expect.objectContaining({ mappable: 5, written: 5, failures: 0 }));
    const after = await database.dictionaryEntry.findMany({ where: { dictionaryId }, orderBy: { sourceOrdinal: 'asc' } });
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    for (let index = 0; index < after.length; index++) {
      expect(after[index]).toEqual(expect.objectContaining({ entryRaw: before[index].entryRaw, entrySanitizedHtml: before[index].entrySanitizedHtml, entryPlainText: before[index].entryPlainText }));
      expect(mdxLocatorFromPersistedFields(after[index])).toEqual(locators[index]);
    }
    expect(after[0].mdxLocatorRecordStartOffset).not.toBe(after[1].mdxLocatorRecordStartOffset);
    expect((await database.vocabularyItem.findUniqueOrThrow({ where: { id: vocabularyId } })).entryId).toBe(entryIds[1]);
  });

  it('is restartable and persisted locators drive lazy detail and dual-read parity', async () => {
    const result = await service().backfill(dictionaryId, { apply: true });
    expect(result).toEqual(expect.objectContaining({ alreadyPopulated: 5, written: 0, failures: 0 }));
    const lazy = new LazyDictionaryDetailPocService(database, adapter, (key) => `/fixtures/${key}`);
    expect((await lazy.getEntryFromPersistedLocator(entryIds[0]))?.detail.sanitizedHtml).toBe('<b>first</b>');
    expect((await lazy.getEntryFromPersistedLocator(entryIds[1]))?.detail.sanitizedHtml).toBe('<i>second</i>');
    expect((await lazy.getEntryFromPersistedLocator(entryIds[2]))?.detail.sanitizedHtml).toContain('Audio/日本語/東京.OGG');
    await expect(lazy.comparePersistedLocatorParity(entryIds[2])).resolves.toEqual({ identityEqual: true, sanitizedHtmlEqual: true, plainTextEqual: true, redirectEqual: true });
    expect((await lazy.getEntryFromPersistedLocator(entryIds[3]))?.detail).toEqual(expect.objectContaining({ id: entryIds[3], kind: 'redirect', redirectTarget: 'target' }));
    await expect(lazy.comparePersistedLocatorParity(entryIds[3])).resolves.toEqual({ identityEqual: true, sanitizedHtmlEqual: true, plainTextEqual: true, redirectEqual: true });
  });

  it('fails closed for partial and checksum-mismatched persisted locators', async () => {
    await database.dictionaryEntry.update({ where: { id: entryIds[0] }, data: { mdxLocatorKeyText: null } });
    let result = await service().backfill(dictionaryId);
    expect(result).toEqual(expect.objectContaining({ mappable: 4, mismatches: 1, failures: 1 }));
    await database.dictionaryEntry.update({ where: { id: entryIds[0] }, data: { ...persistedFieldsFromMdxLocator(locators[0]), mdxLocatorFileChecksum: 'f'.repeat(64) } });
    result = await service().backfill(dictionaryId);
    expect(result).toEqual(expect.objectContaining({ mappable: 4, mismatches: 1, failures: 1 }));
    await database.dictionaryEntry.update({ where: { id: entryIds[0] }, data: persistedFieldsFromMdxLocator(locators[0]) });
  });
});
