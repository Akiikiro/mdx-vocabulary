import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentModel } from '@prisma/client';
import { prisma } from '../src/db.js';
import { DictionaryQueryService } from '../src/query/dictionary-query-service.js';

describe('dictionary source record boundary', () => {
  const dictionaryId = crypto.randomUUID();
  const otherDictionaryId = crypto.randomUUID();
  const entryId = crypto.randomUUID();
  const otherEntryId = crypto.randomUUID();

  beforeAll(async () => {
    await prisma.dictionary.create({
      data: {
        id: dictionaryId, name: 'source-record-fixture', sourceFilename: 'fixture.source',
        fileChecksum: crypto.randomUUID(), storageKey: `source-record/${crypto.randomUUID()}`,
        status: 'ready', sourceFormat: 'fixture', contentModel: ContentModel.structured,
        entries: { create: {
          id: entryId, headwordOriginal: '語', headwordNormalized: '語', sortKey: '語',
          entryPlainText: '語', sourceOrdinal: 0, structuredEntry: { create: {} },
          vocabularyItem: { create: {} },
        } },
      },
    });
    await prisma.dictionary.create({
      data: {
        id: otherDictionaryId, name: 'source-record-other', sourceFilename: 'other.mdx',
        fileChecksum: crypto.randomUUID(), storageKey: `source-record/${crypto.randomUUID()}`,
        status: 'ready', sourceFormat: 'mdx', contentModel: ContentModel.html,
        entries: { create: {
          id: otherEntryId, headwordOriginal: 'other', headwordNormalized: 'other', sortKey: 'other',
          entryRaw: '<b>other</b>', entrySanitizedHtml: '<b>other</b>', entryPlainText: 'other', sourceOrdinal: 0,
        } },
      },
    });
  });

  afterAll(async () => {
    await prisma.dictionary.deleteMany({ where: { id: { in: [dictionaryId, otherDictionaryId] } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('stores a deferred lossless record without creating a lexical entry', async () => {
    const record = await prisma.dictionarySourceRecord.create({ data: {
      dictionaryId, sourceKey: 'fixture:1', sourceOrdinal: 1, recordKind: 'deferred',
      sourceIdentity: { ordinal: 1, sourceName: 'custom-record' }, rawPayload: 'exact deferred payload',
      contentChecksum: 'a'.repeat(64), sourceMetadata: { reason: 'unresolved' },
      artifacts: { create: {
        parserName: 'fixture-parser', parserVersion: '1.0.0', representationVersion: 1,
        parsedRepresentation: { kind: 'deferred', target: 'unresolved' },
        diagnostics: [{ code: 'deferred' }], artifactMetadata: { grammar: 'fixture-v1' },
        representationChecksum: 'b'.repeat(64),
      } },
    }, include: { artifacts: true, entry: true } });

    expect(record.entry).toBeNull();
    expect(record.rawPayload).toBe('exact deferred payload');
    expect(record.artifacts).toHaveLength(1);
    expect(await prisma.dictionaryEntry.count({ where: { dictionaryId } })).toBe(1);
  });

  it('links at most one same-dictionary source record to a canonical entry', async () => {
    const linked = await prisma.dictionarySourceRecord.create({ data: {
      dictionaryId, entryId, sourceKey: 'fixture:0', sourceOrdinal: 0, recordKind: 'lexical',
      sourceIdentity: { ordinal: 0 }, rawPayload: 'lexical payload', contentChecksum: 'c'.repeat(64),
    }, include: { entry: { include: { vocabularyItem: true } } } });
    expect(linked.entry).toMatchObject({ id: entryId, vocabularyItem: { entryId } });

    await expect(prisma.dictionarySourceRecord.create({ data: {
      dictionaryId, entryId, sourceKey: 'fixture:2', sourceOrdinal: 2, recordKind: 'lexical',
      sourceIdentity: { ordinal: 2 }, rawPayload: 'duplicate link', contentChecksum: 'd'.repeat(64),
    } })).rejects.toMatchObject({ code: 'P2002' });

    await expect(prisma.dictionarySourceRecord.create({ data: {
      dictionaryId, entryId: otherEntryId, sourceKey: 'fixture:2', sourceOrdinal: 2, recordKind: 'lexical',
      sourceIdentity: { ordinal: 2 }, rawPayload: 'cross dictionary', contentChecksum: 'e'.repeat(64),
    } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('keeps source identity and parser versions independently unique', async () => {
    const sourceRecord = await prisma.dictionarySourceRecord.findUniqueOrThrow({
      where: { dictionaryId_sourceKey: { dictionaryId, sourceKey: 'fixture:0' } },
    });
    await prisma.dictionarySourceArtifact.createMany({ data: [
      { sourceRecordId: sourceRecord.id, parserName: 'fixture-parser', parserVersion: '1.0.0', representationVersion: 1, representationChecksum: '1'.repeat(64) },
      { sourceRecordId: sourceRecord.id, parserName: 'fixture-parser', parserVersion: '2.0.0', representationVersion: 1, representationChecksum: '2'.repeat(64) },
    ] });
    await expect(prisma.dictionarySourceArtifact.create({ data: {
      sourceRecordId: sourceRecord.id, parserName: 'fixture-parser', parserVersion: '2.0.0',
      representationVersion: 1, representationChecksum: '3'.repeat(64),
    } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.dictionarySourceRecord.create({ data: {
      dictionaryId, sourceKey: 'fixture:0', sourceOrdinal: 3, recordKind: 'deferred',
      sourceIdentity: { ordinal: 3 }, rawPayload: 'duplicate identity', contentChecksum: 'f'.repeat(64),
    } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps source records private and protects a linked record from entry-only deletion', async () => {
    const detail = await new DictionaryQueryService(prisma).getEntry(entryId);
    expect(detail).not.toHaveProperty('sourceRecord');
    expect(detail).not.toHaveProperty('rawPayload');
    await expect(prisma.dictionaryEntry.delete({ where: { id: entryId } })).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.vocabularyItem.findUnique({ where: { entryId } })).not.toBeNull();
  });

  it('deletes versioned artifacts with their source record', async () => {
    const deferred = await prisma.dictionarySourceRecord.findUniqueOrThrow({
      where: { dictionaryId_sourceKey: { dictionaryId, sourceKey: 'fixture:1' } }, include: { artifacts: true },
    });
    await prisma.dictionarySourceRecord.delete({ where: { id: deferred.id } });
    expect(await prisma.dictionarySourceArtifact.count({ where: { sourceRecordId: deferred.id } })).toBe(0);
  });

  it('cascades the complete private source graph when its dictionary snapshot is deleted', async () => {
    const disposableDictionaryId = crypto.randomUUID(); const disposableEntryId = crypto.randomUUID();
    const dictionary = await prisma.dictionary.create({ data: {
      id: disposableDictionaryId, name: 'source-record-delete-fixture', sourceFilename: 'delete.source',
      fileChecksum: crypto.randomUUID(), storageKey: `source-record/${crypto.randomUUID()}`, status: 'ready',
      entries: { create: {
        id: disposableEntryId, headwordOriginal: 'delete', headwordNormalized: 'delete', sortKey: 'delete',
        entryPlainText: 'delete', sourceOrdinal: 0,
      } },
      sourceRecords: { create: {
        entryId: disposableEntryId, sourceKey: 'delete:0', sourceOrdinal: 0, recordKind: 'lexical',
        sourceIdentity: { ordinal: 0 }, rawPayload: 'delete payload', contentChecksum: '9'.repeat(64),
        artifacts: { create: {
          parserName: 'fixture-parser', parserVersion: '1.0.0', representationVersion: 1,
          representationChecksum: '8'.repeat(64),
        } },
      } },
    }, include: { sourceRecords: { include: { artifacts: true } } } });
    const sourceRecordId = dictionary.sourceRecords[0].id;
    const artifactId = dictionary.sourceRecords[0].artifacts[0].id;

    await prisma.dictionary.delete({ where: { id: disposableDictionaryId } });
    expect(await prisma.dictionaryEntry.findUnique({ where: { id: disposableEntryId } })).toBeNull();
    expect(await prisma.dictionarySourceRecord.findUnique({ where: { id: sourceRecordId } })).toBeNull();
    expect(await prisma.dictionarySourceArtifact.findUnique({ where: { id: artifactId } })).toBeNull();
  });
});
