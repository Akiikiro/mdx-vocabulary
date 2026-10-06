import { Prisma, type EntryKind, type PrismaClient } from '@prisma/client';
import { normalizeHeadword } from '../entries/normalize.js';
import { classifyLazyDetailFailure, type ShadowFailureCategory } from './dictionary-detail-shadow-verifier.js';

export interface EntryIdentityDTO {
  id: string;
  dictionaryId: string;
  headword: string;
  kind: EntryKind;
  plainText: string;
  redirectTarget: string | null;
  sourceOrdinal: number;
  sourceRecordId: string | null;
}

export interface HtmlSearchEntryDTO extends EntryIdentityDTO { contentModel: 'html' }
export interface StructuredSearchEntryDTO extends EntryIdentityDTO { contentModel: 'structured'; matchedForm: string | null }
export type SearchEntryDTO = HtmlSearchEntryDTO | StructuredSearchEntryDTO;

export interface HtmlEntryDetailDTO extends EntryIdentityDTO { contentModel: 'html'; sanitizedHtml: string }
export interface StructuredFormDTO {
  text: string; language: string; kind: string | null; tags: string[]; priorityTags: string[];
  restrictions: string[]; ordinal: number;
}
export interface StructuredDefinitionDTO {
  text: string; language: string; source: string; provenance: Prisma.JsonValue | null; ordinal: number;
}
export interface StructuredSenseDTO {
  ordinal: number; sourceSenseOrdinal: number | null; partOfSpeech: string[]; domains: string[];
  tags: string[]; notes: string | null; definitions: StructuredDefinitionDTO[];
}
export interface StructuredEntryDetailDTO extends EntryIdentityDTO {
  contentModel: 'structured'; forms: StructuredFormDTO[]; entryDefinitions: StructuredDefinitionDTO[]; senses: StructuredSenseDTO[];
}
export type EntryDetailDTO = HtmlEntryDetailDTO | StructuredEntryDetailDTO;

export interface SearchOptions { limit?: number; offset?: number }

const searchSelect = {
  id: true, dictionaryId: true, headwordOriginal: true, entryKind: true, entryPlainText: true,
  redirectTargetOriginal: true, sourceOrdinal: true, sourceRecordId: true,
} satisfies Prisma.DictionaryEntrySelect;
const htmlDetailSelect = {
  ...searchSelect, entrySanitizedHtml: true,
  dictionary: { select: { sourceFormat: true, contentModel: true } },
} satisfies Prisma.DictionaryEntrySelect;
type SearchRow = Prisma.DictionaryEntryGetPayload<{ select: typeof searchSelect }>;
type HtmlDetailRow = Prisma.DictionaryEntryGetPayload<{ select: typeof htmlDetailSelect }>;
interface StructuredSearchRow extends SearchRow { matchedForm: string | null }

export interface DictionaryDetailShadowHook {
  shouldVerify(entryId: string): boolean;
  verify(storedDetail: HtmlEntryDetailDTO, storedDurationMs: number): Promise<unknown>;
}
export interface LazyPrimaryDetailReader {
  getEntryFromPersistedLocator(entryId: string): Promise<{
    detail: HtmlEntryDetailDTO; parserWasCold: boolean | null; timings: { totalMs: number };
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

function pagination(options: SearchOptions): { limit: number | null; offset: number } {
  const { limit, offset } = options;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) throw new RangeError('limit must be a non-negative integer');
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) throw new RangeError('offset must be a non-negative integer');
  return { limit: limit ?? null, offset: offset ?? 0 };
}
function htmlPagination(options: SearchOptions): { take?: number; skip?: number } {
  const { limit, offset } = pagination(options);
  return { ...(limit === null ? {} : { take: limit }), ...(offset === 0 ? {} : { skip: offset }) };
}
function toIdentityDTO(row: SearchRow, plainText = row.entryPlainText): EntryIdentityDTO {
  return {
    id: row.id, dictionaryId: row.dictionaryId, headword: row.headwordOriginal, kind: row.entryKind,
    plainText, redirectTarget: row.redirectTargetOriginal, sourceOrdinal: row.sourceOrdinal, sourceRecordId: row.sourceRecordId,
  };
}
function toHtmlSearchDTO(row: SearchRow, plainText = row.entryPlainText): HtmlSearchEntryDTO {
  return { ...toIdentityDTO(row, plainText), contentModel: 'html' };
}
function toStructuredSearchDTO(row: StructuredSearchRow): StructuredSearchEntryDTO {
  return { ...toIdentityDTO(row), contentModel: 'structured', matchedForm: row.matchedForm };
}
function escapeLikePrefix(value: string): string { return `${value.replace(/[\\%_]/gu, '\\$&')}%`; }

export class DictionaryQueryService {
  constructor(private readonly prisma: PrismaClient, private readonly detailShadow?: DictionaryDetailShadowHook, private readonly lazyPrimary?: LazyPrimaryOptions) {}

  async searchExact(dictionaryId: string, query: string, options: SearchOptions = {}): Promise<SearchEntryDTO[]> {
    return await this.dictionaryContentModel(dictionaryId) === 'structured'
      ? this.searchStructured(dictionaryId, query, options, false)
      : this.searchHtmlExact(dictionaryId, query, options);
  }

  async searchPrefix(dictionaryId: string, query: string, options: SearchOptions = {}): Promise<SearchEntryDTO[]> {
    return await this.dictionaryContentModel(dictionaryId) === 'structured'
      ? this.searchStructured(dictionaryId, query, options, true)
      : this.searchHtmlPrefix(dictionaryId, query, options);
  }

  async getEntry(entryId: string): Promise<EntryDetailDTO | null> {
    const entry = await this.prisma.dictionaryEntry.findUnique({
      where: { id: entryId }, select: { dictionary: { select: { sourceFormat: true, contentModel: true } } },
    });
    if (!entry) return null;
    if (entry.dictionary.contentModel === 'structured') return this.getStructuredEntry(entryId);

    const isMdxHtml = entry.dictionary.sourceFormat === 'mdx' && entry.dictionary.contentModel === 'html';
    if (isMdxHtml && this.lazyPrimary?.enabled) {
      const lazyStarted = performance.now();
      try {
        const lazy = await this.lazyPrimary.reader.getEntryFromPersistedLocator(entryId);
        if (!lazy) return null;
        this.lazyPrimary.observe?.({ event: 'dictionary_detail_lazy_primary', entryId, dictionaryId: lazy.detail.dictionaryId,
          source: 'lazy', fallbackReason: null, lazyDurationMs: performance.now() - lazyStarted, storedFallbackDurationMs: null, cold: lazy.parserWasCold });
        return lazy.detail;
      } catch (error) {
        const lazyDurationMs = performance.now() - lazyStarted; const storedStarted = performance.now();
        const stored = await this.getStoredHtmlEntry(entryId); const storedFallbackDurationMs = performance.now() - storedStarted;
        this.lazyPrimary.observe?.({ event: 'dictionary_detail_lazy_primary', entryId, dictionaryId: stored?.dictionaryId ?? null,
          source: 'stored_fallback', fallbackReason: classifyLazyDetailFailure(error), lazyDurationMs, storedFallbackDurationMs, cold: null });
        return stored;
      }
    }
    return this.getStoredHtmlEntryWithShadow(entryId, isMdxHtml);
  }

  private async dictionaryContentModel(dictionaryId: string): Promise<'html' | 'structured'> {
    const dictionary = await this.prisma.dictionary.findUnique({ where: { id: dictionaryId }, select: { contentModel: true } });
    return dictionary?.contentModel ?? 'html';
  }

  private async searchHtmlExact(dictionaryId: string, query: string, options: SearchOptions): Promise<HtmlSearchEntryDTO[]> {
    const rows = await this.prisma.dictionaryEntry.findMany({
      where: { dictionaryId, headwordNormalized: normalizeHeadword(query) }, orderBy: { sourceOrdinal: 'asc' },
      ...htmlPagination(options), select: searchSelect,
    });
    return this.resolveHtmlSearchRedirects(rows);
  }

  private async searchHtmlPrefix(dictionaryId: string, query: string, options: SearchOptions): Promise<HtmlSearchEntryDTO[]> {
    const rows = await this.prisma.dictionaryEntry.findMany({
      where: { dictionaryId, headwordNormalized: { startsWith: normalizeHeadword(query) } },
      orderBy: [{ sortKey: 'asc' }, { sourceOrdinal: 'asc' }], ...htmlPagination(options), select: searchSelect,
    });
    return this.resolveHtmlSearchRedirects(rows);
  }

  private async searchStructured(dictionaryId: string, query: string, options: SearchOptions, includePrefix: boolean): Promise<StructuredSearchEntryDTO[]> {
    const normalized = normalizeHeadword(query);
    const { limit, offset } = pagination(options);
    const prefix = escapeLikePrefix(normalized);
    const prefixCandidates = includePrefix ? Prisma.sql`
      UNION ALL
      SELECT e.id AS entry_id, 2 AS match_rank, NULL::text AS matched_form, NULL::integer AS matched_form_ordinal
      FROM dictionary_entries e
      WHERE e.dictionary_id = ${dictionaryId}::uuid
        AND e.headword_normalized LIKE ${prefix} ESCAPE '\\'
        AND e.headword_normalized <> ${normalized}
      UNION ALL
      SELECT e.id AS entry_id, 3 AS match_rank, f.text AS matched_form, f.ordinal AS matched_form_ordinal
      FROM structured_forms f
      JOIN dictionary_entries e ON e.id = f.structured_entry_id
      WHERE e.dictionary_id = ${dictionaryId}::uuid
        AND f.normalized_text LIKE ${prefix} ESCAPE '\\'
        AND f.normalized_text <> ${normalized}
    ` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<StructuredSearchRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT e.id AS entry_id, 0 AS match_rank, NULL::text AS matched_form, NULL::integer AS matched_form_ordinal
        FROM dictionary_entries e
        WHERE e.dictionary_id = ${dictionaryId}::uuid AND e.headword_normalized = ${normalized}
        UNION ALL
        SELECT e.id AS entry_id, 1 AS match_rank, f.text AS matched_form, f.ordinal AS matched_form_ordinal
        FROM structured_forms f
        JOIN dictionary_entries e ON e.id = f.structured_entry_id
        WHERE e.dictionary_id = ${dictionaryId}::uuid AND f.normalized_text = ${normalized}
        ${prefixCandidates}
      ), ranked AS (
        SELECT candidates.*,
          row_number() OVER (PARTITION BY entry_id ORDER BY match_rank, matched_form_ordinal NULLS FIRST, matched_form NULLS FIRST) AS entry_match_number
        FROM candidates
      )
      SELECT e.id, e.dictionary_id AS "dictionaryId", e.headword_original AS "headwordOriginal",
        e.entry_kind AS "entryKind", e.entry_plain_text AS "entryPlainText",
        e.redirect_target_original AS "redirectTargetOriginal", e.source_ordinal AS "sourceOrdinal",
        e.source_record_id AS "sourceRecordId", ranked.matched_form AS "matchedForm"
      FROM ranked
      JOIN dictionary_entries e ON e.id = ranked.entry_id
      WHERE ranked.entry_match_number = 1
      ORDER BY ranked.match_rank, e.sort_key, e.source_ordinal, e.id
      LIMIT ${limit} OFFSET ${offset}
    `);
    return rows.map(toStructuredSearchDTO);
  }

  private async getStoredHtmlEntryWithShadow(entryId: string, allowShadow: boolean): Promise<HtmlEntryDetailDTO | null> {
    const started = performance.now();
    const detail = await this.getStoredHtmlEntry(entryId);
    if (allowShadow && detail && this.detailShadow?.shouldVerify(entryId)) {
      void this.detailShadow.verify(detail, performance.now() - started).catch(() => undefined);
    }
    return detail;
  }

  private async getStoredHtmlEntry(entryId: string): Promise<HtmlEntryDetailDTO | null> {
    const row = await this.prisma.dictionaryEntry.findUnique({ where: { id: entryId }, select: htmlDetailSelect });
    if (!row) return null;
    const target = await this.resolveDetailRedirect(row);
    const content = target ?? row;
    if (content.dictionary.contentModel !== 'html' || content.entrySanitizedHtml === null) {
      throw new Error('Dictionary entry does not have HTML detail content');
    }
    return { ...toIdentityDTO(row, target?.entryPlainText ?? row.entryPlainText), contentModel: 'html', sanitizedHtml: content.entrySanitizedHtml };
  }

  private async getStructuredEntry(entryId: string): Promise<StructuredEntryDetailDTO | null> {
    const row = await this.prisma.dictionaryEntry.findUnique({
      where: { id: entryId },
      select: {
        ...searchSelect, dictionary: { select: { contentModel: true } },
        structuredEntry: { select: {
          forms: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }], select: {
            text: true, language: true, kind: true, tags: true, priorityTags: true, restrictions: true, ordinal: true,
          } },
          entryDefinitions: { orderBy: [{ source: 'asc' }, { language: 'asc' }, { ordinal: 'asc' }, { id: 'asc' }], select: {
            text: true, language: true, source: true, provenance: true, ordinal: true,
          } },
          senses: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }], select: {
            ordinal: true, sourceSenseOrdinal: true, partOfSpeech: true, domains: true, tags: true, notes: true,
            senseDefinitions: { orderBy: [{ source: 'asc' }, { language: 'asc' }, { ordinal: 'asc' }, { id: 'asc' }], select: {
              text: true, language: true, source: true, provenance: true, ordinal: true,
            } },
          } },
        } },
      },
    });
    if (!row) return null;
    if (row.dictionary.contentModel !== 'structured' || !row.structuredEntry) throw new Error('Dictionary entry does not have structured detail content');
    return {
      ...toIdentityDTO(row), contentModel: 'structured', forms: row.structuredEntry.forms,
      entryDefinitions: row.structuredEntry.entryDefinitions,
      senses: row.structuredEntry.senses.map((sense) => ({
        ordinal: sense.ordinal, sourceSenseOrdinal: sense.sourceSenseOrdinal, partOfSpeech: sense.partOfSpeech,
        domains: sense.domains, tags: sense.tags, notes: sense.notes, definitions: sense.senseDefinitions,
      })),
    };
  }

  private async resolveHtmlSearchRedirects(rows: SearchRow[]): Promise<HtmlSearchEntryDTO[]> {
    const targetNames = [...new Set(rows.flatMap((row) => row.entryKind === 'redirect' && row.redirectTargetOriginal
      ? [normalizeHeadword(row.redirectTargetOriginal)] : []))];
    if (targetNames.length === 0 || rows.length === 0) return rows.map((row) => toHtmlSearchDTO(row));
    const targets = await this.prisma.dictionaryEntry.findMany({
      where: { dictionaryId: rows[0].dictionaryId, headwordNormalized: { in: targetNames } },
      orderBy: { sourceOrdinal: 'asc' }, select: { headwordNormalized: true, entryPlainText: true },
    });
    const firstTargetByHeadword = new Map<string, string>();
    for (const target of targets) if (!firstTargetByHeadword.has(target.headwordNormalized)) firstTargetByHeadword.set(target.headwordNormalized, target.entryPlainText);
    return rows.map((row) => {
      const target = row.redirectTargetOriginal ? firstTargetByHeadword.get(normalizeHeadword(row.redirectTargetOriginal)) : undefined;
      return toHtmlSearchDTO(row, target ?? row.entryPlainText);
    });
  }

  private async resolveDetailRedirect(row: HtmlDetailRow): Promise<HtmlDetailRow | null> {
    if (row.entryKind !== 'redirect' || !row.redirectTargetOriginal) return null;
    return this.prisma.dictionaryEntry.findFirst({
      where: { dictionaryId: row.dictionaryId, headwordNormalized: normalizeHeadword(row.redirectTargetOriginal) },
      orderBy: { sourceOrdinal: 'asc' }, select: htmlDetailSelect,
    });
  }
}
