import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DictionaryEntryReprocessingService,
  DictionaryNotFoundForReprocessingError,
  reprocessEntryContent,
} from '../src/entries/dictionary-entry-reprocessing-service.js';

describe('DictionaryEntryReprocessingService → PostgreSQL', () => {
  const database = new PrismaClient();
  const dictionaryIds: string[] = [];
  let dictionaryId: string;
  let otherDictionaryId: string;
  let soundEntryId: string;
  let vocabularyId: string;

  beforeAll(async () => {
    const dictionary = await database.dictionary.create({ data: {
      name: 'reprocessing-fixture', sourceFilename: 'fixture.mdx',
      fileChecksum: crypto.randomUUID(), storageKey: `fixture-${crypto.randomUUID()}.mdx`, status: 'ready',
    } });
    const other = await database.dictionary.create({ data: {
      name: 'other-reprocessing-fixture', sourceFilename: 'other.mdx',
      fileChecksum: crypto.randomUUID(), storageKey: `other-${crypto.randomUUID()}.mdx`, status: 'ready',
    } });
    dictionaryId = dictionary.id;
    otherDictionaryId = other.id;
    dictionaryIds.push(dictionaryId, otherDictionaryId);

    const sound = await database.dictionaryEntry.create({ data: {
      dictionaryId, headwordOriginal: '音声', headwordNormalized: '音声', sortKey: '音声', sourceOrdinal: 0,
      entryRaw: '<a href="sound://Audio/日本語/東京.OGG"><img src="icon.png"></a>',
      entrySanitizedHtml: '<a></a>', entryPlainText: '', entryKind: 'definition',
    } });
    soundEntryId = sound.id;
    const vocabulary = await database.vocabularyItem.create({ data: { entryId: sound.id } });
    vocabularyId = vocabulary.id;
    await database.dictionaryEntry.createMany({ data: [
      {
        dictionaryId, headwordOriginal: 'link', headwordNormalized: 'link', sortKey: 'link', sourceOrdinal: 1,
        entryRaw: '<a href="entry://東京"><b>display text</b></a>', entrySanitizedHtml: '<a><b>display text</b></a>',
        entryPlainText: 'display text', entryKind: 'definition',
      },
      {
        dictionaryId, headwordOriginal: 'same', headwordNormalized: 'same', sortKey: 'same', sourceOrdinal: 2,
        entryRaw: '<span>same</span>', entrySanitizedHtml: '<span>same</span>', entryPlainText: 'same', entryKind: 'definition',
      },
      {
        dictionaryId, headwordOriginal: 'redirect', headwordNormalized: 'redirect', sortKey: 'redirect', sourceOrdinal: 3,
        entryRaw: '@@@LINK=target', entrySanitizedHtml: '<b>incorrect</b>', entryPlainText: 'incorrect',
        entryKind: 'redirect', redirectTargetOriginal: 'target',
      },
      {
        dictionaryId, headwordOriginal: 'THROW', headwordNormalized: 'throw', sortKey: 'throw', sourceOrdinal: 4,
        entryRaw: 'THROW', entrySanitizedHtml: 'old', entryPlainText: 'old', entryKind: 'definition',
      },
      {
        dictionaryId: otherDictionaryId, headwordOriginal: 'other', headwordNormalized: 'other', sortKey: 'other', sourceOrdinal: 0,
        entryRaw: '<img src="/pic/other.png">', entrySanitizedHtml: 'other-old', entryPlainText: 'other-old', entryKind: 'definition',
      },
    ] });
  });

  afterAll(async () => {
    await database.dictionary.deleteMany({ where: { id: { in: dictionaryIds } } });
    await database.$disconnect();
  });

  it('dry-runs in cursor batches with zero writes and reports per-entry failures', async () => {
    const progress: number[] = [];
    const service = new DictionaryEntryReprocessingService(database, (raw, kind) => {
      if (raw === 'THROW') throw new Error('fixture processor failure');
      return reprocessEntryContent(raw, kind);
    });
    const before = await database.dictionaryEntry.findUniqueOrThrow({ where: { id: soundEntryId } });
    const summary = await service.reprocess(dictionaryId, { batchSize: 2, onProgress: (value) => progress.push(value.processed) });
    const after = await database.dictionaryEntry.findUniqueOrThrow({ where: { id: soundEntryId } });

    expect(summary).toEqual(expect.objectContaining({
      mode: 'dry-run', processed: 5, entriesChanged: 3, sanitizedHtmlChanged: 3,
      entryPlainTextChanged: 1, unchanged: 1, failed: 1,
    }));
    expect(summary.failures[0]).toEqual(expect.objectContaining({ sourceOrdinal: 4, headword: 'THROW' }));
    expect(summary.failures[0].message).not.toContain('entryRaw');
    expect(progress).toEqual([2, 4, 5]);
    expect(after).toEqual(before);
  });

  it('applies atomic in-place field updates while preserving IDs, redirects, relations, and dictionary scope', async () => {
    const service = new DictionaryEntryReprocessingService(database);
    const summary = await service.reprocess(dictionaryId, { apply: true, batchSize: 2 });
    expect(summary).toEqual(expect.objectContaining({
      mode: 'apply', processed: 5, entriesChanged: 4, sanitizedHtmlChanged: 4,
      entryPlainTextChanged: 2, unchanged: 1, failed: 0,
    }));

    const sound = await database.dictionaryEntry.findUniqueOrThrow({ where: { id: soundEntryId } });
    expect(sound.id).toBe(soundEntryId);
    expect(sound.sourceOrdinal).toBe(0);
    expect(sound.entrySanitizedHtml).toBe('<span data-mdict-kind="sound" data-mdict-resource="Audio/日本語/東京.OGG"></span>');
    expect(sound.entryPlainText).toBe('');
    const vocabulary = await database.vocabularyItem.findUniqueOrThrow({ where: { id: vocabularyId } });
    expect(vocabulary.entryId).toBe(soundEntryId);

    const entryLink = await database.dictionaryEntry.findFirstOrThrow({ where: { dictionaryId, sourceOrdinal: 1 } });
    expect(entryLink.entrySanitizedHtml).toContain('data-mdict-entry-target="東京"');
    expect(entryLink.entryPlainText).toBe('display text');
    const redirect = await database.dictionaryEntry.findFirstOrThrow({ where: { dictionaryId, sourceOrdinal: 3 } });
    expect(redirect).toEqual(expect.objectContaining({
      entryKind: 'redirect', redirectTargetOriginal: 'target', entrySanitizedHtml: '', entryPlainText: '',
    }));
    const other = await database.dictionaryEntry.findFirstOrThrow({ where: { dictionaryId: otherDictionaryId } });
    expect(other.entrySanitizedHtml).toBe('other-old');
  });

  it('is idempotent because every run starts from entryRaw', async () => {
    const summary = await new DictionaryEntryReprocessingService(database).reprocess(dictionaryId, { apply: true, batchSize: 3 });
    expect(summary).toEqual(expect.objectContaining({ processed: 5, entriesChanged: 0, unchanged: 5, failed: 0 }));
  });

  it('rejects a missing dictionary and invalid batch size before scanning', async () => {
    const service = new DictionaryEntryReprocessingService(database);
    await expect(service.reprocess('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(DictionaryNotFoundForReprocessingError);
    await expect(service.reprocess(dictionaryId, { batchSize: 0 })).rejects.toBeInstanceOf(RangeError);
  });
});
