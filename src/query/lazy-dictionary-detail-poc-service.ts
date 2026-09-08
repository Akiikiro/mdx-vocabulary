import type { EntryKind, PrismaClient } from '@prisma/client';
import { entryPlainText, sanitizeEntryHtml } from '../entries/html.js';
import { normalizeHeadword } from '../entries/normalize.js';
import { serializeMdxLocator, type LazyMdxAdapter, type MdxEntryLocator } from '../mdx/lazy-mdx-adapter.js';
import { mdxLocatorFromPersistedFields } from '../mdx/mdx-locator-persistence.js';
import type { EntryDetailDTO } from './dictionary-query-service.js';

export interface LazyDetailPocResult {
  detail: EntryDetailDTO;
  locator: MdxEntryLocator;
  resolvedRedirectEntryId: string | null;
  parserWasCold: boolean | null;
  timings: { mappingMs: number; fetchMs: number; transformMs: number; totalMs: number };
}

export interface LazyDetailParityResult { identityEqual: boolean; sanitizedHtmlEqual: boolean; plainTextEqual: boolean; redirectEqual: boolean }

export interface MdxMappingAudit {
  dictionaryId: string;
  databaseEntries: number;
  mdxEntries: number;
  mapped: number;
  missingOrdinal: number;
  headwordMismatch: number;
  normalizedHeadwordMismatch: number;
  rawContentMismatch: number;
  entryKindMismatch: number;
  redirectTargetMismatch: number;
  duplicateLocator: number;
}

export class LazyDetailMappingError extends Error {}
export class LazyDetailPipelineError extends Error { constructor(readonly cause: unknown) { super('Lazy detail transformation/sanitization failed'); } }

interface MappingAuditRow {
  sourceOrdinal: number;
  headwordOriginal: string;
  headwordNormalized: string;
  entryKind: EntryKind;
  redirectTargetOriginal: string | null;
  entryRaw: string;
}

export class LazyDictionaryDetailPocService {
  constructor(
    private readonly database: PrismaClient,
    private readonly mdx: LazyMdxAdapter,
    private readonly pathForStorageKey: (storageKey: string) => string,
  ) {}

  async getEntry(entryId: string): Promise<LazyDetailPocResult | null> {
    return this.getEntryUsing(entryId, 'ordinal');
  }

  async getEntryFromPersistedLocator(entryId: string): Promise<LazyDetailPocResult | null> {
    return this.getEntryUsing(entryId, 'persisted');
  }

  async warmupDictionary(dictionaryId: string): Promise<{ entries: number; durationMs: number }> {
    const dictionary = await this.database.dictionary.findUnique({ where: { id: dictionaryId }, select: { storageKey: true, fileChecksum: true } });
    if (!dictionary) throw new LazyDetailMappingError('Dictionary not found');
    const started = performance.now();
    const entries = (await this.mdx.listEntryLocators(this.pathForStorageKey(dictionary.storageKey), dictionary.fileChecksum)).length;
    return { entries, durationMs: performance.now() - started };
  }

  async comparePersistedLocatorParity(entryId: string): Promise<LazyDetailParityResult | null> {
    const row = await this.database.dictionaryEntry.findUnique({ where: { id: entryId }, select: { dictionaryId: true, entryRaw: true, entryKind: true, redirectTargetOriginal: true, headwordOriginal: true } });
    if (!row) return null;
    const lazy = await this.getEntryFromPersistedLocator(entryId);
    if (!lazy) return null;
    let baselineRaw = row.entryRaw;
    if (row.entryKind === 'redirect' && row.redirectTargetOriginal) {
      const target = await this.database.dictionaryEntry.findFirst({
        where: { dictionaryId: row.dictionaryId, headwordNormalized: normalizeHeadword(row.redirectTargetOriginal) },
        orderBy: { sourceOrdinal: 'asc' }, select: { entryRaw: true, entryKind: true },
      });
      baselineRaw = target?.entryKind === 'definition' ? target.entryRaw : '';
    }
    const expectedHtml = baselineRaw ? sanitizeEntryHtml(baselineRaw) : '';
    const expectedPlain = expectedHtml ? entryPlainText(expectedHtml) : '';
    return { identityEqual: lazy.detail.headword === row.headwordOriginal, sanitizedHtmlEqual: lazy.detail.sanitizedHtml === expectedHtml, plainTextEqual: lazy.detail.plainText === expectedPlain, redirectEqual: lazy.detail.redirectTarget === row.redirectTargetOriginal };
  }

  private async getEntryUsing(entryId: string, locatorSource: 'ordinal' | 'persisted'): Promise<LazyDetailPocResult | null> {
    const started = performance.now();
    const row = await this.database.dictionaryEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true, dictionaryId: true, headwordOriginal: true, headwordNormalized: true,
        entryKind: true, redirectTargetOriginal: true, sourceOrdinal: true,
        mdxLocatorVersion: true, mdxLocatorFileChecksum: true, mdxLocatorKeyText: true,
        mdxLocatorKeyBlockIndex: true, mdxLocatorRecordStartOffset: true, mdxLocatorRecordEndOffset: true,
        dictionary: { select: { storageKey: true, fileChecksum: true } },
      },
    });
    if (!row) return null;
    const mdxPath = this.pathForStorageKey(row.dictionary.storageKey);
    const locator = locatorSource === 'persisted'
      ? requirePersistedLocator(mdxLocatorFromPersistedFields(row), row.dictionary.fileChecksum)
      : requireMappedLocator(await this.mdx.getEntryLocator(mdxPath, row.dictionary.fileChecksum, row.sourceOrdinal), row);
    const parserWasCold = this.mdx.isInitialized ? !this.mdx.isInitialized(mdxPath, row.dictionary.fileChecksum) : null;
    const mappedAt = performance.now();
    const source = await this.mdx.fetchByLocator(mdxPath, row.dictionary.fileChecksum, locator);
    validateFetchedIdentity(row, source.headword, source.redirectTarget);
    const fetchedAt = performance.now();

    let definition = source;
    let resolvedRedirectEntryId: string | null = null;
    if (row.entryKind === 'redirect' && row.redirectTargetOriginal) {
      const target = await this.database.dictionaryEntry.findFirst({
        where: { dictionaryId: row.dictionaryId, headwordNormalized: normalizeHeadword(row.redirectTargetOriginal) },
        orderBy: { sourceOrdinal: 'asc' },
        select: { id: true, sourceOrdinal: true, headwordOriginal: true, headwordNormalized: true, entryKind: true, redirectTargetOriginal: true,
          mdxLocatorVersion: true, mdxLocatorFileChecksum: true, mdxLocatorKeyText: true, mdxLocatorKeyBlockIndex: true,
          mdxLocatorRecordStartOffset: true, mdxLocatorRecordEndOffset: true },
      });
      if (target) {
        resolvedRedirectEntryId = target.id;
        const targetLocator = locatorSource === 'persisted'
          ? requirePersistedLocator(mdxLocatorFromPersistedFields(target), row.dictionary.fileChecksum)
          : requireMappedLocator(await this.mdx.getEntryLocator(mdxPath, row.dictionary.fileChecksum, target.sourceOrdinal), target);
        definition = await this.mdx.fetchByLocator(mdxPath, row.dictionary.fileChecksum, targetLocator);
      }
    }
    let sanitizedHtml: string; let plainText: string;
    try {
      sanitizedHtml = definition.redirectTarget ? '' : sanitizeEntryHtml(definition.rawEntry);
      plainText = definition.redirectTarget ? '' : entryPlainText(sanitizedHtml);
    } catch (error) { throw new LazyDetailPipelineError(error); }
    const finished = performance.now();
    return {
      detail: {
        id: row.id, dictionaryId: row.dictionaryId, headword: row.headwordOriginal,
        kind: row.entryKind, redirectTarget: row.redirectTargetOriginal,
        sourceOrdinal: row.sourceOrdinal, sanitizedHtml, plainText,
      },
      locator,
      resolvedRedirectEntryId,
      parserWasCold,
      timings: { mappingMs: mappedAt - started, fetchMs: fetchedAt - mappedAt, transformMs: finished - fetchedAt, totalMs: finished - started },
    };
  }

  async auditMapping(dictionaryId: string, batchSize = 500): Promise<MdxMappingAudit> {
    const dictionary = await this.database.dictionary.findUnique({
      where: { id: dictionaryId }, select: { id: true, storageKey: true, fileChecksum: true },
    });
    if (!dictionary) throw new LazyDetailMappingError('Dictionary not found');
    const mdxPath = this.pathForStorageKey(dictionary.storageKey);
    const locators = await this.mdx.listEntryLocators(mdxPath, dictionary.fileChecksum);
    const result: MdxMappingAudit = {
      dictionaryId, databaseEntries: await this.database.dictionaryEntry.count({ where: { dictionaryId } }),
      mdxEntries: locators.length, mapped: 0, missingOrdinal: 0, headwordMismatch: 0,
      normalizedHeadwordMismatch: 0, rawContentMismatch: 0, entryKindMismatch: 0,
      redirectTargetMismatch: 0, duplicateLocator: locators.length - new Set(locators.map(serializeMdxLocator)).size,
    };
    let cursor: number | null = null;
    for (;;) {
      const rows: MappingAuditRow[] = await this.database.dictionaryEntry.findMany({
        where: { dictionaryId, ...(cursor === null ? {} : { sourceOrdinal: { gt: cursor } }) },
        orderBy: { sourceOrdinal: 'asc' }, take: batchSize,
        select: {
          sourceOrdinal: true, headwordOriginal: true, headwordNormalized: true, entryKind: true,
          redirectTargetOriginal: true, entryRaw: true,
        },
      });
      if (!rows.length) break;
      cursor = rows.at(-1)!.sourceOrdinal;
      for (const row of rows) {
        const locator = locators[row.sourceOrdinal];
        if (!locator) { result.missingOrdinal++; continue; }
        if (locator.keyText !== row.headwordOriginal) result.headwordMismatch++;
        if (normalizeHeadword(locator.keyText) !== row.headwordNormalized) result.normalizedHeadwordMismatch++;
        const fetched = await this.mdx.fetchByLocator(mdxPath, dictionary.fileChecksum, locator);
        if (fetched.rawEntry !== row.entryRaw) result.rawContentMismatch++;
        const fetchedKind: EntryKind = fetched.redirectTarget ? 'redirect' : 'definition';
        if (fetchedKind !== row.entryKind) result.entryKindMismatch++;
        if (fetched.redirectTarget !== row.redirectTargetOriginal) result.redirectTargetMismatch++;
        result.mapped++;
      }
    }
    return result;
  }
}

function requirePersistedLocator(locator: MdxEntryLocator | null, checksum: string): MdxEntryLocator {
  if (!locator) throw new LazyDetailMappingError('Dictionary entry has no persisted MDX locator');
  if (locator.fileChecksum !== checksum) throw new LazyDetailMappingError('Persisted MDX locator checksum does not match Dictionary.fileChecksum');
  return locator;
}

function requireMappedLocator(
  locator: MdxEntryLocator | null,
  row: { sourceOrdinal: number; headwordOriginal: string; headwordNormalized: string },
): MdxEntryLocator {
  if (!locator || locator.keyText !== row.headwordOriginal || normalizeHeadword(locator.keyText) !== row.headwordNormalized) {
    throw new LazyDetailMappingError('Dictionary entry does not align with the immutable MDX key index');
  }
  return locator;
}

function validateFetchedIdentity(
  row: { headwordOriginal: string; entryKind: EntryKind; redirectTargetOriginal: string | null },
  fetchedHeadword: string,
  fetchedRedirect: string | null,
): void {
  if (fetchedHeadword !== row.headwordOriginal || (fetchedRedirect ? 'redirect' : 'definition') !== row.entryKind
    || fetchedRedirect !== row.redirectTargetOriginal) {
    throw new LazyDetailMappingError('Fetched MDX record does not match DictionaryEntry identity metadata');
  }
}
