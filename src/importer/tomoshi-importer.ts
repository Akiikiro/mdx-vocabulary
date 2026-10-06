import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ContentModel, EntryKind, type Prisma, type PrismaClient } from '@prisma/client';
import { makeSortKey, normalizeHeadword } from '../entries/normalize.js';

const REQUIRED_COLUMNS = {
  entries: ['id', 'is_common', 'data'],
  forms: ['text', 'entry_id', 'is_kana', 'is_common'],
  jpn_defs: ['entry_id', 'source', 'glosses', 'furigana'],
  zh_defs: ['entry_id', 'locale', 'data'],
  freq_rank: ['entry_id', 'rank'],
  vocab_jlpt: ['entry_id', 'level', 'source'],
  meta: ['key', 'value'],
  table_licenses: ['table_name', 'license', 'source_db', 'attribution'],
} as const;

const IMPORTED_TABLES = ['entries', 'forms', 'jpn_defs', 'zh_defs'] as const;

export interface TomoshiImportOptions {
  batchSize?: number;
  name?: string;
  onProgress?: (progress: { current: number; total: number }) => void;
}

export interface TomoshiImportSummary {
  dictionaryId: string;
  entries: number;
  forms: number;
  senses: number;
  entryDefinitions: number;
  senseDefinitions: number;
  targetLanguages: string[];
  rejectedRecords: number;
  durationMs: number;
  peakMemoryBytes: number;
  omitted: {
    frequencyRanks: number;
    vocabularyJlptLevels: number;
    entryCommonness: number;
    formCommonness: number;
    variantNotes: number;
    chineseSenseNotes: number;
    chineseExamples: number;
  };
}

export class InvalidTomoshiSourceError extends Error {}
export class TomoshiImportRecordError extends Error {
  constructor(readonly sourceRecordId: string, message: string) {
    super(`Tomoshi entry ${sourceRecordId}: ${message}`);
  }
}

interface SourceInspection {
  entries: number;
  forms: number;
  jpnDefinitions: number;
  chineseDefinitions: number;
  frequencyRanks: number;
  vocabularyJlptLevels: number;
  meta: Record<string, string | null>;
  tableLicenses: Array<{ table: string; license: string | null; sourceDatabase: string | null; attribution: string | null }>;
}

interface EntryRow { id: string; is_common: number; data: string }
interface FormRow { text: string; entry_id: string; is_kana: number; is_common: number }
interface JapaneseDefinitionRow { entry_id: string; source: string; glosses: string; furigana: string }
interface ChineseDefinitionRow { entry_id: string; locale: string; data: string }

interface SourceForm {
  text: string;
  info: string[];
  priority: string[];
  restrictedTo: string[];
  kind: 'kanji' | 'kana';
}

interface SourceGloss { text: string; language: 'eng' | 'zho'; glossType: string | null }
interface SourceSense { pos: string[]; glosses: SourceGloss[]; notes: string | null; field: string[]; misc: string[] }
interface SourceEntry {
  id: string;
  forms: SourceForm[];
  senses: SourceSense[];
  isCommon: boolean;
  hasVariantNote: boolean;
}

interface PersistBatch {
  entries: Prisma.DictionaryEntryCreateManyInput[];
  structuredEntries: Prisma.StructuredEntryCreateManyInput[];
  forms: Prisma.FormCreateManyInput[];
  senses: Prisma.SenseCreateManyInput[];
  entryDefinitions: Prisma.EntryDefinitionCreateManyInput[];
  senseDefinitions: Prisma.SenseDefinitionCreateManyInput[];
}

interface ImportCounters {
  entries: number;
  forms: number;
  senses: number;
  entryDefinitions: number;
  senseDefinitions: number;
  entryCommonness: number;
  formCommonness: number;
  variantNotes: number;
  chineseSenseNotes: number;
  chineseExamples: number;
}

interface CanonicalizedEntry {
  entry: Prisma.DictionaryEntryCreateManyInput;
  structuredEntry: Prisma.StructuredEntryCreateManyInput;
  forms: Prisma.FormCreateManyInput[];
  senses: Prisma.SenseCreateManyInput[];
  entryDefinitions: Prisma.EntryDefinitionCreateManyInput[];
  senseDefinitions: Prisma.SenseDefinitionCreateManyInput[];
  definitionLanguages: Set<string>;
  omitted: Pick<ImportCounters, 'entryCommonness' | 'formCommonness' | 'variantNotes' | 'chineseSenseNotes' | 'chineseExamples'>;
}

export class TomoshiSourceAdapter {
  private constructor(private readonly database: DatabaseSync) {}

  static async open(sourcePath: string): Promise<TomoshiSourceAdapter> {
    const handle = await fs.promises.open(sourcePath, 'r');
    try {
      const header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== 16 || header.toString('utf8') !== 'SQLite format 3\0') {
        throw new InvalidTomoshiSourceError('Source is not a SQLite 3 database');
      }
    } finally {
      await handle.close();
    }

    let database: DatabaseSync;
    try {
      database = new DatabaseSync(sourcePath, { readOnly: true });
      database.exec('PRAGMA query_only = ON');
    } catch (error) {
      throw new InvalidTomoshiSourceError(`Could not open SQLite source: ${errorMessage(error)}`);
    }
    const adapter = new TomoshiSourceAdapter(database);
    try {
      adapter.validateSchema();
      return adapter;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void { this.database.close(); }

  inspect(): SourceInspection {
    const count = (table: keyof typeof REQUIRED_COLUMNS): number => {
      const row = this.database.prepare(`SELECT count(*) AS count FROM "${table}"`).get() as unknown as { count: number | bigint };
      return Number(row.count);
    };
    const metaRows = this.database.prepare('SELECT key, value FROM meta ORDER BY key').all() as unknown as Array<{ key: string; value: string | null }>;
    const licenseRows = this.database.prepare(`SELECT table_name, license, source_db, attribution FROM table_licenses
      WHERE table_name IN ('entries', 'forms', 'jpn_defs', 'zh_defs') ORDER BY table_name`).all() as unknown as Array<{
      table_name: string; license: string | null; source_db: string | null; attribution: string | null;
    }>;
    return {
      entries: count('entries'), forms: count('forms'), jpnDefinitions: count('jpn_defs'),
      chineseDefinitions: count('zh_defs'), frequencyRanks: count('freq_rank'), vocabularyJlptLevels: count('vocab_jlpt'),
      meta: Object.fromEntries(metaRows.map((row) => [row.key, row.value])),
      tableLicenses: licenseRows.map((row) => ({ table: row.table_name, license: row.license, sourceDatabase: row.source_db, attribution: row.attribution })),
    };
  }

  *iterateEntries(): Generator<{ entry: EntryRow; forms: FormRow[]; japaneseDefinitions: JapaneseDefinitionRow[]; chineseDefinition: ChineseDefinitionRow }> {
    const entryRows = this.database.prepare('SELECT id, is_common, data FROM entries ORDER BY id').iterate() as unknown as IterableIterator<EntryRow>;
    const forms = new OrderedSourceCursor(
      this.database.prepare('SELECT text, entry_id, is_kana, is_common FROM forms ORDER BY entry_id, rowid').iterate() as unknown as IterableIterator<FormRow>,
      (row) => row.entry_id,
      'forms',
    );
    const japaneseDefinitions = new OrderedSourceCursor(
      this.database.prepare('SELECT entry_id, source, glosses, furigana FROM jpn_defs ORDER BY entry_id, rowid').iterate() as unknown as IterableIterator<JapaneseDefinitionRow>,
      (row) => row.entry_id,
      'jpn_defs',
    );
    const chineseDefinitions = new OrderedSourceCursor(
      this.database.prepare("SELECT entry_id, locale, data FROM zh_defs WHERE locale = 'zh-CN' ORDER BY entry_id").iterate() as unknown as IterableIterator<ChineseDefinitionRow>,
      (row) => row.entry_id,
      'zh_defs',
    );

    for (const entry of entryRows) {
      const chineseRows = chineseDefinitions.take(entry.id);
      if (chineseRows.length !== 1) {
        throw new TomoshiImportRecordError(entry.id, `expected one zh-CN row, found ${chineseRows.length}`);
      }
      yield {
        entry,
        forms: forms.take(entry.id),
        japaneseDefinitions: japaneseDefinitions.take(entry.id),
        chineseDefinition: chineseRows[0],
      };
    }
    forms.assertExhausted();
    japaneseDefinitions.assertExhausted();
    chineseDefinitions.assertExhausted();
  }

  private validateSchema(): void {
    for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
      const exists = this.database.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!exists) throw new InvalidTomoshiSourceError(`Required table ${table} is missing`);
      const columns = new Set((this.database.prepare(`PRAGMA table_info("${table}")`).all() as unknown as Array<{ name: string }>).map((row) => row.name));
      for (const column of requiredColumns) {
        if (!columns.has(column)) throw new InvalidTomoshiSourceError(`Required column ${table}.${column} is missing`);
      }
    }
    const localeRows = this.database.prepare('SELECT DISTINCT locale FROM zh_defs ORDER BY locale').all() as unknown as Array<{ locale: string }>;
    if (localeRows.length !== 1 || localeRows[0].locale !== 'zh-CN') {
      throw new InvalidTomoshiSourceError(`zh_defs must contain only the zh-CN locale; found ${localeRows.map((row) => row.locale).join(', ') || 'none'}`);
    }
  }
}

export class TomoshiImporter {
  constructor(private readonly database: PrismaClient) {}

  async import(sourcePath: string, options: TomoshiImportOptions = {}): Promise<TomoshiImportSummary> {
    const batchSize = options.batchSize ?? 250;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
      throw new RangeError('batchSize must be an integer between 1 and 1000');
    }
    const absolutePath = path.resolve(sourcePath);
    const checksum = await sha256File(absolutePath);
    const adapter = await TomoshiSourceAdapter.open(absolutePath);
    let dictionaryId: string | null = null;
    const started = performance.now();
    let peakMemoryBytes = process.memoryUsage().rss;
    try {
      const inspection = adapter.inspect();
      const storageKey = `tomoshi/${checksum}/tomoshi-dict-open.db`;
      const existing = await this.database.dictionary.findUnique({ where: { storageKey } });
      if (existing && (existing.fileChecksum !== checksum || existing.sourceFormat !== 'tomoshi' || existing.contentModel !== ContentModel.structured)) {
        throw new InvalidTomoshiSourceError('Existing dictionary identity conflicts with this Tomoshi source');
      }
      const dictionary = existing ?? await this.database.dictionary.create({
        data: {
          id: deterministicUuid('dictionary', checksum),
          name: options.name ?? defaultDictionaryName(inspection.meta),
          sourceFilename: path.basename(absolutePath),
          fileChecksum: checksum,
          storageKey,
          status: 'importing',
          sourceFormat: 'tomoshi',
          sourceLanguage: 'ja',
          contentModel: ContentModel.structured,
          sourceMetadata: sourceMetadata(inspection, checksum),
        },
      });
      dictionaryId = dictionary.id;
      if (existing) {
        await this.database.dictionary.update({ where: { id: dictionary.id }, data: { status: 'importing', failureSummary: null } });
      }

      const counters: ImportCounters = {
        entries: 0, forms: 0, senses: 0, entryDefinitions: 0, senseDefinitions: 0,
        entryCommonness: 0, formCommonness: 0, variantNotes: 0, chineseSenseNotes: 0, chineseExamples: 0,
      };
      const targetLanguages = new Set<string>();
      let batch = emptyBatch();
      let sourceOrdinal = 0;
      for (const source of adapter.iterateEntries()) {
        const canonical = canonicalizeEntry(dictionary.id, sourceOrdinal, source);
        batch.entries.push(canonical.entry);
        batch.structuredEntries.push(canonical.structuredEntry);
        batch.forms.push(...canonical.forms);
        batch.senses.push(...canonical.senses);
        batch.entryDefinitions.push(...canonical.entryDefinitions);
        batch.senseDefinitions.push(...canonical.senseDefinitions);
        for (const language of canonical.definitionLanguages) targetLanguages.add(language);
        counters.entries += 1;
        counters.forms += canonical.forms.length;
        counters.senses += canonical.senses.length;
        counters.entryDefinitions += canonical.entryDefinitions.length;
        counters.senseDefinitions += canonical.senseDefinitions.length;
        counters.entryCommonness += canonical.omitted.entryCommonness;
        counters.formCommonness += canonical.omitted.formCommonness;
        counters.variantNotes += canonical.omitted.variantNotes;
        counters.chineseSenseNotes += canonical.omitted.chineseSenseNotes;
        counters.chineseExamples += canonical.omitted.chineseExamples;
        sourceOrdinal += 1;
        if (sourceOrdinal % 250 === 0) peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().rss);
        if (batch.entries.length >= batchSize) {
          await persistBatch(this.database, batch);
          batch = emptyBatch();
          options.onProgress?.({ current: sourceOrdinal, total: inspection.entries });
        }
      }
      if (batch.entries.length) await persistBatch(this.database, batch);
      if (sourceOrdinal !== inspection.entries) {
        throw new InvalidTomoshiSourceError(`entries count changed during import: inspected ${inspection.entries}, read ${sourceOrdinal}`);
      }
      const languages = [...targetLanguages].sort();
      const omitted = {
        frequencyRanks: inspection.frequencyRanks,
        vocabularyJlptLevels: inspection.vocabularyJlptLevels,
        entryCommonness: counters.entryCommonness,
        formCommonness: counters.formCommonness,
        variantNotes: counters.variantNotes,
        chineseSenseNotes: counters.chineseSenseNotes,
        chineseExamples: counters.chineseExamples,
      };
      await this.database.dictionary.update({
        where: { id: dictionary.id },
        data: {
          status: 'ready', entryCount: sourceOrdinal, importedAt: new Date(), targetLanguages: languages,
          sourceMetadata: sourceMetadata(inspection, checksum, { imported: counters, omitted }),
        },
      });
      options.onProgress?.({ current: sourceOrdinal, total: inspection.entries });
      return {
        dictionaryId: dictionary.id,
        entries: counters.entries,
        forms: counters.forms,
        senses: counters.senses,
        entryDefinitions: counters.entryDefinitions,
        senseDefinitions: counters.senseDefinitions,
        targetLanguages: languages,
        rejectedRecords: 0,
        durationMs: performance.now() - started,
        peakMemoryBytes,
        omitted,
      };
    } catch (error) {
      if (dictionaryId) {
        await this.database.dictionary.update({
          where: { id: dictionaryId },
          data: { status: 'failed', failureSummary: errorMessage(error).slice(0, 8000) },
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      adapter.close();
    }
  }
}

function canonicalizeEntry(
  dictionaryId: string,
  sourceOrdinal: number,
  source: { entry: EntryRow; forms: FormRow[]; japaneseDefinitions: JapaneseDefinitionRow[]; chineseDefinition: ChineseDefinitionRow },
): CanonicalizedEntry {
  const parsed = parseEntry(source.entry);
  validateFormsTable(parsed, source.forms);
  const entryId = deterministicUuid(dictionaryId, 'entry', parsed.id);
  const forms: Prisma.FormCreateManyInput[] = parsed.forms.map((form, ordinal) => ({
    id: deterministicUuid(entryId, 'form', String(ordinal)),
    structuredEntryId: entryId,
    text: form.text,
    normalizedText: normalizeHeadword(form.text),
    language: 'ja',
    kind: form.kind,
    tags: form.info,
    priorityTags: form.priority,
    restrictions: form.restrictedTo,
    ordinal,
  }));
  const senses: Prisma.SenseCreateManyInput[] = [];
  const senseDefinitions: Prisma.SenseDefinitionCreateManyInput[] = [];
  const definitionLanguages = new Set<string>();
  const plainText: string[] = parsed.forms.map((form) => form.text);
  const senseIds: string[] = [];
  parsed.senses.forEach((sense, ordinal) => {
    const senseId = deterministicUuid(entryId, 'sense', String(ordinal));
    senseIds.push(senseId);
    senses.push({
      id: senseId, structuredEntryId: entryId, ordinal, sourceSenseOrdinal: ordinal,
      partOfSpeech: sense.pos, domains: sense.field, tags: sense.misc, notes: sense.notes,
    });
    sense.glosses.forEach((gloss, glossOrdinal) => {
      if (gloss.language !== 'eng') return;
      definitionLanguages.add('en');
      plainText.push(gloss.text);
      senseDefinitions.push({
        id: deterministicUuid(senseId, 'definition', 'jmdict', String(glossOrdinal)),
        senseId, text: gloss.text, language: 'en', source: 'jmdict', ordinal: glossOrdinal,
        provenance: gloss.glossType === null
          ? { table: 'entries' }
          : { table: 'entries', glossType: gloss.glossType },
      });
    });
  });

  const entryDefinitions: Prisma.EntryDefinitionCreateManyInput[] = [];
  const nextJapaneseOrdinal = new Map<string, number>();
  source.japaneseDefinitions.forEach((row, sourceRowOrdinal) => {
    const glosses = parseStringArray(row.glosses, `${parsed.id} jpn_defs.glosses`);
    const furigana = parseJsonArray(row.furigana, `${parsed.id} jpn_defs.furigana`);
    if (furigana.length !== glosses.length) {
      throw new TomoshiImportRecordError(parsed.id, `jpn_defs gloss/furigana length mismatch (${glosses.length}/${furigana.length})`);
    }
    let ordinal = nextJapaneseOrdinal.get(row.source) ?? 0;
    glosses.forEach((text, glossOrdinal) => {
      definitionLanguages.add('ja');
      plainText.push(text);
      entryDefinitions.push({
        id: deterministicUuid(entryId, 'entry-definition', row.source, String(ordinal)),
        structuredEntryId: entryId, text, language: 'ja', source: row.source, ordinal,
        provenance: { table: 'jpn_defs', sourceRowOrdinal, glossOrdinal, furigana: furigana[glossOrdinal] as Prisma.InputJsonValue },
      });
      ordinal += 1;
    });
    nextJapaneseOrdinal.set(row.source, ordinal);
  });

  const chinese = parseChineseDefinitions(source.chineseDefinition, parsed.id);
  for (let ordinal = 0; ordinal < parsed.senses.length; ordinal += 1) {
    if (!chinese.has(ordinal)) throw new TomoshiImportRecordError(parsed.id, `zh_defs is missing source sense ordinal ${ordinal}`);
  }
  let chineseSenseNotes = 0;
  let chineseExamples = 0;
  for (const [ordinal, chineseSense] of chinese) {
    const sense = parsed.senses[ordinal];
    const senseId = senseIds[ordinal];
    if (!sense || !senseId) throw new TomoshiImportRecordError(parsed.id, `zh_defs references invalid source sense ordinal ${ordinal}`);
    const embeddedChinese = sense.glosses.filter((gloss) => gloss.language === 'zho').map((gloss) => gloss.text);
    if (!sameStrings(embeddedChinese, chineseSense.glosses)) {
      throw new TomoshiImportRecordError(parsed.id, `zh_defs glosses do not match entries.data.senses[${ordinal}]`);
    }
    chineseSense.glosses.forEach((text, definitionOrdinal) => {
      definitionLanguages.add('zh-CN');
      plainText.push(text);
      senseDefinitions.push({
        id: deterministicUuid(senseId, 'definition', 'tomoshi', String(definitionOrdinal)),
        senseId, text, language: 'zh-CN', source: 'tomoshi', ordinal: definitionOrdinal,
        provenance: { table: 'zh_defs', locale: 'zh-CN', sourceSenseOrdinal: ordinal },
      });
    });
    if (chineseSense.hasNotes) chineseSenseNotes += 1;
    chineseExamples += chineseSense.exampleCount;
  }

  const canonicalHeadword = parsed.forms[0]?.text;
  if (!canonicalHeadword) throw new TomoshiImportRecordError(parsed.id, 'entry has no kanji or kana forms');
  return {
    entry: {
      id: entryId, dictionaryId, headwordOriginal: canonicalHeadword,
      headwordNormalized: normalizeHeadword(canonicalHeadword), sortKey: makeSortKey(canonicalHeadword),
      entryRaw: null, entrySanitizedHtml: null, entryPlainText: plainText.join('\n'),
      entryKind: EntryKind.definition, redirectTargetOriginal: null, sourceOrdinal, sourceRecordId: parsed.id,
    },
    structuredEntry: { entryId }, forms, senses, entryDefinitions, senseDefinitions, definitionLanguages,
    omitted: {
      entryCommonness: 1,
      formCommonness: source.forms.length,
      variantNotes: parsed.hasVariantNote ? 1 : 0,
      chineseSenseNotes,
      chineseExamples,
    },
  };
}

function parseEntry(row: EntryRow): SourceEntry {
  const data = parseJsonObject(row.data, `${row.id} entries.data`);
  if (data.id !== row.id) throw new TomoshiImportRecordError(row.id, 'entries.data.id does not match entries.id');
  const forms: SourceForm[] = [];
  for (const item of requiredArray(data.kanji, row.id, 'kanji')) {
    const form = requiredObject(item, row.id, 'kanji form');
    forms.push({ text: requiredString(form.text, row.id, 'kanji.text'), info: stringArray(form.info, row.id, 'kanji.info'),
      priority: stringArray(form.priority, row.id, 'kanji.priority'), restrictedTo: [], kind: 'kanji' });
  }
  for (const item of requiredArray(data.kana, row.id, 'kana')) {
    const form = requiredObject(item, row.id, 'kana form');
    forms.push({ text: requiredString(form.text, row.id, 'kana.text'), info: stringArray(form.info, row.id, 'kana.info'),
      priority: stringArray(form.priority, row.id, 'kana.priority'),
      restrictedTo: stringArray(form.restricted_to, row.id, 'kana.restricted_to'), kind: 'kana' });
  }
  const senses = requiredArray(data.senses, row.id, 'senses').map((item, ordinal): SourceSense => {
    const sense = requiredObject(item, row.id, `senses[${ordinal}]`);
    const notes = sense.notes === null ? null : requiredString(sense.notes, row.id, `senses[${ordinal}].notes`);
    return {
      pos: stringArray(sense.pos, row.id, `senses[${ordinal}].pos`),
      field: stringArray(sense.field, row.id, `senses[${ordinal}].field`),
      misc: stringArray(sense.misc, row.id, `senses[${ordinal}].misc`),
      notes,
      glosses: requiredArray(sense.glosses, row.id, `senses[${ordinal}].glosses`).map((value, glossOrdinal) => {
        const gloss = requiredObject(value, row.id, `senses[${ordinal}].glosses[${glossOrdinal}]`);
        const language = requiredString(gloss.lang, row.id, 'gloss.lang');
        if (language !== 'eng' && language !== 'zho') throw new TomoshiImportRecordError(row.id, `unsupported gloss language ${language}`);
        const glossType = gloss.gloss_type === null ? null : requiredString(gloss.gloss_type, row.id, 'gloss.gloss_type');
        return { text: requiredString(gloss.text, row.id, 'gloss.text'), language, glossType };
      }),
    };
  });
  return {
    id: row.id, forms, senses,
    isCommon: Boolean(row.is_common),
    hasVariantNote: data.variant_note !== undefined && data.variant_note !== null,
  };
}

function parseChineseDefinitions(row: ChineseDefinitionRow, entryId: string): Map<number, { glosses: string[]; hasNotes: boolean; exampleCount: number }> {
  if (row.entry_id !== entryId || row.locale !== 'zh-CN') throw new TomoshiImportRecordError(entryId, 'invalid zh_defs identity or locale');
  const data = parseJsonObject(row.data, `${entryId} zh_defs.data`);
  const senses = requiredObject(data.senses, entryId, 'zh_defs.data.senses');
  const result = new Map<number, { glosses: string[]; hasNotes: boolean; exampleCount: number }>();
  for (const [key, value] of Object.entries(senses)) {
    if (!/^(0|[1-9]\d*)$/.test(key)) throw new TomoshiImportRecordError(entryId, `invalid zh_defs sense key ${key}`);
    const ordinal = Number(key);
    const sense = requiredObject(value, entryId, `zh_defs.senses.${key}`);
    const glosses = requiredArray(sense.glosses, entryId, `zh_defs.senses.${key}.glosses`).map((item) => {
      const gloss = requiredObject(item, entryId, `zh_defs.senses.${key}.gloss`);
      return requiredString(gloss.text, entryId, `zh_defs.senses.${key}.gloss.text`);
    });
    const examples = sense.examples === undefined ? {} : requiredObject(sense.examples, entryId, `zh_defs.senses.${key}.examples`);
    result.set(ordinal, { glosses, hasNotes: sense.notes !== undefined && sense.notes !== null, exampleCount: Object.keys(examples).length });
  }
  return result;
}

function validateFormsTable(entry: SourceEntry, rows: FormRow[]): void {
  if (rows.length !== entry.forms.length) throw new TomoshiImportRecordError(entry.id, `forms table count ${rows.length} does not match entry JSON count ${entry.forms.length}`);
  rows.forEach((row, ordinal) => {
    const form = entry.forms[ordinal];
    if (row.entry_id !== entry.id || row.text !== form.text || Boolean(row.is_kana) !== (form.kind === 'kana')) {
      throw new TomoshiImportRecordError(entry.id, `forms table row ${ordinal} does not match entry JSON`);
    }
  });
}

class OrderedSourceCursor<T> {
  private current: IteratorResult<T>;
  constructor(private readonly iterator: IterableIterator<T>, private readonly key: (value: T) => string, private readonly table: string) {
    this.current = iterator.next();
  }
  take(entryId: string): T[] {
    if (!this.current.done && this.key(this.current.value) < entryId) {
      throw new InvalidTomoshiSourceError(`${this.table} contains orphan entry_id ${this.key(this.current.value)}`);
    }
    const rows: T[] = [];
    while (!this.current.done && this.key(this.current.value) === entryId) {
      rows.push(this.current.value);
      this.current = this.iterator.next();
    }
    return rows;
  }
  assertExhausted(): void {
    if (!this.current.done) throw new InvalidTomoshiSourceError(`${this.table} contains orphan entry_id ${this.key(this.current.value)}`);
  }
}

function emptyBatch(): PersistBatch {
  return { entries: [], structuredEntries: [], forms: [], senses: [], entryDefinitions: [], senseDefinitions: [] };
}

async function persistBatch(database: PrismaClient, batch: PersistBatch): Promise<void> {
  const operations: Prisma.PrismaPromise<unknown>[] = [
    database.dictionaryEntry.createMany({ data: batch.entries, skipDuplicates: true }),
    database.structuredEntry.createMany({ data: batch.structuredEntries, skipDuplicates: true }),
  ];
  if (batch.forms.length) operations.push(database.form.createMany({ data: batch.forms, skipDuplicates: true }));
  if (batch.senses.length) operations.push(database.sense.createMany({ data: batch.senses, skipDuplicates: true }));
  if (batch.entryDefinitions.length) operations.push(database.entryDefinition.createMany({ data: batch.entryDefinitions, skipDuplicates: true }));
  if (batch.senseDefinitions.length) operations.push(database.senseDefinition.createMany({ data: batch.senseDefinitions, skipDuplicates: true }));
  await database.$transaction(operations);
}

function sourceMetadata(inspection: SourceInspection, checksum: string, result?: unknown): Prisma.InputJsonObject {
  return {
    export: inspection.meta,
    sourceFileSha256: checksum,
    importedTables: [...IMPORTED_TABLES],
    tableLicenses: inspection.tableLicenses,
    sourceCounts: {
      entries: inspection.entries, forms: inspection.forms, jpnDefs: inspection.jpnDefinitions,
      zhDefs: inspection.chineseDefinitions, freqRank: inspection.frequencyRanks, vocabJlpt: inspection.vocabularyJlptLevels,
    },
    ...(result === undefined ? {} : { importResult: result as Prisma.InputJsonValue }),
  };
}

function defaultDictionaryName(meta: Record<string, string | null>): string {
  const exportedAt = meta.exported_at;
  return exportedAt ? `Tomoshi ${exportedAt.slice(0, 10)}` : 'Tomoshi structured dictionary';
}

async function sha256File(filename: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function deterministicUuid(...parts: string[]): string {
  const bytes = crypto.createHash('sha256').update(parts.join('\0')).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type JsonObject = Record<string, unknown>;

function parseJsonObject(value: string, label: string): JsonObject {
  try { return requiredObject(JSON.parse(value), label, 'JSON object'); }
  catch (error) {
    if (error instanceof TomoshiImportRecordError) throw error;
    throw new InvalidTomoshiSourceError(`${label} is invalid JSON: ${errorMessage(error)}`);
  }
}

function parseJsonArray(value: string, label: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new InvalidTomoshiSourceError(`${label} must be a JSON array`);
    return parsed;
  } catch (error) {
    if (error instanceof InvalidTomoshiSourceError) throw error;
    throw new InvalidTomoshiSourceError(`${label} is invalid JSON: ${errorMessage(error)}`);
  }
}

function parseStringArray(value: string, label: string): string[] {
  const parsed = parseJsonArray(value, label);
  if (!parsed.every((item): item is string => typeof item === 'string')) throw new InvalidTomoshiSourceError(`${label} must contain only strings`);
  return parsed;
}

function requiredObject(value: unknown, entryId: string, field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TomoshiImportRecordError(entryId, `${field} must be an object`);
  return value as JsonObject;
}

function requiredArray(value: unknown, entryId: string, field: string): unknown[] {
  if (!Array.isArray(value)) throw new TomoshiImportRecordError(entryId, `${field} must be an array`);
  return value;
}

function requiredString(value: unknown, entryId: string, field: string): string {
  if (typeof value !== 'string') throw new TomoshiImportRecordError(entryId, `${field} must be a string`);
  return value;
}

function stringArray(value: unknown, entryId: string, field: string): string[] {
  const values = requiredArray(value, entryId, field);
  if (!values.every((item): item is string => typeof item === 'string')) throw new TomoshiImportRecordError(entryId, `${field} must contain only strings`);
  return values;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
