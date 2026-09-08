import type { EntryKind, Prisma, PrismaClient } from '@prisma/client';
import { normalizeHeadword } from './normalize.js';
import type { LazyMdxAdapter, MdxEntryLocator } from '../mdx/lazy-mdx-adapter.js';
import { mdxLocatorFromPersistedFields, persistedFieldsFromMdxLocator } from '../mdx/mdx-locator-persistence.js';

export interface LocatorBackfillFailure { entryId: string; sourceOrdinal: number; headword: string; message: string }
export interface LocatorBackfillProgress { processed: number; total: number; mappable: number; alreadyPopulated: number; written: number; mismatches: number; failures: number }
export interface LocatorBackfillSummary extends LocatorBackfillProgress {
  dictionaryId: string; dictionaryName: string; mode: 'dry-run' | 'apply'; collisions: number; elapsedMs: number; failureDetails: LocatorBackfillFailure[];
}
export interface LocatorBackfillOptions { apply?: boolean; batchSize?: number; onProgress?: (progress: LocatorBackfillProgress) => void }
export class DictionaryNotFoundForLocatorBackfillError extends Error {}

const locatorSelect = {
  mdxLocatorVersion: true, mdxLocatorFileChecksum: true, mdxLocatorKeyText: true,
  mdxLocatorKeyBlockIndex: true, mdxLocatorRecordStartOffset: true, mdxLocatorRecordEndOffset: true,
} as const;

type Row = {
  id: string; sourceOrdinal: number; headwordOriginal: string; headwordNormalized: string;
  entryKind: EntryKind; redirectTargetOriginal: string | null; entryRaw: string;
  mdxLocatorVersion: number | null; mdxLocatorFileChecksum: string | null; mdxLocatorKeyText: string | null;
  mdxLocatorKeyBlockIndex: number | null; mdxLocatorRecordStartOffset: bigint | null; mdxLocatorRecordEndOffset: bigint | null;
};

export class MdxLocatorBackfillService {
  constructor(private readonly database: PrismaClient, private readonly mdx: LazyMdxAdapter, private readonly pathForStorageKey: (key: string) => string) {}

  async backfill(dictionaryId: string, options: LocatorBackfillOptions = {}): Promise<LocatorBackfillSummary> {
    const batchSize = options.batchSize ?? 500;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new RangeError('batchSize must be between 1 and 5000');
    const dictionary = await this.database.dictionary.findUnique({ where: { id: dictionaryId }, select: { id: true, name: true, storageKey: true, fileChecksum: true } });
    if (!dictionary) throw new DictionaryNotFoundForLocatorBackfillError(`Dictionary ${dictionaryId} was not found`);
    const started = performance.now();
    const path = this.pathForStorageKey(dictionary.storageKey);
    const locators = await this.mdx.listEntryLocators(path, dictionary.fileChecksum);
    const collisions = locators.length - new Set(locators.map(serializeCollisionKey)).size;
    const total = await this.database.dictionaryEntry.count({ where: { dictionaryId } });
    const progress: LocatorBackfillProgress = { processed: 0, total, mappable: 0, alreadyPopulated: 0, written: 0, mismatches: 0, failures: 0 };
    const failureDetails: LocatorBackfillFailure[] = [];
    let afterOrdinal: number | null = null;
    for (;;) {
      const rows: Row[] = await this.database.dictionaryEntry.findMany({
        where: { dictionaryId, ...(afterOrdinal === null ? {} : { sourceOrdinal: { gt: afterOrdinal } }) },
        orderBy: { sourceOrdinal: 'asc' }, take: batchSize,
        select: { id: true, sourceOrdinal: true, headwordOriginal: true, headwordNormalized: true, entryKind: true, redirectTargetOriginal: true, entryRaw: true, ...locatorSelect },
      });
      if (!rows.length) break;
      afterOrdinal = rows.at(-1)!.sourceOrdinal;
      const writes: Prisma.PrismaPromise<unknown>[] = [];
      for (const row of rows) {
        progress.processed++;
        try {
          const expected = locators[row.sourceOrdinal];
          if (!expected) throw new Error('No MDX keyword item exists at sourceOrdinal');
          await validateMapping(this.mdx, path, dictionary.fileChecksum, row, expected);
          const persisted = mdxLocatorFromPersistedFields(row);
          if (persisted) {
            if (!sameLocator(persisted, expected)) throw new Error('Persisted MDX locator does not match the validated source record');
            progress.alreadyPopulated++;
          } else if (options.apply && collisions === 0) {
            writes.push(this.database.dictionaryEntry.update({ where: { id: row.id }, data: persistedFieldsFromMdxLocator(expected), select: { id: true } }));
          }
          progress.mappable++;
        } catch (error) {
          progress.mismatches++;
          progress.failures++;
          if (failureDetails.length < 100) failureDetails.push({ entryId: row.id, sourceOrdinal: row.sourceOrdinal, headword: row.headwordOriginal, message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
        }
      }
      if (writes.length) { await this.database.$transaction(writes); progress.written += writes.length; }
      options.onProgress?.({ ...progress });
    }
    return { ...progress, dictionaryId, dictionaryName: dictionary.name, mode: options.apply ? 'apply' : 'dry-run', collisions, elapsedMs: performance.now() - started, failureDetails };
  }
}

async function validateMapping(mdx: LazyMdxAdapter, path: string, checksum: string, row: Row, locator: MdxEntryLocator): Promise<void> {
  if (locator.fileChecksum !== checksum) throw new Error('Locator checksum does not match Dictionary.fileChecksum');
  if (locator.keyText !== row.headwordOriginal || normalizeHeadword(locator.keyText) !== row.headwordNormalized) throw new Error('MDX headword identity mismatch');
  const fetched = await mdx.fetchByLocator(path, checksum, locator);
  if (fetched.headword !== row.headwordOriginal || fetched.rawEntry !== row.entryRaw) throw new Error('MDX record content mismatch');
  if ((fetched.redirectTarget ? 'redirect' : 'definition') !== row.entryKind || fetched.redirectTarget !== row.redirectTargetOriginal) throw new Error('MDX redirect or entry kind mismatch');
}

function sameLocator(left: MdxEntryLocator, right: MdxEntryLocator): boolean { return serializeCollisionKey(left) === serializeCollisionKey(right); }
function serializeCollisionKey(locator: MdxEntryLocator): string { return JSON.stringify([locator.version, locator.fileChecksum, locator.keyText, locator.keyBlockIndex, locator.recordStartOffset.toString(), locator.recordEndOffset.toString()]); }
