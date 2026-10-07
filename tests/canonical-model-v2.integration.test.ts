import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ContentAnnotationKind,
  ContentBlockKind,
  ContentModel,
  ContentTextRole,
} from '@prisma/client';
import { prisma } from '../src/db.js';
import { DictionaryQueryService } from '../src/query/dictionary-query-service.js';

describe('canonical dictionary model v2', () => {
  const dictionaryId = crypto.randomUUID();
  const entryId = crypto.randomUUID();
  const otherEntryId = crypto.randomUUID();
  const senseId = crypto.randomUUID();
  const definitionBlockId = crypto.randomUUID();
  const exampleBlockId = crypto.randomUUID();
  const noteBlockId = crypto.randomUUID();
  const secondDefinitionBlockId = crypto.randomUUID();

  beforeAll(async () => {
    await prisma.dictionary.create({
      data: {
        id: dictionaryId,
        name: 'canonical-v2-fixture',
        sourceFilename: 'fixture.source',
        fileChecksum: crypto.randomUUID(),
        storageKey: `canonical-v2/${crypto.randomUUID()}`,
        status: 'ready',
        sourceFormat: 'fixture',
        sourceLanguage: 'ja',
        targetLanguages: ['zh-CN'],
        contentModel: ContentModel.structured,
        entries: {
          create: [
            {
              id: entryId,
              headwordOriginal: '学ぶ', headwordNormalized: '学ぶ', sortKey: '学ぶ',
              entryPlainText: '学ぶ 学习', sourceOrdinal: 0,
              structuredEntry: {
                create: {
                  senses: { create: { id: senseId, ordinal: 0, sourceSenseOrdinal: 0 } },
                },
              },
            },
            {
              id: otherEntryId,
              headwordOriginal: '別', headwordNormalized: '別', sortKey: '別',
              entryPlainText: '別', sourceOrdinal: 1,
              structuredEntry: { create: {} },
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.dictionary.delete({ where: { id: dictionaryId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('stores entry- and sense-level bilingual examples as semantic objects with ordered texts', async () => {
    await prisma.example.create({
      data: {
        structuredEntryId: entryId,
        ordinal: 0,
        source: 'fixture',
        provenance: { sourceRecord: 1 },
        texts: {
          create: [
            { language: 'ja', role: ContentTextRole.source, text: 'よく学ぶ。', ordinal: 0, source: 'fixture' },
            { language: 'zh-CN', role: ContentTextRole.translation, text: '认真学习。', ordinal: 1, source: 'fixture' },
          ],
        },
      },
    });
    await prisma.example.create({
      data: {
        structuredEntryId: entryId,
        senseId,
        ordinal: 1,
        source: 'fixture',
        texts: {
          create: [
            { language: 'ja', role: ContentTextRole.source, text: '歴史を学ぶ。', ordinal: 0, source: 'fixture' },
            { language: 'zh-CN', role: ContentTextRole.translation, text: '学习历史。', ordinal: 1, source: 'fixture' },
          ],
        },
      },
    });

    const examples = await prisma.example.findMany({
      where: { structuredEntryId: entryId }, orderBy: { ordinal: 'asc' },
      include: { texts: { orderBy: { ordinal: 'asc' } } },
    });
    expect(examples.map((example) => example.senseId)).toEqual([null, senseId]);
    expect(examples[0].texts.map((text) => [text.language, text.role, text.text])).toEqual([
      ['ja', 'source', 'よく学ぶ。'], ['zh-CN', 'translation', '认真学习。'],
    ]);
  });

  it('preserves heterogeneous and multilingual rich content order independently of insertion order', async () => {
    await prisma.contentBlock.createMany({
      data: [
        { id: noteBlockId, structuredEntryId: entryId, kind: ContentBlockKind.annotation, annotationKind: ContentAnnotationKind.note, ordinal: 2, source: 'fixture' },
        { id: secondDefinitionBlockId, structuredEntryId: entryId, kind: ContentBlockKind.definition, ordinal: 3, source: 'fixture' },
        { id: definitionBlockId, structuredEntryId: entryId, kind: ContentBlockKind.definition, ordinal: 0, source: 'fixture' },
        { id: exampleBlockId, structuredEntryId: entryId, kind: ContentBlockKind.example, ordinal: 1, source: 'fixture' },
      ],
    });
    await prisma.contentText.createMany({
      data: [
        { contentBlockId: definitionBlockId, language: 'zh-CN', role: ContentTextRole.definition, text: '学习。', ordinal: 1, source: 'fixture' },
        { contentBlockId: definitionBlockId, language: 'ja', role: ContentTextRole.definition, text: '知識を得る。', ordinal: 0, source: 'fixture' },
        { contentBlockId: noteBlockId, language: 'ja', role: ContentTextRole.body, text: '用法上の注記。', ordinal: 0, source: 'fixture' },
        { contentBlockId: secondDefinitionBlockId, language: 'ja', role: ContentTextRole.definition, text: '経験から得る。', ordinal: 0, source: 'fixture' },
      ],
    });
    await prisma.example.create({
      data: {
        structuredEntryId: entryId, ordinal: 2, source: 'fixture', contentBlockId: exampleBlockId,
        texts: { create: { language: 'ja', role: ContentTextRole.source, text: '学校で学ぶ。', ordinal: 0, source: 'fixture' } },
      },
    });

    const blocks = await prisma.contentBlock.findMany({
      where: { structuredEntryId: entryId, parentBlockId: null }, orderBy: { ordinal: 'asc' },
      include: { texts: { orderBy: { ordinal: 'asc' } }, example: true },
    });
    expect(blocks.map((block) => [block.ordinal, block.kind, block.annotationKind])).toEqual([
      [0, 'definition', null], [1, 'example', null], [2, 'annotation', 'note'], [3, 'definition', null],
    ]);
    expect(blocks[0].texts.map((text) => [text.language, text.text])).toEqual([['ja', '知識を得る。'], ['zh-CN', '学习。']]);
    expect(blocks[1].example).not.toBeNull();
  });

  it('supports generic annotation kinds, nested subdivisions, and raw fallback blocks', async () => {
    const kinds = [
      ContentAnnotationKind.grammar,
      ContentAnnotationKind.orthography,
      ContentAnnotationKind.usage,
      ContentAnnotationKind.caution,
      ContentAnnotationKind.expression,
      ContentAnnotationKind.etymology,
    ];
    const parent = await prisma.contentBlock.create({
      data: { structuredEntryId: otherEntryId, kind: ContentBlockKind.section, annotationKind: ContentAnnotationKind.grammar, ordinal: 0, source: 'fixture' },
    });
    await prisma.contentBlock.createMany({
      data: kinds.map((annotationKind, ordinal) => ({
        structuredEntryId: otherEntryId,
        kind: ContentBlockKind.annotation,
        annotationKind,
        ordinal: ordinal + 1,
        source: 'fixture',
      })),
    });
    await prisma.contentBlock.create({
      data: {
        structuredEntryId: otherEntryId, parentBlockId: parent.id,
        kind: ContentBlockKind.subdivision, ordinal: 0, source: 'fixture',
        texts: { create: { language: 'ja', role: ContentTextRole.body, text: '下位項目', ordinal: 0, source: 'fixture' } },
      },
    });
    const raw = await prisma.contentBlock.create({
      data: {
        structuredEntryId: otherEntryId, kind: ContentBlockKind.raw, ordinal: 7, source: 'fixture',
        provenance: { reason: 'unclassified' },
        texts: { create: { language: null, role: ContentTextRole.other, text: 'unclassified source text', ordinal: 0, source: 'fixture' } },
      },
      include: { texts: true },
    });

    const annotations = await prisma.contentBlock.findMany({
      where: { structuredEntryId: otherEntryId, kind: ContentBlockKind.annotation }, orderBy: { ordinal: 'asc' },
    });
    expect(annotations.map((block) => block.annotationKind)).toEqual(kinds);
    expect(raw.texts[0]).toMatchObject({ language: null, text: 'unclassified source text' });
  });

  it('stores private versioned source artifacts without changing the public detail DTO', async () => {
    const artifact = await prisma.entrySourceArtifact.create({
      data: {
        entryId,
        sourceFormat: 'fixture-format',
        sourceIdentity: { ordinal: 0, offset: '100', size: 20 },
        parserName: 'fixture-parser',
        parserVersion: '1.0.0',
        representationVersion: 1,
        rawPayload: 'lossless source payload',
        parsedRepresentation: { kind: 'entry', nodes: [] },
        diagnostics: [{ code: 'fixture-diagnostic' }],
        sourceMetadata: { sourceMarker: 'private-only' },
        contentChecksum: 'a'.repeat(64),
      },
    });
    expect(artifact.rawPayload).toBe('lossless source payload');

    const detail = await new DictionaryQueryService(prisma).getEntry(entryId);
    expect(detail).not.toHaveProperty('sourceArtifacts');
    expect(detail).not.toHaveProperty('rawPayload');
  });

  it('enforces same-entry scope and stable sibling ordinals in the database', async () => {
    await expect(prisma.example.create({
      data: { structuredEntryId: otherEntryId, senseId, ordinal: 99, source: 'invalid-cross-entry' },
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.contentBlock.create({
      data: {
        structuredEntryId: otherEntryId, parentBlockId: definitionBlockId,
        kind: ContentBlockKind.subdivision, ordinal: 99, source: 'invalid-cross-entry',
      },
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.contentBlock.create({
      data: { structuredEntryId: entryId, kind: ContentBlockKind.raw, ordinal: 0, source: 'duplicate-root-ordinal' },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps existing VocabularyItem ownership attached to DictionaryEntry', async () => {
    const item = await prisma.vocabularyItem.create({ data: { entryId }, include: { entry: true } });
    expect(item.entry.id).toBe(entryId);
    expect(item.entry.dictionaryId).toBe(dictionaryId);
  });
});
