import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serializeMdxLocator, type LazyMdxAdapter, type MdxEntryLocator } from '../src/mdx/lazy-mdx-adapter.js';
import { LazyDetailMappingError, LazyDictionaryDetailPocService } from '../src/query/lazy-dictionary-detail-poc-service.js';

const checksum = 'c'.repeat(64);

describe('LazyDictionaryDetailPocService → PostgreSQL identity', () => {
  const database = new PrismaClient();
  const dictionaryIds: string[] = [];
  let dictionaryId: string;
  let otherDictionaryId: string;
  let duplicateIds: string[];
  let redirectId: string;
  let vocabularyId: string;
  const raw = ['<b>first duplicate</b>', '<i>second duplicate</i>', '<a href="sound://Audio/日本語/東京.OGG"></a>', '@@@LINK=same', '<strong>target first</strong>'];
  const keys = ['same', 'same', '東京', 'redirect', 'same'];
  const locators: MdxEntryLocator[] = keys.map((keyText, index) => ({
    version: 1, fileChecksum: checksum, keyText, keyBlockIndex: index < 3 ? 1 : 2,
    recordStartOffset: BigInt(index * 100), recordEndOffset: BigInt(index * 100 + 50),
  }));
  const adapter: LazyMdxAdapter = {
    listEntryLocators: async (_path, expected) => expected === checksum ? locators : [],
    getEntryLocator: async (_path, expected, ordinal) => expected === checksum ? locators[ordinal] ?? null : null,
    fetchByLocator: async (_path, expected, locator) => {
      if (expected !== checksum) throw new Error('wrong dictionary');
      const index = locators.findIndex((candidate) => serializeMdxLocator(candidate) === serializeMdxLocator(locator));
      if (index < 0) throw new Error('missing locator');
      return { headword: keys[index], rawEntry: raw[index], redirectTarget: index === 3 ? 'same' : null };
    },
    close: () => {},
  };

  beforeAll(async () => {
    const dictionary = await database.dictionary.create({ data: {
      name: 'lazy-poc', sourceFilename: 'fixture.mdx', fileChecksum: checksum,
      storageKey: `fixture-${crypto.randomUUID()}.mdx`, status: 'ready',
    } });
    const other = await database.dictionary.create({ data: {
      name: 'lazy-poc-other', sourceFilename: 'other.mdx', fileChecksum: 'd'.repeat(64),
      storageKey: `other-${crypto.randomUUID()}.mdx`, status: 'ready',
    } });
    dictionaryId = dictionary.id; otherDictionaryId = other.id;
    dictionaryIds.push(dictionaryId, otherDictionaryId);
    const created = [];
    for (let index = 0; index < keys.length; index++) {
      created.push(await database.dictionaryEntry.create({ data: {
        dictionaryId, headwordOriginal: keys[index], headwordNormalized: keys[index].toLocaleLowerCase('en-US'),
        sortKey: keys[index].toLocaleLowerCase('en-US'), sourceOrdinal: index, entryRaw: raw[index],
        entrySanitizedHtml: 'old', entryPlainText: 'old', entryKind: index === 3 ? 'redirect' : 'definition',
        redirectTargetOriginal: index === 3 ? 'same' : null,
      } }));
    }
    duplicateIds = [created[0].id, created[1].id]; redirectId = created[3].id;
    vocabularyId = (await database.vocabularyItem.create({ data: { entryId: created[1].id } })).id;
  });

  afterAll(async () => {
    await database.dictionary.deleteMany({ where: { id: { in: dictionaryIds } } });
    await database.$disconnect();
  });

  const service = () => new LazyDictionaryDetailPocService(database, adapter, (key) => `/data/${key}`);

  it('maps duplicate UUID identities to distinct exact MDX records repeatedly', async () => {
    const first = await service().getEntry(duplicateIds[0]);
    const second = await service().getEntry(duplicateIds[1]);
    expect(first?.detail).toEqual(expect.objectContaining({ id: duplicateIds[0], headword: 'same', sanitizedHtml: '<b>first duplicate</b>' }));
    expect(second?.detail).toEqual(expect.objectContaining({ id: duplicateIds[1], headword: 'same', sanitizedHtml: '<i>second duplicate</i>' }));
    expect((await service().getEntry(duplicateIds[1]))?.detail).toEqual(second?.detail);
    expect(first?.locator.recordStartOffset).not.toBe(second?.locator.recordStartOffset);
  });

  it('preserves Unicode/case, runs the safe pipeline, and never exposes raw HTML', async () => {
    const row = await database.dictionaryEntry.findFirstOrThrow({ where: { dictionaryId, sourceOrdinal: 2 } });
    const result = await service().getEntry(row.id);
    expect(result?.detail.sanitizedHtml).toContain('data-mdict-resource="Audio/日本語/東京.OGG"');
    expect(result?.detail.plainText).toBe('');
    expect(result?.detail).not.toHaveProperty('entryRaw');
    expect(result).not.toHaveProperty('rawEntry');
  });

  it('keeps redirect identity and resolves one hop to the first sourceOrdinal target', async () => {
    const result = await service().getEntry(redirectId);
    expect(result?.detail).toEqual(expect.objectContaining({
      id: redirectId, kind: 'redirect', redirectTarget: 'same', sanitizedHtml: '<b>first duplicate</b>', plainText: 'first duplicate',
    }));
  });

  it('preserves VocabularyItem → DictionaryEntry UUID continuity', async () => {
    const vocabulary = await database.vocabularyItem.findUniqueOrThrow({ where: { id: vocabularyId } });
    expect(vocabulary.entryId).toBe(duplicateIds[1]);
    expect((await service().getEntry(vocabulary.entryId))?.detail.sanitizedHtml).toBe('<i>second duplicate</i>');
  });

  it('audits complete mapping and rejects a mismatched row instead of guessing', async () => {
    await expect(service().auditMapping(dictionaryId, 2)).resolves.toEqual({
      dictionaryId, databaseEntries: 5, mdxEntries: 5, mapped: 5, missingOrdinal: 0,
      headwordMismatch: 0, normalizedHeadwordMismatch: 0, rawContentMismatch: 0,
      entryKindMismatch: 0, redirectTargetMismatch: 0, duplicateLocator: 0,
    });
    const otherEntry = await database.dictionaryEntry.create({ data: {
      dictionaryId: otherDictionaryId, headwordOriginal: 'wrong', headwordNormalized: 'wrong', sortKey: 'wrong',
      sourceOrdinal: 0, entryRaw: 'wrong', entrySanitizedHtml: 'wrong', entryPlainText: 'wrong', entryKind: 'definition',
    } });
    await expect(service().getEntry(otherEntry.id)).rejects.toBeInstanceOf(LazyDetailMappingError);
  });
});
