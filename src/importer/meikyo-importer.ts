import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ContentModel, EntryKind, type Prisma, type PrismaClient } from '@prisma/client';
import { makeSortKey, normalizeHeadword } from '../entries/normalize.js';
import { validateMeikyoProjection } from '../meikyo/canonical-projection-validator.js';
import type {
  CanonicalContentBlockProjection, CanonicalProjectionResult, EntryProjection, ProjectionValidationResult,
} from '../meikyo/canonical-projection-types.js';
import { projectMeikyoEntry } from '../meikyo/meikyo-canonical-projector.js';
import { MeikyoParser } from '../meikyo/meikyo-parser.js';
import type { MeikyoEntry } from '../meikyo/types.js';
import { StarDictReader, type StarDictRecord } from '../stardict/stardict-reader.js';

export const MEIKYO_IMPORTER_VERSION = '1';
export const MEIKYO_PROJECTOR_VERSION = '1';

export interface MeikyoImportOptions {
  batchSize?: number;
  name?: string;
  onProgress?: (progress: { current: number; total: number }) => void;
}

export interface MeikyoImportSummary {
  dictionaryId: string;
  sourceRecords: number;
  entries: number;
  customLinksDeferred: number;
  forms: number;
  senses: number;
  entryDefinitions: number;
  senseDefinitions: number;
  examples: number;
  exampleTexts: number;
  contentBlocks: number;
  contentTexts: number;
  sourceArtifacts: number;
  rejectedRecords: number;
  durationMs: number;
  peakMemoryBytes: number;
  batchSize: number;
}

export class InvalidMeikyoSourceError extends Error {}
export class MeikyoImportRecordError extends Error {
  constructor(readonly sourceOrdinal: number, readonly sourceKey: string, readonly headword: string, message: string) {
    super(`Meikyo record ${sourceKey} (${headword}, ordinal ${sourceOrdinal}): ${message}`);
  }
}
export class MeikyoImportBatchError extends Error {
  constructor(readonly records: Array<{ sourceOrdinal: number; sourceKey: string; headword: string }>, cause: unknown) {
    super(`Meikyo batch ${records[0]?.sourceKey ?? 'empty'}..${records.at(-1)?.sourceKey ?? 'empty'} failed; records: ${records.map((record) => `${record.sourceKey}(${record.headword})`).join(', ')}; ${errorMessage(cause)}`);
  }
}

interface MeikyoImporterDependencies {
  parse?: (record: StarDictRecord) => MeikyoEntry;
  project?: (entry: MeikyoEntry) => CanonicalProjectionResult;
  validate?: (entry: MeikyoEntry, projection: CanonicalProjectionResult) => ProjectionValidationResult;
}

interface PreparedRecord {
  source: StarDictRecord;
  ast: MeikyoEntry;
  projection: CanonicalProjectionResult;
  sourceKey: string;
  sourceRecordId: string;
  entryId: string | null;
  representationChecksum: string;
}

interface Counters {
  sourceRecords: number; entries: number; customLinksDeferred: number; forms: number; senses: number;
  entryDefinitions: number; senseDefinitions: number; examples: number; exampleTexts: number;
  contentBlocks: number; contentTexts: number; sourceArtifacts: number;
}

export class MeikyoImporter {
  private readonly parse: (record: StarDictRecord) => MeikyoEntry;
  private readonly project: (entry: MeikyoEntry) => CanonicalProjectionResult;
  private readonly validate: (entry: MeikyoEntry, projection: CanonicalProjectionResult) => ProjectionValidationResult;

  constructor(private readonly database: PrismaClient, dependencies: MeikyoImporterDependencies = {}) {
    const parser = new MeikyoParser();
    this.parse = dependencies.parse ?? ((record) => parser.parse(record));
    this.project = dependencies.project ?? projectMeikyoEntry;
    this.validate = dependencies.validate ?? validateMeikyoProjection;
  }

  async import(sourcePath: string, options: MeikyoImportOptions = {}): Promise<MeikyoImportSummary> {
    const batchSize = options.batchSize ?? 100;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new RangeError('batchSize must be an integer between 1 and 500');
    const started = performance.now();
    const reader = await StarDictReader.open(sourcePath);
    const snapshot = await inspectSnapshot(reader);
    const dictionaryId = deterministicUuid('dictionary', 'meikyo', snapshot.checksum);
    const storageKey = `meikyo/${snapshot.checksum}`;
    let dictionaryExists = false;
    let peakMemoryBytes = process.memoryUsage().rss;
    const counters = emptyCounters();
    let artifactIdentity: { parserName: string; parserVersion: string; representationVersion: number } | null = null;

    try {
      const existingByStorage = await this.database.dictionary.findUnique({ where: { storageKey } });
      const existingById = await this.database.dictionary.findUnique({ where: { id: dictionaryId } });
      const existing = existingByStorage ?? existingById;
      if (existing && (existing.id !== dictionaryId || existing.storageKey !== storageKey || existing.fileChecksum !== snapshot.checksum ||
        existing.sourceFormat !== 'stardict' || existing.contentModel !== ContentModel.structured)) {
        throw new InvalidMeikyoSourceError('Existing dictionary identity conflicts with this StarDict snapshot');
      }
      const dictionary = existing ?? await this.database.dictionary.create({ data: {
        id: dictionaryId, name: options.name ?? (reader.metadata.bookname || 'Meikyo'), sourceFilename: path.basename(`${reader.basePath}.ifo`),
        fileChecksum: snapshot.checksum, storageKey, status: 'importing', sourceFormat: 'stardict', sourceLanguage: 'ja',
        targetLanguages: ['zh-CN'], contentModel: ContentModel.structured,
        parserName: 'MeikyoParser', parserVersion: '1', sourceMetadata: dictionaryMetadata(reader, snapshot),
      } });
      dictionaryExists = true;
      if (existing) await this.database.dictionary.update({ where: { id: dictionary.id }, data: { status: 'importing', failureSummary: null } });

      let batch: PreparedRecord[] = [];
      let processed = 0;
      for (const record of reader.records()) {
        const prepared = prepareRecord(dictionary.id, record, this.parse, this.project, this.validate);
        const currentIdentity = prepared.projection.sourceArtifact;
        if (artifactIdentity === null) artifactIdentity = currentIdentity;
        else if (artifactIdentity.parserName !== currentIdentity.parserName || artifactIdentity.parserVersion !== currentIdentity.parserVersion ||
          artifactIdentity.representationVersion !== currentIdentity.representationVersion) throw recordError(prepared, 'parser artifact identity changed within one import');
        batch.push(prepared);
        accumulate(counters, batch.at(-1)!.projection);
        processed += 1;
        if (processed % 250 === 0) peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().rss);
        if (batch.length >= batchSize) {
          await persistPreparedBatch(this.database, dictionary.id, batch);
          batch = [];
          options.onProgress?.({ current: processed, total: reader.recordCount });
        }
      }
      if (batch.length) await persistPreparedBatch(this.database, dictionary.id, batch);
      if (processed !== reader.recordCount) throw new InvalidMeikyoSourceError(`record count changed during import: expected ${reader.recordCount}, read ${processed}`);

      await this.database.dictionary.update({ where: { id: dictionary.id }, data: {
        status: 'ready', failureSummary: null, entryCount: counters.entries, importedAt: new Date(),
        parserName: artifactIdentity?.parserName ?? 'MeikyoParser', parserVersion: artifactIdentity?.parserVersion ?? '1',
        sourceMetadata: dictionaryMetadata(reader, snapshot, { ...counters, projectorVersion: MEIKYO_PROJECTOR_VERSION, importerVersion: MEIKYO_IMPORTER_VERSION }),
      } });
      options.onProgress?.({ current: processed, total: reader.recordCount });
      return { dictionaryId: dictionary.id, ...counters, rejectedRecords: 0,
        durationMs: performance.now() - started, peakMemoryBytes, batchSize };
    } catch (error) {
      if (dictionaryExists) await this.database.dictionary.update({ where: { id: dictionaryId }, data: {
        status: 'failed', failureSummary: errorMessage(error).slice(0, 8000),
      } }).catch(() => undefined);
      throw error;
    }
  }
}

function prepareRecord(dictionaryId: string, source: StarDictRecord,
  parse: (record: StarDictRecord) => MeikyoEntry,
  project: (entry: MeikyoEntry) => CanonicalProjectionResult,
  validate: (entry: MeikyoEntry, projection: CanonicalProjectionResult) => ProjectionValidationResult): PreparedRecord {
  const sourceKey = `stardict:${source.ordinal}`;
  try {
    const ast = parse(source); const projection = project(ast); const result = validate(ast, projection);
    if (!result.valid) throw new Error(`projection validation failed: ${result.issues.map((issue) => `${issue.code}: ${issue.message}`).join('; ')}`);
    if (projection.sourceOrdinal !== source.ordinal) throw new Error(`projection source ordinal ${projection.sourceOrdinal} does not match record ordinal`);
    if (projection.sourceArtifact.rawPayload !== source.text) throw new Error('projection source artifact does not preserve the exact source payload');
    const sourceRecordId = deterministicUuid(dictionaryId, 'source-record', sourceKey);
    const entryId = projection.kind === 'entry' ? deterministicUuid(dictionaryId, 'entry', sourceKey) : null;
    return { source, ast, projection, sourceKey, sourceRecordId, entryId,
      representationChecksum: sha256(stableJson(projection.sourceArtifact.parsedRepresentation)) };
  } catch (error) {
    throw new MeikyoImportRecordError(source.ordinal, sourceKey, source.headword, errorMessage(error));
  }
}

async function persistPreparedBatch(database: PrismaClient, dictionaryId: string, batch: PreparedRecord[]): Promise<void> {
  try { await persistBatch(database, dictionaryId, batch); }
  catch (error) {
    if (error instanceof MeikyoImportRecordError) throw error;
    throw new MeikyoImportBatchError(batch.map((item) => ({ sourceOrdinal: item.source.ordinal, sourceKey: item.sourceKey, headword: item.source.headword })), error);
  }
}

async function persistBatch(database: PrismaClient, dictionaryId: string, batch: PreparedRecord[]): Promise<void> {
  await database.$transaction(async (tx) => {
    const normal = batch.filter((item): item is PreparedRecord & { entryId: string; projection: EntryProjection } => item.entryId !== null && item.projection.kind === 'entry');
    if (normal.length) {
      const entriesBeforeBatch = await tx.dictionaryEntry.findMany({ where: { id: { in: normal.map((item) => item.entryId) } }, select: { id: true } });
      const existingIds = new Set(entriesBeforeBatch.map((entry) => entry.id));
      await tx.dictionaryEntry.createMany({ data: normal.map((item) => entryRow(dictionaryId, item)), skipDuplicates: true });
      const existingEntries = await tx.dictionaryEntry.findMany({ where: { id: { in: normal.map((item) => item.entryId) } },
        select: { id: true, dictionaryId: true, sourceOrdinal: true } });
      const byId = new Map(existingEntries.map((entry) => [entry.id, entry]));
      for (const item of normal) {
        const existing = byId.get(item.entryId);
        if (!existing || existing.dictionaryId !== dictionaryId || existing.sourceOrdinal !== item.source.ordinal) {
          throw recordError(item, 'deterministic DictionaryEntry identity conflicts with an existing row');
        }
        if (existingIds.has(item.entryId)) await tx.dictionaryEntry.update({ where: { id: item.entryId }, data: entryMutableRow(item.projection) });
      }
    }

    await tx.dictionarySourceRecord.createMany({ data: batch.map((item) => sourceRecordRow(dictionaryId, item)), skipDuplicates: true });
    const storedRecords = await tx.dictionarySourceRecord.findMany({ where: { dictionaryId, sourceKey: { in: batch.map((item) => item.sourceKey) } } });
    const storedByKey = new Map(storedRecords.map((record) => [record.sourceKey, record]));
    for (const item of batch) verifySourceRecord(item, storedByKey.get(item.sourceKey));

    await tx.dictionarySourceArtifact.createMany({ data: batch.map(artifactRow), skipDuplicates: true });
    const storedArtifacts = await tx.dictionarySourceArtifact.findMany({ where: {
      sourceRecordId: { in: batch.map((item) => item.sourceRecordId) },
      parserName: batch[0].projection.sourceArtifact.parserName,
      parserVersion: batch[0].projection.sourceArtifact.parserVersion,
      representationVersion: batch[0].projection.sourceArtifact.representationVersion,
    } });
    const artifactsByRecord = new Map(storedArtifacts.map((artifact) => [artifact.sourceRecordId, artifact]));
    for (const item of batch) {
      const artifact = artifactsByRecord.get(item.sourceRecordId);
      if (!artifact || artifact.representationChecksum !== item.representationChecksum) throw recordError(item, 'parser artifact version exists with different representation content');
    }

    if (!normal.length) return;
    await tx.structuredEntry.deleteMany({ where: { entryId: { in: normal.map((item) => item.entryId) } } });
    await tx.structuredEntry.createMany({ data: normal.map((item) => ({ entryId: item.entryId })) });

    const forms: Prisma.FormCreateManyInput[] = []; const senses: Prisma.SenseCreateManyInput[] = [];
    const entryDefinitions: Prisma.EntryDefinitionCreateManyInput[] = []; const senseDefinitions: Prisma.SenseDefinitionCreateManyInput[] = [];
    const blocks: Prisma.ContentBlockCreateManyInput[] = []; const contentTexts: Prisma.ContentTextCreateManyInput[] = [];
    const examples: Prisma.ExampleCreateManyInput[] = []; const exampleTexts: Prisma.ExampleTextCreateManyInput[] = [];
    for (const item of normal) collectCanonicalRows(item, forms, senses, entryDefinitions, senseDefinitions, blocks, contentTexts, examples, exampleTexts);
    if (forms.length) await tx.form.createMany({ data: forms });
    if (senses.length) await tx.sense.createMany({ data: senses });
    if (entryDefinitions.length) await tx.entryDefinition.createMany({ data: entryDefinitions });
    if (senseDefinitions.length) await tx.senseDefinition.createMany({ data: senseDefinitions });
    for (const level of blockLevels(blocks)) if (level.length) await tx.contentBlock.createMany({ data: level });
    if (contentTexts.length) await tx.contentText.createMany({ data: contentTexts });
    if (examples.length) await tx.example.createMany({ data: examples });
    if (exampleTexts.length) await tx.exampleText.createMany({ data: exampleTexts });
  }, { maxWait: 30_000, timeout: 120_000 });
}

function collectCanonicalRows(item: PreparedRecord & { entryId: string; projection: EntryProjection },
  forms: Prisma.FormCreateManyInput[], senses: Prisma.SenseCreateManyInput[], entryDefinitions: Prisma.EntryDefinitionCreateManyInput[],
  senseDefinitions: Prisma.SenseDefinitionCreateManyInput[], blocks: Prisma.ContentBlockCreateManyInput[],
  contentTexts: Prisma.ContentTextCreateManyInput[], examples: Prisma.ExampleCreateManyInput[], exampleTexts: Prisma.ExampleTextCreateManyInput[]) {
  const { entryId, projection } = item;
  const senseIds = new Map(projection.senses.map((sense) => [sense.ref, deterministicUuid(entryId, 'sense', sense.ref)]));
  const blockIds = new Map(projection.contentBlocks.map((block) => [block.ref, deterministicUuid(entryId, 'block', block.ref)]));
  for (const form of projection.forms) forms.push({ id: deterministicUuid(entryId, 'form', form.ref), structuredEntryId: entryId,
    text: form.text, normalizedText: form.normalizedText, language: form.language, kind: form.kind, ordinal: form.ordinal,
    provenance: undefined } as Prisma.FormCreateManyInput);
  for (const sense of projection.senses) senses.push({ id: senseIds.get(sense.ref)!, structuredEntryId: entryId, ordinal: sense.ordinal,
    provenance: undefined } as Prisma.SenseCreateManyInput);
  for (const definition of projection.entryDefinitions) entryDefinitions.push({ id: deterministicUuid(entryId, 'entry-definition', definition.ref),
    structuredEntryId: entryId, text: definition.text, language: definition.language, source: 'meikyo', ordinal: definition.ordinal,
    provenance: json(definition.provenance) });
  for (const definition of projection.senseDefinitions) senseDefinitions.push({ id: deterministicUuid(entryId, 'sense-definition', definition.ref),
    senseId: requiredRef(senseIds, definition.owner.type === 'sense' ? definition.owner.senseRef : '', item, 'sense definition'),
    text: definition.text, language: definition.language, source: 'meikyo', ordinal: definition.ordinal, provenance: json(definition.provenance) });
  for (const block of projection.contentBlocks) {
    const blockId = blockIds.get(block.ref)!;
    blocks.push({ id: blockId, structuredEntryId: entryId,
      parentBlockId: block.parentRef === null ? null : requiredRef(blockIds, block.parentRef, item, 'content block parent'),
      senseId: block.senseRef === null ? null : requiredRef(senseIds, block.senseRef, item, 'content block sense'),
      kind: block.kind, annotationKind: block.annotationKind, ordinal: block.ordinal, source: 'meikyo', provenance: json(block.provenance) });
    for (const text of block.texts) contentTexts.push({ id: deterministicUuid(blockId, 'text', String(text.ordinal)), contentBlockId: blockId,
      language: text.language, role: text.role, text: text.text, ordinal: text.ordinal, source: 'meikyo', provenance: json(text.provenance) });
  }
  for (const example of projection.examples) {
    const exampleId = deterministicUuid(entryId, 'example', example.ref);
    examples.push({ id: exampleId, structuredEntryId: entryId,
      senseId: example.owner.type === 'sense' ? requiredRef(senseIds, example.owner.senseRef, item, 'example sense') : null,
      ordinal: example.ordinal, source: 'meikyo', provenance: json(example.provenance),
      contentBlockId: requiredRef(blockIds, example.contentBlockRef, item, 'example content block') });
    for (const text of example.texts) exampleTexts.push({ id: deterministicUuid(exampleId, 'text', String(text.ordinal)), exampleId,
      language: text.language, role: text.role, text: text.text, ordinal: text.ordinal, source: 'meikyo', provenance: json(text.provenance) });
  }
}

function entryRow(dictionaryId: string, item: PreparedRecord & { entryId: string; projection: EntryProjection }): Prisma.DictionaryEntryCreateManyInput {
  return { id: item.entryId, dictionaryId, ...entryMutableRow(item.projection), sourceOrdinal: item.source.ordinal, sourceRecordId: null };
}
interface EntryMutableRow {
  headwordOriginal: string; headwordNormalized: string; sortKey: string; entryPlainText: string;
  entryKind: typeof EntryKind.definition; redirectTargetOriginal: null;
}
function entryMutableRow(projection: EntryProjection): EntryMutableRow {
  return { headwordOriginal: projection.headword, headwordNormalized: normalizeHeadword(projection.headword), sortKey: makeSortKey(projection.headword),
    entryPlainText: projection.headword, entryKind: EntryKind.definition, redirectTargetOriginal: null };
}
function sourceRecordRow(dictionaryId: string, item: PreparedRecord): Prisma.DictionarySourceRecordCreateManyInput {
  const artifact = item.projection.sourceArtifact;
  return { id: item.sourceRecordId, dictionaryId, entryId: item.entryId, sourceKey: item.sourceKey, sourceOrdinal: item.source.ordinal,
    recordKind: item.projection.kind === 'entry' ? 'lexical' : 'deferred-custom-link', sourceIdentity: json(artifact.sourceIdentity),
    rawPayload: artifact.rawPayload, contentChecksum: artifact.contentChecksum,
    sourceMetadata: json({ ...artifact.sourceMetadata, indexHeadword: item.source.headword, offset: item.source.offset.toString(), size: item.source.size }) };
}
function artifactRow(item: PreparedRecord): Prisma.DictionarySourceArtifactCreateManyInput {
  const artifact = item.projection.sourceArtifact;
  return { id: deterministicUuid(item.sourceRecordId, 'artifact', artifact.parserName, artifact.parserVersion, String(artifact.representationVersion)),
    sourceRecordId: item.sourceRecordId, parserName: artifact.parserName, parserVersion: artifact.parserVersion,
    representationVersion: artifact.representationVersion, parsedRepresentation: json(artifact.parsedRepresentation),
    diagnostics: json(artifact.diagnostics), artifactMetadata: json({ importerVersion: MEIKYO_IMPORTER_VERSION, projectorVersion: MEIKYO_PROJECTOR_VERSION }),
    representationChecksum: item.representationChecksum };
}

function verifySourceRecord(item: PreparedRecord, stored: { id: string; entryId: string | null; sourceOrdinal: number; recordKind: string; rawPayload: string | null; contentChecksum: string } | undefined) {
  const kind = item.projection.kind === 'entry' ? 'lexical' : 'deferred-custom-link';
  if (!stored || stored.id !== item.sourceRecordId || stored.entryId !== item.entryId || stored.sourceOrdinal !== item.source.ordinal ||
    stored.recordKind !== kind || stored.rawPayload !== item.source.text || stored.contentChecksum !== item.projection.sourceArtifact.contentChecksum) {
    throw recordError(item, 'stored source record conflicts with the current source snapshot or projection kind');
  }
}
function requiredRef(map: Map<string, string>, ref: string, item: PreparedRecord, label: string): string {
  const value = map.get(ref); if (!value) throw recordError(item, `${label} refers to missing local ref ${ref}`); return value;
}
function blockLevels(rows: Prisma.ContentBlockCreateManyInput[]): Prisma.ContentBlockCreateManyInput[][] {
  const pending = new Map(rows.map((row) => [String(row.id), row])); const inserted = new Set<string>(); const levels: Prisma.ContentBlockCreateManyInput[][] = [];
  while (pending.size) {
    const level = [...pending.values()].filter((row) => row.parentBlockId === null || inserted.has(String(row.parentBlockId)));
    if (!level.length) throw new Error('ContentBlock graph contains a cycle or missing parent');
    levels.push(level); for (const row of level) { pending.delete(String(row.id)); inserted.add(String(row.id)); }
  }
  return levels;
}

async function inspectSnapshot(reader: StarDictReader): Promise<{ checksum: string; files: Array<{ name: string; checksum: string; size: number }> }> {
  const candidates = [`${reader.basePath}.ifo`, `${reader.basePath}.idx`, `${reader.basePath}.idx.oft`, `${reader.basePath}.dict`, `${reader.basePath}.dict.dz`];
  const files: Array<{ name: string; checksum: string; size: number }> = [];
  const combined = crypto.createHash('sha256');
  for (const filename of candidates) {
    const stat = await fs.promises.stat(filename).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!stat?.isFile()) continue;
    const checksum = await sha256File(filename); const name = path.basename(filename);
    files.push({ name, checksum, size: stat.size }); combined.update(name).update('\0').update(checksum).update('\0').update(String(stat.size)).update('\0');
  }
  if (!files.some((file) => file.name.endsWith('.ifo')) || !files.some((file) => file.name.endsWith('.idx')) ||
      !files.some((file) => file.name.endsWith('.dict') || file.name.endsWith('.dict.dz'))) throw new InvalidMeikyoSourceError('Incomplete StarDict snapshot');
  return { checksum: combined.digest('hex'), files };
}
async function sha256File(filename: string): Promise<string> { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(filename)) hash.update(chunk); return hash.digest('hex'); }
function dictionaryMetadata(reader: StarDictReader, snapshot: { checksum: string; files: unknown }, result?: unknown): Prisma.InputJsonObject {
  return { container: { ...reader.metadata, fields: { ...reader.metadata.fields } }, snapshotChecksum: snapshot.checksum,
    snapshotFiles: snapshot.files as Prisma.InputJsonValue, importerVersion: MEIKYO_IMPORTER_VERSION,
    projectorVersion: MEIKYO_PROJECTOR_VERSION, ...(result === undefined ? {} : { importResult: result as Prisma.InputJsonValue }) };
}
function deterministicUuid(...parts: string[]): string { const bytes = crypto.createHash('sha256').update(parts.join('\0')).digest().subarray(0, 16); bytes[6] = (bytes[6] & 0x0f) | 0x80; bytes[8] = (bytes[8] & 0x3f) | 0x80; const h = bytes.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }
function stableJson(value: unknown): string { return JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item); }
function sha256(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function recordError(item: PreparedRecord, message: string): MeikyoImportRecordError { return new MeikyoImportRecordError(item.source.ordinal, item.sourceKey, item.source.headword, message); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function emptyCounters(): Counters { return { sourceRecords: 0, entries: 0, customLinksDeferred: 0, forms: 0, senses: 0, entryDefinitions: 0, senseDefinitions: 0, examples: 0, exampleTexts: 0, contentBlocks: 0, contentTexts: 0, sourceArtifacts: 0 }; }
function accumulate(counters: Counters, projection: CanonicalProjectionResult) {
  counters.sourceRecords += 1; counters.sourceArtifacts += 1;
  if (projection.kind === 'deferred-custom-link') { counters.customLinksDeferred += 1; return; }
  counters.entries += 1; counters.forms += projection.forms.length; counters.senses += projection.senses.length;
  counters.entryDefinitions += projection.entryDefinitions.length; counters.senseDefinitions += projection.senseDefinitions.length;
  counters.examples += projection.examples.length; counters.exampleTexts += projection.examples.reduce((sum, example) => sum + example.texts.length, 0);
  counters.contentBlocks += projection.contentBlocks.length; counters.contentTexts += projection.contentBlocks.reduce((sum, block) => sum + block.texts.length, 0);
}
