import { EntryKind, PrismaClient, type Prisma } from '@prisma/client';
import type { MdxParserAdapter } from '../mdx/types.js';
import type { JobQueue } from '../jobs/types.js';
import { normalizeHeadword, makeSortKey, parseRedirect } from '../entries/normalize.js';
import { entryPlainText, sanitizeEntryHtml } from '../entries/html.js';

export interface ImportSummary { entries: number; redirects: number; durationMs: number; entriesPerSecond: number; }
export class MdxImporter {
  constructor(private db: PrismaClient, private queue: JobQueue, private parser: MdxParserAdapter, private batchSize: number, private storagePathFor: (key: string) => string) {}
  async import(jobId: string): Promise<ImportSummary> {
    const started = performance.now();
    const job = await this.db.importJob.findUniqueOrThrow({ where: { id: jobId }, include: { dictionary: true } });
    try {
      const storagePath = this.storagePathFor(job.dictionary.storageKey);
      const metadata = await this.parser.inspect(storagePath);
      await this.db.dictionary.update({ where: { id: job.dictionaryId }, data: { status: 'importing', mdxFormatVersion: metadata.mdxVersion, sourceEncoding: metadata.encoding, headerMetadata: metadata.header as object, parserName: 'js-mdict', parserVersion: '6.0.6', entryCount: metadata.entryCount, failureSummary: null } });
      await this.queue.updateProgress(jobId, { current: 0, total: metadata.entryCount });
      let ordinal = 0, redirects = 0;
      let batch: Prisma.DictionaryEntryCreateManyInput[] = [];
      for await (const entry of this.parser.iterateEntries(storagePath)) {
        const rawEntry = entry.rawEntry.replaceAll('\0', '');
        const redirectTarget = entry.redirectTarget ?? parseRedirect(rawEntry);
        if (redirectTarget) redirects += 1;
        const sanitized = redirectTarget ? '' : sanitizeEntryHtml(rawEntry);
        batch.push({ dictionaryId: job.dictionaryId, headwordOriginal: entry.headword, headwordNormalized: normalizeHeadword(entry.headword), sortKey: makeSortKey(entry.headword), entryRaw: rawEntry, entrySanitizedHtml: sanitized, entryPlainText: redirectTarget ? '' : entryPlainText(sanitized), entryKind: redirectTarget ? EntryKind.redirect : EntryKind.definition, redirectTargetOriginal: redirectTarget, sourceOrdinal: ordinal++ });
        if (batch.length >= this.batchSize) { await this.db.dictionaryEntry.createMany({ data: batch }); batch = []; await this.queue.updateProgress(jobId, { current: ordinal, total: metadata.entryCount }); }
      }
      if (batch.length) await this.db.dictionaryEntry.createMany({ data: batch });
      const durationMs = performance.now() - started;
      await this.db.dictionary.update({ where: { id: job.dictionaryId }, data: { status: 'ready', entryCount: ordinal, importedAt: new Date() } });
      await this.queue.updateProgress(jobId, { current: ordinal, total: metadata.entryCount }); await this.queue.complete(jobId);
      return { entries: ordinal, redirects, durationMs, entriesPerSecond: ordinal / (durationMs / 1000) };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      await this.db.dictionary.update({ where: { id: job.dictionaryId }, data: { status: 'failed', failureSummary: message.slice(0, 8000) } });
      await this.queue.fail(jobId, { message }); throw error;
    }
  }
}
