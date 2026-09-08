import crypto from 'node:crypto';
import type { EntryKind, PrismaClient } from '@prisma/client';
import { entryPlainText, sanitizeEntryHtml } from '../entries/html.js';
import { normalizeHeadword } from '../entries/normalize.js';
import { InvalidMdxLocatorError, MdxEntryNotFoundByLocatorError, MdxFileIdentityMismatchError } from '../mdx/lazy-mdx-adapter.js';
import { PartialPersistedMdxLocatorError } from '../mdx/mdx-locator-persistence.js';
import type { DictionaryDetailShadowHook, EntryDetailDTO } from './dictionary-query-service.js';
import { LazyDetailMappingError, LazyDetailPipelineError, type LazyDictionaryDetailPocService } from './lazy-dictionary-detail-poc-service.js';

export type ShadowFailureCategory = 'missing_locator' | 'checksum_mismatch' | 'malformed_locator' | 'mdx_read' | 'sanitizer' | 'identity_mismatch' | 'html_mismatch' | 'plain_text_mismatch' | 'redirect_mismatch' | 'unknown';
export type ShadowIdentityMismatch = 'entry_id' | 'dictionary_id' | 'headword' | 'entry_kind' | 'redirect_target' | 'resolved_redirect';
export interface DetailShadowResult {
  entryId: string; dictionaryId: string; status: 'success' | 'mismatch' | 'failure'; parity: boolean;
  identityMismatches: ShadowIdentityMismatch[]; htmlMismatch: boolean; plainTextMismatch: boolean; redirectMismatch: boolean;
  failureCategory: ShadowFailureCategory | null; errorName: string | null;
  storedDurationMs: number; locatorDurationMs: number | null; mdxFetchDurationMs: number | null;
  transformDurationMs: number | null; lazyDurationMs: number | null; shadowOverheadMs: number;
}
export type ShadowResultObserver = (result: DetailShadowResult) => void;

export function parseShadowSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;
}

export function isDeterministicallySampled(entryId: string, percentage: number, seed = 'default'): boolean {
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;
  const score = crypto.createHash('sha256').update(`${seed}\0${entryId}`).digest().readUInt32BE(0) / 0x1_0000_0000;
  return score < percentage / 100;
}

export class DictionaryDetailShadowVerifier implements DictionaryDetailShadowHook {
  private active = 0;
  constructor(private readonly database: PrismaClient, private readonly lazy: LazyDictionaryDetailPocService,
    private readonly sampleRate = 0, private readonly seed = 'default', private readonly observe: ShadowResultObserver = () => {},
    private readonly maxConcurrent = 2) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8) throw new RangeError('maxConcurrent must be between 1 and 8');
  }

  shouldVerify(entryId: string): boolean { return this.active < this.maxConcurrent && isDeterministicallySampled(entryId, this.sampleRate, this.seed); }

  async verify(storedDetail: EntryDetailDTO, storedDurationMs: number): Promise<DetailShadowResult> {
    this.active++;
    try { return await this.verifyNow(storedDetail, storedDurationMs); }
    finally { this.active--; }
  }

  async verifyNow(storedDetail: EntryDetailDTO, storedDurationMs: number): Promise<DetailShadowResult> {
    const started = performance.now();
    try {
      const baseline = await this.loadBaseline(storedDetail.id);
      const lazy = await this.lazy.getEntryFromPersistedLocator(storedDetail.id);
      if (!baseline || !lazy) throw new Error('Entry disappeared during shadow verification');
      const identityMismatches: ShadowIdentityMismatch[] = [];
      if (lazy.detail.id !== storedDetail.id) identityMismatches.push('entry_id');
      if (lazy.detail.dictionaryId !== storedDetail.dictionaryId) identityMismatches.push('dictionary_id');
      if (lazy.detail.headword !== storedDetail.headword) identityMismatches.push('headword');
      if (lazy.detail.kind !== storedDetail.kind) identityMismatches.push('entry_kind');
      if (lazy.detail.redirectTarget !== storedDetail.redirectTarget) identityMismatches.push('redirect_target');
      if (lazy.resolvedRedirectEntryId !== baseline.resolvedRedirectEntryId) identityMismatches.push('resolved_redirect');
      const htmlMismatch = lazy.detail.sanitizedHtml !== baseline.sanitizedHtml;
      const plainTextMismatch = lazy.detail.plainText !== baseline.plainText;
      const redirectMismatch = lazy.detail.redirectTarget !== baseline.redirectTarget;
      const parity = !identityMismatches.length && !htmlMismatch && !plainTextMismatch && !redirectMismatch;
      return this.emit({ entryId: storedDetail.id, dictionaryId: storedDetail.dictionaryId, status: parity ? 'success' : 'mismatch', parity,
        identityMismatches, htmlMismatch, plainTextMismatch, redirectMismatch, failureCategory: null, errorName: null, storedDurationMs,
        locatorDurationMs: lazy.timings.mappingMs, mdxFetchDurationMs: lazy.timings.fetchMs, transformDurationMs: lazy.timings.transformMs,
        lazyDurationMs: lazy.timings.totalMs, shadowOverheadMs: performance.now() - started });
    } catch (error) {
      return this.emit({ entryId: storedDetail.id, dictionaryId: storedDetail.dictionaryId, status: 'failure', parity: false,
        identityMismatches: [], htmlMismatch: false, plainTextMismatch: false, redirectMismatch: false,
        failureCategory: classifyLazyDetailFailure(error), errorName: error instanceof Error ? error.name : 'UnknownError', storedDurationMs,
        locatorDurationMs: null, mdxFetchDurationMs: null, transformDurationMs: null, lazyDurationMs: null, shadowOverheadMs: performance.now() - started });
    }
  }

  private emit(result: DetailShadowResult): DetailShadowResult { this.observe(result); return result; }

  private async loadBaseline(entryId: string): Promise<{ sanitizedHtml: string; plainText: string; redirectTarget: string | null; resolvedRedirectEntryId: string | null } | null> {
    const row = await this.database.dictionaryEntry.findUnique({ where: { id: entryId }, select: { dictionaryId: true, entryRaw: true, entryKind: true, redirectTargetOriginal: true } });
    if (!row) return null;
    let raw = row.entryRaw; let resolvedRedirectEntryId: string | null = null;
    if (row.entryKind === 'redirect' && row.redirectTargetOriginal) {
      const target = await this.database.dictionaryEntry.findFirst({ where: { dictionaryId: row.dictionaryId, headwordNormalized: normalizeHeadword(row.redirectTargetOriginal) }, orderBy: { sourceOrdinal: 'asc' }, select: { id: true, entryRaw: true, entryKind: true } });
      raw = target?.entryKind === 'definition' ? target.entryRaw : '';
      resolvedRedirectEntryId = target?.id ?? null;
    }
    try {
      const sanitizedHtml = raw ? sanitizeEntryHtml(raw) : '';
      return { sanitizedHtml, plainText: sanitizedHtml ? entryPlainText(sanitizedHtml) : '', redirectTarget: row.redirectTargetOriginal, resolvedRedirectEntryId };
    } catch (error) { throw new ShadowSanitizerError(error); }
  }
}

class ShadowSanitizerError extends Error { constructor(readonly cause: unknown) { super('Shadow content pipeline failed'); } }
export function classifyLazyDetailFailure(error: unknown): ShadowFailureCategory {
  if (error instanceof ShadowSanitizerError) return 'sanitizer';
  if (error instanceof LazyDetailPipelineError) return 'sanitizer';
  if (error instanceof MdxFileIdentityMismatchError || (error instanceof LazyDetailMappingError && error.message.includes('checksum'))) return 'checksum_mismatch';
  if (error instanceof PartialPersistedMdxLocatorError || error instanceof InvalidMdxLocatorError) return 'malformed_locator';
  if (error instanceof LazyDetailMappingError && error.message.includes('no persisted')) return 'missing_locator';
  if (error instanceof LazyDetailMappingError && (error.message.includes('identity') || error.message.includes('align'))) return 'identity_mismatch';
  if (error instanceof MdxEntryNotFoundByLocatorError || error instanceof LazyDetailMappingError) return 'mdx_read';
  return 'unknown';
}
