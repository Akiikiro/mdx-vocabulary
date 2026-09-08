import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DictionaryQueryService } from '../src/query/dictionary-query-service.js';
import { DictionaryDetailShadowVerifier, isDeterministicallySampled, parseShadowSampleRate, type DetailShadowResult } from '../src/query/dictionary-detail-shadow-verifier.js';
import { deterministicSample, LazyDetailDiagnosticService } from '../src/query/lazy-detail-diagnostic-service.js';
import { LazyDictionaryDetailPocService } from '../src/query/lazy-dictionary-detail-poc-service.js';
import type { LazyMdxAdapter, MdxEntryLocator } from '../src/mdx/lazy-mdx-adapter.js';
import { persistedFieldsFromMdxLocator } from '../src/mdx/mdx-locator-persistence.js';

const checksum = '9'.repeat(64);
const keys = ['same', 'same', '東京', 'redirect', 'target'];
const raw = ['<b>one</b>', '<i>two</i>', '<a href="sound://Audio/日本語/東京.OGG"></a>', '@@@LINK=target', '<strong>target</strong>'];
const locators: MdxEntryLocator[] = keys.map((keyText, index) => ({ version: 1, fileChecksum: checksum, keyText, keyBlockIndex: index, recordStartOffset: BigInt(index * 100), recordEndOffset: BigInt(index * 100 + 50) }));

describe('opt-in dictionary detail shadow verification', () => {
  const db = new PrismaClient(); let dictionaryId: string; let ids: string[];
  let overrideRaw: string | null = null;
  const adapter: LazyMdxAdapter = {
    listEntryLocators: async () => locators, getEntryLocator: async (_p, _c, ordinal) => locators[ordinal] ?? null,
    fetchByLocator: async (_p, _c, locator) => { const index = locators.findIndex((x) => x.recordStartOffset === locator.recordStartOffset); if (index < 0) throw new Error('missing'); return { headword: keys[index], rawEntry: overrideRaw ?? raw[index], redirectTarget: index === 3 ? 'target' : null }; }, close: () => {},
  };
  const lazy = () => new LazyDictionaryDetailPocService(db, adapter, (key) => `/hidden/${key}`);

  beforeAll(async () => {
    const dictionary = await db.dictionary.create({ data: { name: 'shadow', sourceFilename: 'shadow.mdx', storageKey: `shadow-${crypto.randomUUID()}.mdx`, fileChecksum: checksum, status: 'ready' } }); dictionaryId = dictionary.id;
    const created = [];
    for (let i = 0; i < keys.length; i++) created.push(await db.dictionaryEntry.create({ data: { dictionaryId, headwordOriginal: keys[i], headwordNormalized: keys[i].toLocaleLowerCase('en-US'), sortKey: keys[i].toLocaleLowerCase('en-US'), sourceOrdinal: i, entryRaw: raw[i], entrySanitizedHtml: `stored-${i}`, entryPlainText: `stored-plain-${i}`, entryKind: i === 3 ? 'redirect' : 'definition', redirectTargetOriginal: i === 3 ? 'target' : null, ...persistedFieldsFromMdxLocator(locators[i]) } }));
    ids = created.map((x) => x.id);
  });
  afterAll(async () => { await db.dictionary.delete({ where: { id: dictionaryId } }); await db.$disconnect(); });

  it('is disabled by default and has deterministic, safe sampling', async () => {
    let called = false; const hook = { shouldVerify: () => false, verify: async () => { called = true; } };
    expect((await new DictionaryQueryService(db, hook).getEntry(ids[0]))?.sanitizedHtml).toBe('stored-0');
    expect(called).toBe(false);
    expect(parseShadowSampleRate(undefined)).toBe(0); expect(parseShadowSampleRate('bad')).toBe(0); expect(parseShadowSampleRate('101')).toBe(0);
    expect(isDeterministicallySampled(ids[0], 0, 's')).toBe(false); expect(isDeterministicallySampled(ids[0], 100, 's')).toBe(true);
    expect(isDeterministicallySampled(ids[0], 37, 's')).toBe(isDeterministicallySampled(ids[0], 37, 's'));
    expect(deterministicSample([{ id: 'b', sourceOrdinal: 1 }, { id: 'a', sourceOrdinal: 0 }], 1, 'seed')).toEqual(deterministicSample([{ id: 'a', sourceOrdinal: 0 }, { id: 'b', sourceOrdinal: 1 }], 1, 'seed'));
  });

  it('returns stored detail unchanged while successful Unicode, duplicate, and redirect shadows report parity', async () => {
    for (const id of [ids[0], ids[1], ids[2], ids[3]]) {
      let resolve!: (value: DetailShadowResult) => void; const observed = new Promise<DetailShadowResult>((r) => { resolve = r; });
      const shadow = new DictionaryDetailShadowVerifier(db, lazy(), 100, 'test', resolve);
      const stored = await new DictionaryQueryService(db, shadow).getEntry(id);
      expect(stored?.sanitizedHtml).toMatch(/^stored-/u);
      const result = await observed; expect(result).toEqual(expect.objectContaining({ status: 'success', parity: true, failureCategory: null }));
      expect(JSON.stringify(result)).not.toContain('/hidden/'); expect(JSON.stringify(result)).not.toContain(raw[2]);
    }
  });

  it('classifies parity, missing locator, and checksum failures without breaking stored reads', async () => {
    const observeOnce = async (id: string) => { let resolve!: (value: DetailShadowResult) => void; const observed = new Promise<DetailShadowResult>((r) => { resolve = r; }); const detail = await new DictionaryQueryService(db, new DictionaryDetailShadowVerifier(db, lazy(), 100, 'x', resolve)).getEntry(id); return { detail, result: await observed }; };
    overrideRaw = '<u>different</u>'; let checked = await observeOnce(ids[0]); expect(checked.detail?.sanitizedHtml).toBe('stored-0'); expect(checked.result).toEqual(expect.objectContaining({ status: 'mismatch', htmlMismatch: true })); overrideRaw = null;
    await db.dictionaryEntry.update({ where: { id: ids[0] }, data: { mdxLocatorVersion: null, mdxLocatorFileChecksum: null, mdxLocatorKeyText: null, mdxLocatorKeyBlockIndex: null, mdxLocatorRecordStartOffset: null, mdxLocatorRecordEndOffset: null } });
    checked = await observeOnce(ids[0]); expect(checked.detail?.sanitizedHtml).toBe('stored-0'); expect(checked.result.failureCategory).toBe('missing_locator');
    await db.dictionaryEntry.update({ where: { id: ids[0] }, data: { ...persistedFieldsFromMdxLocator(locators[0]), mdxLocatorFileChecksum: '8'.repeat(64) } });
    checked = await observeOnce(ids[0]); expect(checked.result.failureCategory).toBe('checksum_mismatch');
    await db.dictionaryEntry.update({ where: { id: ids[0] }, data: persistedFieldsFromMdxLocator(locators[0]) });
  });

  it('runs a bounded, deterministic, zero-write diagnostic', async () => {
    const before = await db.dictionaryEntry.findMany({ where: { dictionaryId }, orderBy: { sourceOrdinal: 'asc' } });
    const shadow = new DictionaryDetailShadowVerifier(db, lazy());
    const summary = await new LazyDetailDiagnosticService(db, new DictionaryQueryService(db), shadow).run(dictionaryId, { sampleSize: 5, seed: 'fixed', concurrency: 2 });
    expect(summary).toEqual(expect.objectContaining({ sampleSize: 5, completeLocators: 5, success: 5, mismatch: 0, failure: 0, concurrency: 2 }));
    expect(await db.dictionaryEntry.findMany({ where: { dictionaryId }, orderBy: { sourceOrdinal: 'asc' } })).toEqual(before);
  });
});
