import crypto from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSortKey, normalizeHeadword } from '../src/entries/normalize.js';
import { createApiServer } from '../src/http/server.js';
import { DictionaryQueryService } from '../src/query/dictionary-query-service.js';

interface FixtureEntry {
  sourceRecordId: string;
  headword: string;
  forms: string[];
  entryDefinitions?: Array<{ text: string; ordinal: number }>;
  senses?: Array<{ ordinal: number; definitions: string[] }>;
}

function entryData(dictionaryId: string, sourceOrdinal: number, fixture: FixtureEntry): Prisma.DictionaryEntryCreateInput {
  return {
    dictionary: { connect: { id: dictionaryId } },
    headwordOriginal: fixture.headword,
    headwordNormalized: normalizeHeadword(fixture.headword),
    sortKey: makeSortKey(fixture.headword),
    entryRaw: null,
    entrySanitizedHtml: null,
    entryPlainText: [fixture.headword, ...fixture.forms, ...(fixture.entryDefinitions ?? []).map((item) => item.text),
      ...(fixture.senses ?? []).flatMap((sense) => sense.definitions)].join(' '),
    sourceOrdinal,
    sourceRecordId: fixture.sourceRecordId,
    structuredEntry: {
      create: {
        forms: { create: fixture.forms.map((text, ordinal) => ({
          text, normalizedText: normalizeHeadword(text), language: 'ja', kind: /^[\u3040-\u309fー]+$/u.test(text) ? 'kana' : 'kanji',
          tags: [], priorityTags: [], restrictions: [], ordinal,
        })) },
        entryDefinitions: { create: (fixture.entryDefinitions ?? []).map((definition) => ({
          ...definition, language: 'ja', source: 'tomoshi:jpn_defs', provenance: { sourceTable: 'jpn_defs' },
        })) },
        senses: { create: (fixture.senses ?? []).map((sense) => ({
          ordinal: sense.ordinal,
          sourceSenseOrdinal: sense.ordinal,
          partOfSpeech: ['fixture-pos'], domains: [], tags: [], notes: null,
          senseDefinitions: { create: sense.definitions.map((text, ordinal) => ({
            text, language: 'zh-CN', source: 'tomoshi:zh_defs', provenance: { sourceTable: 'zh_defs', sourceSenseOrdinal: sense.ordinal }, ordinal,
          })) },
        })) },
      },
    },
  };
}

describe('structured dictionary query and API', () => {
  const db = new PrismaClient();
  const service = new DictionaryQueryService(db);
  let server: FastifyInstance;
  let dictionaryId: string;
  let ambiguousEntryId: string;

  beforeAll(async () => {
    const dictionary = await db.dictionary.create({ data: {
      name: 'structured-query-fixture', sourceFilename: 'tomoshi-dict-open.db',
      fileChecksum: crypto.randomUUID(), storageKey: `structured-query-${crypto.randomUUID()}.sqlite`,
      status: 'ready', sourceFormat: 'tomoshi', sourceLanguage: 'ja', targetLanguages: ['ja', 'zh-CN'],
      contentModel: 'structured', entryCount: 4, importedAt: new Date(),
    } });
    dictionaryId = dictionary.id;

    const fixtures: FixtureEntry[] = [
      { sourceRecordId: '1358280', headword: '食べる', forms: ['食べる', '喰べる', 'たべる'], senses: [
        { ordinal: 0, definitions: ['吃'] }, { ordinal: 1, definitions: ['生活'] },
      ] },
      { sourceRecordId: '1567920', headword: '曖昧', forms: ['曖昧', 'あいまい'], entryDefinitions: [
        { text: 'はっきりしないこと。', ordinal: 0 }, { text: '確かでないさま。', ordinal: 1 },
      ], senses: [
        { ordinal: 0, definitions: ['含糊'] }, { ordinal: 1, definitions: ['可疑'] }, { ordinal: 2, definitions: ['不正当'] },
      ] },
      { sourceRecordId: '1596090', headword: '折角', forms: ['折角', 'せっかく', 'せっかくも'], senses: [
        { ordinal: 0, definitions: ['特意'] },
      ] },
      { sourceRecordId: 'fixture-sekkaku-2', headword: 'せっかく', forms: ['せっかく'], senses: [
        { ordinal: 0, definitions: ['难得'] },
      ] },
    ];
    for (let sourceOrdinal = 0; sourceOrdinal < fixtures.length; sourceOrdinal++) {
      const created = await db.dictionaryEntry.create({ data: entryData(dictionaryId, sourceOrdinal, fixtures[sourceOrdinal]) });
      if (fixtures[sourceOrdinal].sourceRecordId === '1567920') ambiguousEntryId = created.id;
    }
    server = await createApiServer(db);
  });

  afterAll(async () => {
    await server.close();
    await db.dictionary.delete({ where: { id: dictionaryId } });
    await db.$disconnect();
  });

  it('finds 食べる canonically and exposes every source-ordered form in detail', async () => {
    const results = await service.searchExact(dictionaryId, '食べる');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ sourceRecordId: '1358280', contentModel: 'structured', matchedForm: null }));

    const detail = await service.getEntry(results[0].id);
    expect(detail?.contentModel).toBe('structured');
    if (detail?.contentModel !== 'structured') throw new Error('Expected structured detail');
    expect(detail.forms.map((form) => form.text)).toEqual(['食べる', '喰べる', 'たべる']);
    expect(detail).not.toHaveProperty('sanitizedHtml');
  });

  it('finds the same entry through the たべる form and returns the matched form', async () => {
    const results = await service.searchExact(dictionaryId, 'たべる');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ sourceRecordId: '1358280', matchedForm: 'たべる' }));
  });

  it('preserves distinct せっかく entries while deduplicating multiple matching forms per entry', async () => {
    const results = await service.searchPrefix(dictionaryId, 'せっかく');
    expect(results.map((entry) => entry.sourceRecordId)).toEqual(['fixture-sekkaku-2', '1596090']);
    expect(new Set(results.map((entry) => entry.id)).size).toBe(results.length);
    const foldedAngle = results.find((entry) => entry.sourceRecordId === '1596090');
    expect(foldedAngle?.contentModel).toBe('structured');
    if (foldedAngle?.contentModel !== 'structured') throw new Error('Expected structured search result');
    expect(foldedAngle.matchedForm).toBe('せっかく');
  });

  it('returns 曖昧 definitions at their audited entry/sense levels and in source order', async () => {
    const detail = await service.getEntry(ambiguousEntryId);
    expect(detail?.contentModel).toBe('structured');
    if (detail?.contentModel !== 'structured') throw new Error('Expected structured detail');
    expect(detail.sourceRecordId).toBe('1567920');
    expect(detail.entryDefinitions).toHaveLength(2);
    expect(detail.entryDefinitions.every((definition) => definition.language === 'ja')).toBe(true);
    expect(detail.entryDefinitions[0]).toEqual(expect.objectContaining({
      source: 'tomoshi:jpn_defs', ordinal: 0, provenance: { sourceTable: 'jpn_defs' },
    }));
    expect(detail.senses.map((sense) => sense.sourceSenseOrdinal)).toEqual([0, 1, 2]);
    expect(detail.senses.map((sense) => sense.definitions.map((definition) => definition.text))).toEqual([['含糊'], ['可疑'], ['不正当']]);
    expect(detail.senses.flatMap((sense) => sense.definitions).every((definition) => definition.language === 'zh-CN')).toBe(true);
    expect(detail.senses[0].definitions[0]).toEqual(expect.objectContaining({
      source: 'tomoshi:zh_defs', ordinal: 0,
      provenance: { sourceTable: 'zh_defs', sourceSenseOrdinal: 0 },
    }));
  });

  it('paginates the ranked, deduplicated entry set deterministically', async () => {
    const all = await service.searchPrefix(dictionaryId, 'せ', { limit: 20, offset: 0 });
    const first = await service.searchPrefix(dictionaryId, 'せ', { limit: 1, offset: 0 });
    const second = await service.searchPrefix(dictionaryId, 'せ', { limit: 1, offset: 1 });
    const repeated = await service.searchPrefix(dictionaryId, 'せ', { limit: 20, offset: 0 });
    expect([...first, ...second].map((entry) => entry.id)).toEqual(all.map((entry) => entry.id));
    expect(repeated.map((entry) => entry.id)).toEqual(all.map((entry) => entry.id));
    expect(new Set(all.map((entry) => entry.id)).size).toBe(all.length);
  });

  it('serializes structured search/detail through the discriminated HTTP DTO', async () => {
    const search = await server.inject({ method: 'GET', url: `/api/dictionaries/${dictionaryId}/search?q=${encodeURIComponent('たべる')}` });
    expect(search.statusCode).toBe(200);
    expect(search.json().items[0]).toEqual(expect.objectContaining({ contentModel: 'structured', sourceRecordId: '1358280', matchedForm: 'たべる' }));

    const detail = await server.inject({ method: 'GET', url: `/api/entries/${ambiguousEntryId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(expect.objectContaining({ contentModel: 'structured', sourceRecordId: '1567920', forms: expect.any(Array), senses: expect.any(Array) }));
    expect(detail.json()).not.toHaveProperty('sanitizedHtml');
  });
});
