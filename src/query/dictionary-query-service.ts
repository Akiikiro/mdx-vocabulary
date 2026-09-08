import type { EntryKind, Prisma, PrismaClient } from '@prisma/client';
import { normalizeHeadword } from '../entries/normalize.js';
import { classifyLazyDetailFailure, type ShadowFailureCategory } from './dictionary-detail-shadow-verifier.js';

export interface SearchEntryDTO {
  id: string;
  dictionaryId: string;
  headword: string;
  kind: EntryKind;
  plainText: string;
  redirectTarget: string | null;
  sourceOrdinal: number;
}

export interface EntryDetailDTO extends SearchEntryDTO {
  sanitizedHtml: string;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
}

const searchSelect = {
  id: true,
  dictionaryId: true,
  headwordOriginal: true,
  entryKind: true,
  entryPlainText: true,
  redirectTargetOriginal: true,
  sourceOrdinal: true,
} satisfies Prisma.DictionaryEntrySelect;

const detailSelect = {
  ...searchSelect,
  entrySanitizedHtml: true,
} satisfies Prisma.DictionaryEntrySelect;

type SearchRow = Prisma.DictionaryEntryGetPayload<{ select: typeof searchSelect }>;
type DetailRow = Prisma.DictionaryEntryGetPayload<{ select: typeof detailSelect }>;

export interface DictionaryDetailShadowHook {
  shouldVerify(entryId: string): boolean;
  verify(storedDetail: EntryDetailDTO, storedDurationMs: number): Promise<unknown>;
}

export interface LazyPrimaryDetailReader {
  getEntryFromPersistedLocator(entryId: string): Promise<{
    detail: EntryDetailDTO; parserWasCold: boolean | null;
    timings: { totalMs: number };
  } | null>;
}
export interface LazyPrimaryEvent {
  event: 'dictionary_detail_lazy_primary'; entryId: string; dictionaryId: string | null;
  source: 'lazy' | 'stored_fallback'; fallbackReason: ShadowFailureCategory | null;
  lazyDurationMs: number; storedFallbackDurationMs: number | null; cold: boolean | null;
}
export interface LazyPrimaryOptions { enabled: boolean; reader: LazyPrimaryDetailReader; observe?: (event: LazyPrimaryEvent) => void }

export function parseLazyDictionaryDetailEnabled(value: string | undefined): boolean {
  return value === undefined || value === 'true';
}

function pagination(options: SearchOptions): { take?: number; skip?: number } {
  const { limit, offset } = options;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new RangeError('limit must be a non-negative integer');
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new RangeError('offset must be a non-negative integer');
  }
  return { ...(limit === undefined ? {} : { take: limit }), ...(offset === undefined ? {} : { skip: offset }) };
}

function toSearchDTO(row: SearchRow, plainText = row.entryPlainText): SearchEntryDTO {
  return {
    id: row.id,
    dictionaryId: row.dictionaryId,
    headword: row.headwordOriginal,
    kind: row.entryKind,
    plainText,
    redirectTarget: row.redirectTargetOriginal,
    sourceOrdinal: row.sourceOrdinal,
  };
}

export class DictionaryQueryService {
  constructor(private readonly prisma: PrismaClient, private readonly detailShadow?: DictionaryDetailShadowHook, private readonly lazyPrimary?: LazyPrimaryOptions) {}

  async searchExact(
    dictionaryId: string,
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchEntryDTO[]> {
    const rows = await this.prisma.dictionaryEntry.findMany({
      where: { dictionaryId, headwordNormalized: normalizeHeadword(query) },
      orderBy: { sourceOrdinal: 'asc' },
      ...pagination(options),
      select: searchSelect,
    });
    return this.resolveSearchRedirects(rows);
  }

  async searchPrefix(
    dictionaryId: string,
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchEntryDTO[]> {
    const rows = await this.prisma.dictionaryEntry.findMany({
      where: { dictionaryId, headwordNormalized: { startsWith: normalizeHeadword(query) } },
      orderBy: [{ sortKey: 'asc' }, { sourceOrdinal: 'asc' }],
      ...pagination(options),
      select: searchSelect,
    });
    return this.resolveSearchRedirects(rows);
  }

  async getEntry(entryId: string): Promise<EntryDetailDTO | null> {
    if (this.lazyPrimary?.enabled) {
      const lazyStarted = performance.now();
      try {
        const lazy = await this.lazyPrimary.reader.getEntryFromPersistedLocator(entryId);
        if (!lazy) return null;
        this.lazyPrimary.observe?.({ event: 'dictionary_detail_lazy_primary', entryId, dictionaryId: lazy.detail.dictionaryId,
          source: 'lazy', fallbackReason: null, lazyDurationMs: performance.now() - lazyStarted, storedFallbackDurationMs: null, cold: lazy.parserWasCold });
        return lazy.detail;
      } catch (error) {
        const lazyDurationMs = performance.now() - lazyStarted; const storedStarted = performance.now();
        const stored = await this.getStoredEntry(entryId); const storedFallbackDurationMs = performance.now() - storedStarted;
        this.lazyPrimary.observe?.({ event: 'dictionary_detail_lazy_primary', entryId, dictionaryId: stored?.dictionaryId ?? null,
          source: 'stored_fallback', fallbackReason: classifyLazyDetailFailure(error), lazyDurationMs, storedFallbackDurationMs, cold: null });
        return stored;
      }
    }
    return this.getStoredEntryWithShadow(entryId);
  }

  private async getStoredEntryWithShadow(entryId: string): Promise<EntryDetailDTO | null> {
    const started = performance.now();
    const detail = await this.getStoredEntry(entryId);
    if (detail && this.detailShadow?.shouldVerify(entryId)) void this.detailShadow.verify(detail, performance.now() - started).catch(() => undefined);
    return detail;
  }

  private async getStoredEntry(entryId: string): Promise<EntryDetailDTO | null> {
    const row = await this.prisma.dictionaryEntry.findUnique({
      where: { id: entryId },
      select: detailSelect,
    });
    if (!row) return null;

    const target = await this.resolveDetailRedirect(row);
    const detail = {
      ...toSearchDTO(row, target?.entryPlainText ?? row.entryPlainText),
      sanitizedHtml: target?.entrySanitizedHtml ?? row.entrySanitizedHtml,
    };
    return detail;
  }

  private async resolveSearchRedirects(rows: SearchRow[]): Promise<SearchEntryDTO[]> {
    const targetNames = [...new Set(rows.flatMap((row) =>
      row.entryKind === 'redirect' && row.redirectTargetOriginal
        ? [normalizeHeadword(row.redirectTargetOriginal)]
        : [],
    ))];
    if (targetNames.length === 0 || rows.length === 0) return rows.map((row) => toSearchDTO(row));

    const targets = await this.prisma.dictionaryEntry.findMany({
      where: {
        dictionaryId: rows[0].dictionaryId,
        headwordNormalized: { in: targetNames },
      },
      orderBy: { sourceOrdinal: 'asc' },
      select: { headwordNormalized: true, entryPlainText: true },
    });
    const firstTargetByHeadword = new Map<string, string>();
    for (const target of targets) {
      if (!firstTargetByHeadword.has(target.headwordNormalized)) {
        firstTargetByHeadword.set(target.headwordNormalized, target.entryPlainText);
      }
    }

    return rows.map((row) => {
      const target = row.redirectTargetOriginal
        ? firstTargetByHeadword.get(normalizeHeadword(row.redirectTargetOriginal))
        : undefined;
      return toSearchDTO(row, target ?? row.entryPlainText);
    });
  }

  private async resolveDetailRedirect(row: DetailRow): Promise<DetailRow | null> {
    if (row.entryKind !== 'redirect' || !row.redirectTargetOriginal) return null;
    return this.prisma.dictionaryEntry.findFirst({
      where: {
        dictionaryId: row.dictionaryId,
        headwordNormalized: normalizeHeadword(row.redirectTargetOriginal),
      },
      orderBy: { sourceOrdinal: 'asc' },
      select: detailSelect,
    });
  }
}
