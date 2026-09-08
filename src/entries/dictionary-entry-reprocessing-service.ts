import type { EntryKind, PrismaClient } from '@prisma/client';
import { entryPlainText, sanitizeEntryHtml } from './html.js';

export interface ReprocessedEntryContent {
  sanitizedHtml: string;
  plainText: string;
}

export interface ReprocessingFailure {
  entryId: string;
  sourceOrdinal: number;
  headword: string;
  message: string;
}

export interface ReprocessingProgress {
  processed: number;
  total: number;
  entriesChanged: number;
  sanitizedHtmlChanged: number;
  entryPlainTextChanged: number;
  unchanged: number;
  failed: number;
}

export interface ReprocessingSummary extends ReprocessingProgress {
  dictionaryId: string;
  dictionaryName: string;
  packageBacked: boolean;
  mode: 'dry-run' | 'apply';
  elapsedMs: number;
  failures: ReprocessingFailure[];
}

export interface ReprocessingOptions {
  apply?: boolean;
  batchSize?: number;
  onProgress?: (progress: ReprocessingProgress) => void;
}

export class DictionaryNotFoundForReprocessingError extends Error {}

export type EntryContentProcessor = (entryRaw: string, entryKind: EntryKind) => ReprocessedEntryContent;

interface ReprocessingRow {
  id: string;
  sourceOrdinal: number;
  headwordOriginal: string;
  entryKind: EntryKind;
  entryRaw: string;
  entrySanitizedHtml: string;
  entryPlainText: string;
}

export function reprocessEntryContent(entryRaw: string, entryKind: EntryKind): ReprocessedEntryContent {
  if (entryKind === 'redirect') return { sanitizedHtml: '', plainText: '' };
  const sanitizedHtml = sanitizeEntryHtml(entryRaw.replaceAll('\0', ''));
  return { sanitizedHtml, plainText: entryPlainText(sanitizedHtml) };
}

export class DictionaryEntryReprocessingService {
  constructor(
    private readonly database: PrismaClient,
    private readonly processContent: EntryContentProcessor = reprocessEntryContent,
  ) {}

  async reprocess(dictionaryId: string, options: ReprocessingOptions = {}): Promise<ReprocessingSummary> {
    const batchSize = options.batchSize ?? 500;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
      throw new RangeError('batchSize must be an integer between 1 and 5000');
    }
    const dictionary = await this.database.dictionary.findUnique({
      where: { id: dictionaryId }, select: { id: true, name: true, packageStorageKey: true },
    });
    if (!dictionary) throw new DictionaryNotFoundForReprocessingError(`Dictionary ${dictionaryId} was not found`);

    const total = await this.database.dictionaryEntry.count({ where: { dictionaryId } });
    const started = performance.now();
    const progress: ReprocessingProgress = {
      processed: 0, total, entriesChanged: 0, sanitizedHtmlChanged: 0,
      entryPlainTextChanged: 0, unchanged: 0, failed: 0,
    };
    const failures: ReprocessingFailure[] = [];
    let afterOrdinal: number | null = null;

    for (;;) {
      const rows: ReprocessingRow[] = await this.database.dictionaryEntry.findMany({
        where: {
          dictionaryId,
          ...(afterOrdinal === null ? {} : { sourceOrdinal: { gt: afterOrdinal } }),
        },
        orderBy: { sourceOrdinal: 'asc' }, take: batchSize,
        select: {
          id: true, sourceOrdinal: true, headwordOriginal: true, entryKind: true,
          entryRaw: true, entrySanitizedHtml: true, entryPlainText: true,
        },
      });
      if (rows.length === 0) break;
      afterOrdinal = rows[rows.length - 1].sourceOrdinal;

      const changes: Array<{
        row: ReprocessingRow; content: ReprocessedEntryContent;
        htmlChanged: boolean; plainTextChanged: boolean;
      }> = [];
      for (const row of rows) {
        progress.processed += 1;
        try {
          const content = this.processContent(row.entryRaw, row.entryKind);
          const htmlChanged = content.sanitizedHtml !== row.entrySanitizedHtml;
          const plainTextChanged = content.plainText !== row.entryPlainText;
          if (!htmlChanged && !plainTextChanged) {
            progress.unchanged += 1;
          } else {
            changes.push({ row, content, htmlChanged, plainTextChanged });
          }
        } catch (error) {
          recordFailure(progress, failures, row, error);
        }
      }

      if (options.apply && changes.length > 0) {
        try {
          await this.database.$transaction(changes.map(({ row, content }) =>
            this.database.dictionaryEntry.update({
              where: { id: row.id },
              data: { entrySanitizedHtml: content.sanitizedHtml, entryPlainText: content.plainText },
              select: { id: true },
            })));
        } catch (error) {
          for (const { row } of changes) recordFailure(progress, failures, row, error);
          changes.length = 0;
        }
      }

      for (const change of changes) {
        progress.entriesChanged += 1;
        if (change.htmlChanged) progress.sanitizedHtmlChanged += 1;
        if (change.plainTextChanged) progress.entryPlainTextChanged += 1;
      }
      options.onProgress?.({ ...progress });
    }

    return {
      ...progress,
      dictionaryId: dictionary.id,
      dictionaryName: dictionary.name,
      packageBacked: dictionary.packageStorageKey !== null,
      mode: options.apply ? 'apply' : 'dry-run',
      elapsedMs: performance.now() - started,
      failures,
    };
  }
}

function recordFailure(
  progress: ReprocessingProgress,
  failures: ReprocessingFailure[],
  row: { id: string; sourceOrdinal: number; headwordOriginal: string },
  error: unknown,
): void {
  progress.failed += 1;
  if (failures.length >= 100) return;
  failures.push({
    entryId: row.id,
    sourceOrdinal: row.sourceOrdinal,
    headword: row.headwordOriginal,
    message: (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500),
  });
}
