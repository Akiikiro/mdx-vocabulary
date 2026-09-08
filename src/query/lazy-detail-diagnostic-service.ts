import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { DictionaryQueryService } from './dictionary-query-service.js';
import type { DetailShadowResult, DictionaryDetailShadowVerifier, ShadowFailureCategory } from './dictionary-detail-shadow-verifier.js';

export interface LatencyStats { average: number; median: number; p95: number; p99: number; max: number }
export interface LazyDetailDiagnosticSummary {
  dictionaryId: string; dictionaryName: string; dictionaryEntries: number; completeLocators: number; sampleSize: number; seed: string; concurrency: number;
  success: number; mismatch: number; failure: number; failureCategories: Record<string, number>;
  cold: DetailShadowResult | null; storedMs: LatencyStats | null; lazyTotalMs: LatencyStats | null;
  locatorMs: LatencyStats | null; mdxFetchMs: LatencyStats | null; transformMs: LatencyStats | null; shadowOverheadMs: LatencyStats | null; elapsedMs: number;
}

export class LazyDetailDiagnosticService {
  constructor(private readonly database: PrismaClient, private readonly stored: DictionaryQueryService, private readonly shadow: DictionaryDetailShadowVerifier) {}

  async run(dictionaryId: string, options: { sampleSize?: number; all?: boolean; seed?: string; concurrency?: number } = {}): Promise<LazyDetailDiagnosticSummary> {
    const seed = options.seed ?? 'default'; const concurrency = options.concurrency ?? 2;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new RangeError('concurrency must be between 1 and 8');
    const dictionary = await this.database.dictionary.findUnique({ where: { id: dictionaryId }, select: { name: true } });
    if (!dictionary) throw new Error('Dictionary not found');
    const candidates = await this.database.dictionaryEntry.findMany({ where: { dictionaryId }, select: { id: true, sourceOrdinal: true, mdxLocatorVersion: true,
      mdxLocatorFileChecksum: true, mdxLocatorKeyText: true, mdxLocatorKeyBlockIndex: true, mdxLocatorRecordStartOffset: true, mdxLocatorRecordEndOffset: true } });
    const requested = options.all ? candidates.length : options.sampleSize ?? 1000;
    if (!Number.isInteger(requested) || requested < 1) throw new RangeError('sampleSize must be positive');
    const selected = deterministicSample(candidates, Math.min(requested, candidates.length), seed);
    const completeLocators = candidates.filter(hasCompleteLocator).length;
    const started = performance.now(); const results: DetailShadowResult[] = [];
    const verifyOne = async (entryId: string) => {
      const storedAt = performance.now(); const detail = await this.stored.getEntry(entryId); const storedDuration = performance.now() - storedAt;
      if (!detail) throw new Error('Sampled DictionaryEntry was not found');
      results.push(await this.shadow.verifyNow(detail, storedDuration));
    };
    if (selected[0]) await verifyOne(selected[0].id);
    let next = 1;
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(0, selected.length - 1)) }, async () => {
      for (;;) { const index = next++; if (index >= selected.length) return; await verifyOne(selected[index].id); }
    }));
    const cold = results[0] ?? null; const warm = results.slice(1); const failureCategories: Record<string, number> = {};
    for (const result of results) if (result.failureCategory) failureCategories[result.failureCategory] = (failureCategories[result.failureCategory] ?? 0) + 1;
    return { dictionaryId, dictionaryName: dictionary.name, dictionaryEntries: candidates.length, completeLocators, sampleSize: results.length, seed, concurrency,
      success: results.filter((x) => x.status === 'success').length, mismatch: results.filter((x) => x.status === 'mismatch').length,
      failure: results.filter((x) => x.status === 'failure').length, failureCategories, cold,
      storedMs: stats(warm.map((x) => x.storedDurationMs)), lazyTotalMs: stats(present(warm.map((x) => x.lazyDurationMs))),
      locatorMs: stats(present(warm.map((x) => x.locatorDurationMs))), mdxFetchMs: stats(present(warm.map((x) => x.mdxFetchDurationMs))),
      transformMs: stats(present(warm.map((x) => x.transformDurationMs))), shadowOverheadMs: stats(warm.map((x) => x.shadowOverheadMs)), elapsedMs: performance.now() - started };
  }
}

export function deterministicSample<T extends { id: string; sourceOrdinal: number }>(items: T[], size: number, seed: string): T[] {
  return [...items].sort((a, b) => sampleScore(a.id, seed).localeCompare(sampleScore(b.id, seed)) || a.sourceOrdinal - b.sourceOrdinal).slice(0, size);
}
function sampleScore(id: string, seed: string): string { return crypto.createHash('sha256').update(`${seed}\0${id}`).digest('hex'); }
function hasCompleteLocator(row: Record<string, unknown>): boolean { return ['mdxLocatorVersion', 'mdxLocatorFileChecksum', 'mdxLocatorKeyText', 'mdxLocatorKeyBlockIndex', 'mdxLocatorRecordStartOffset', 'mdxLocatorRecordEndOffset'].every((key) => row[key] !== null); }
function present(values: Array<number | null>): number[] { return values.filter((value): value is number => value !== null); }
function stats(values: number[]): LatencyStats | null {
  if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { average: values.reduce((sum, value) => sum + value, 0) / values.length, median: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1)! };
}
