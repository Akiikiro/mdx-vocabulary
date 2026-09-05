import type { EntryKind, Prisma, PrismaClient } from '@prisma/client';
import { normalizeHeadword } from '../entries/normalize.js';

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
  constructor(private readonly prisma: PrismaClient) {}

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
    const row = await this.prisma.dictionaryEntry.findUnique({
      where: { id: entryId },
      select: detailSelect,
    });
    if (!row) return null;

    const target = await this.resolveDetailRedirect(row);
    return {
      ...toSearchDTO(row, target?.entryPlainText ?? row.entryPlainText),
      sanitizedHtml: target?.entrySanitizedHtml ?? row.entrySanitizedHtml,
    };
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
