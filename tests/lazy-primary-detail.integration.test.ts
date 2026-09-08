import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DictionaryQueryService, parseLazyDictionaryDetailEnabled, type LazyPrimaryEvent } from '../src/query/dictionary-query-service.js';
import { LazyDictionaryDetailPocService, LazyDetailPipelineError } from '../src/query/lazy-dictionary-detail-poc-service.js';
import type { LazyMdxAdapter, MdxEntryLocator } from '../src/mdx/lazy-mdx-adapter.js';
import { MdxEntryNotFoundByLocatorError } from '../src/mdx/lazy-mdx-adapter.js';
import { persistedFieldsFromMdxLocator } from '../src/mdx/mdx-locator-persistence.js';
import { createApiServer } from '../src/http/server.js';

const checksum = '7'.repeat(64); const keys = ['same', 'same', 'redirect', 'target', '東京'];
const raw = ['<b>first</b>', '<i>second</i>', '@@@LINK=target', '<img src="/pic/猫.png">', '<a href="sound://Audio/日本語/東京.OGG"></a>'];
const locators: MdxEntryLocator[] = keys.map((keyText, i) => ({ version: 1, fileChecksum: checksum, keyText, keyBlockIndex: i, recordStartOffset: BigInt(i * 100), recordEndOffset: BigInt(i * 100 + 50) }));

describe('feature-flagged lazy primary detail', () => {
  const db = new PrismaClient(); let dictionaryId: string; let ids: string[]; let vocabularyId: string;
  const adapter: LazyMdxAdapter = { listEntryLocators: async () => locators, getEntryLocator: async (_p, _c, i) => locators[i] ?? null,
    fetchByLocator: async (_p, _c, locator) => { const i = locators.findIndex((x) => x.recordStartOffset === locator.recordStartOffset); if (i < 0) throw new Error('missing'); return { headword: keys[i], rawEntry: raw[i], redirectTarget: i === 2 ? 'target' : null }; }, close: () => {} };
  const lazy = () => new LazyDictionaryDetailPocService(db, adapter, (key) => `/not-logged/${key}`);
  beforeAll(async () => {
    const dictionary = await db.dictionary.create({ data: { name: 'lazy-primary', sourceFilename: 'fixture.mdx', storageKey: `lazy-primary-${crypto.randomUUID()}.mdx`, fileChecksum: checksum, status: 'ready' } }); dictionaryId = dictionary.id;
    const made = [];
    for (let i = 0; i < keys.length; i++) made.push(await db.dictionaryEntry.create({ data: { dictionaryId, headwordOriginal: keys[i], headwordNormalized: keys[i].toLocaleLowerCase('en-US'), sortKey: keys[i].toLocaleLowerCase('en-US'), sourceOrdinal: i, entryRaw: raw[i], entrySanitizedHtml: `stored-${i}`, entryPlainText: `plain-${i}`, entryKind: i === 2 ? 'redirect' : 'definition', redirectTargetOriginal: i === 2 ? 'target' : null, ...persistedFieldsFromMdxLocator(locators[i]) } }));
    ids = made.map((x) => x.id); vocabularyId = (await db.vocabularyItem.create({ data: { entryId: ids[1] } })).id;
  });
  afterAll(async () => { await db.dictionary.delete({ where: { id: dictionaryId } }); await db.$disconnect(); });

  it('parses the dedicated flag safely and defaults to stored behavior', async () => {
    expect(parseLazyDictionaryDetailEnabled(undefined)).toBe(false); expect(parseLazyDictionaryDetailEnabled('true')).toBe(true);
    expect(parseLazyDictionaryDetailEnabled('false')).toBe(false); expect(parseLazyDictionaryDetailEnabled('TRUE')).toBe(false); expect(parseLazyDictionaryDetailEnabled('1')).toBe(false); expect(parseLazyDictionaryDetailEnabled('')).toBe(false);
    const reader = { getEntryFromPersistedLocator: vi.fn() };
    expect((await new DictionaryQueryService(db, undefined, { enabled: false, reader }).getEntry(ids[0]))?.sanitizedHtml).toBe('stored-0');
    expect(reader.getEntryFromPersistedLocator).not.toHaveBeenCalled();
  });

  it('uses exact persisted locators for duplicate, redirect, and Unicode definitions without stored-content semantics', async () => {
    const events: LazyPrimaryEvent[] = []; const service = new DictionaryQueryService(db, undefined, { enabled: true, reader: lazy(), observe: (x) => events.push(x) });
    expect((await service.getEntry(ids[0]))?.sanitizedHtml).toBe('<b>first</b>'); expect((await service.getEntry(ids[1]))?.sanitizedHtml).toBe('<i>second</i>');
    expect((await service.getEntry(ids[2]))).toEqual(expect.objectContaining({ id: ids[2], kind: 'redirect', redirectTarget: 'target', sanitizedHtml: '<span data-mdict-kind="image" data-mdict-resource="pic/猫.png"></span>' }));
    expect((await service.getEntry(ids[4]))?.sanitizedHtml).toContain('Audio/日本語/東京.OGG');
    expect(events.every((x) => x.source === 'lazy' && x.fallbackReason === null)).toBe(true); expect(JSON.stringify(events)).not.toContain('/not-logged/'); expect(JSON.stringify(events)).not.toContain(raw[4]);
    expect((await db.vocabularyItem.findUniqueOrThrow({ where: { id: vocabularyId } })).entryId).toBe(ids[1]);
  });

  it('falls back and classifies missing, partial, and checksum-invalid locators', async () => {
    const check = async (data: Record<string, unknown>, reason: string) => { await db.dictionaryEntry.update({ where: { id: ids[0] }, data }); const events: LazyPrimaryEvent[] = []; const detail = await new DictionaryQueryService(db, undefined, { enabled: true, reader: lazy(), observe: (x) => events.push(x) }).getEntry(ids[0]); expect(detail?.sanitizedHtml).toBe('stored-0'); expect(events[0]).toEqual(expect.objectContaining({ source: 'stored_fallback', fallbackReason: reason })); };
    await check({ mdxLocatorVersion: null, mdxLocatorFileChecksum: null, mdxLocatorKeyText: null, mdxLocatorKeyBlockIndex: null, mdxLocatorRecordStartOffset: null, mdxLocatorRecordEndOffset: null }, 'missing_locator');
    await check({ ...persistedFieldsFromMdxLocator(locators[0]), mdxLocatorKeyText: null }, 'malformed_locator');
    await check({ ...persistedFieldsFromMdxLocator(locators[0]), mdxLocatorVersion: 2 }, 'malformed_locator');
    await check({ ...persistedFieldsFromMdxLocator(locators[0]), mdxLocatorFileChecksum: '6'.repeat(64) }, 'checksum_mismatch');
    await db.dictionaryEntry.update({ where: { id: ids[0] }, data: persistedFieldsFromMdxLocator(locators[0]) });
  });

  it('falls back for MDX and sanitizer failures with structured safe events', async () => {
    for (const [error, reason] of [[new MdxEntryNotFoundByLocatorError('read failed'), 'mdx_read'], [new LazyDetailPipelineError(new Error('unsafe raw secret')), 'sanitizer']] as const) {
      const events: LazyPrimaryEvent[] = []; const reader = { getEntryFromPersistedLocator: async () => { throw error; } };
      expect((await new DictionaryQueryService(db, undefined, { enabled: true, reader, observe: (x) => events.push(x) }).getEntry(ids[0]))?.sanitizedHtml).toBe('stored-0');
      expect(events[0]).toEqual(expect.objectContaining({ event: 'dictionary_detail_lazy_primary', source: 'stored_fallback', fallbackReason: reason }));
      expect(JSON.stringify(events[0])).not.toContain('unsafe raw secret');
    }
  });

  it('recovers on the next request after a transient lazy read failure', async () => {
    let broken = true; const events: LazyPrimaryEvent[] = []; const healthy = lazy();
    const reader = { getEntryFromPersistedLocator: async (id: string) => { if (broken) throw new MdxEntryNotFoundByLocatorError('isolated package unavailable'); return healthy.getEntryFromPersistedLocator(id); } };
    const service = new DictionaryQueryService(db, undefined, { enabled: true, reader, observe: (event) => events.push(event) });
    expect((await service.getEntry(ids[0]))?.sanitizedHtml).toBe('stored-0'); broken = false;
    expect((await service.getEntry(ids[0]))?.sanitizedHtml).toBe('<b>first</b>');
    expect(events.map((event) => [event.source, event.fallbackReason])).toEqual([['stored_fallback', 'mdx_read'], ['lazy', null]]);
  });

  it('does not run shadow when lazy primary is enabled and warmup is read-only', async () => {
    const shadow = { shouldVerify: vi.fn(() => true), verify: vi.fn() }; const service = new DictionaryQueryService(db, shadow, { enabled: true, reader: lazy() });
    await service.getEntry(ids[0]); expect(shadow.shouldVerify).not.toHaveBeenCalled(); expect(shadow.verify).not.toHaveBeenCalled();
    const before = await db.dictionaryEntry.findMany({ where: { dictionaryId }, orderBy: { sourceOrdinal: 'asc' } });
    await expect(lazy().warmupDictionary(dictionaryId)).resolves.toEqual(expect.objectContaining({ entries: 5 }));
    expect(await db.dictionaryEntry.findMany({ where: { dictionaryId }, orderBy: { sourceOrdinal: 'asc' } })).toEqual(before);
  });

  it('keeps the public HTTP status and DTO schema unchanged when enabled', async () => {
    const server = await createApiServer(db, { lazyPrimary: { enabled: true, reader: lazy() } });
    try {
      const response = await server.inject({ method: 'GET', url: `/api/entries/${ids[4]}` });
      expect(response.statusCode).toBe(200);
      expect(Object.keys(response.json()).sort()).toEqual(['dictionaryId', 'headword', 'id', 'kind', 'plainText', 'redirectTarget', 'sanitizedHtml', 'sourceOrdinal'].sort());
      expect(response.json().sanitizedHtml).toContain('Audio/日本語/東京.OGG');
      expect(response.json()).not.toHaveProperty('entryRaw'); expect(response.json()).not.toHaveProperty('locator');
    } finally { await server.close(); }
  });
});
