import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { TomoshiImportRecordError, TomoshiImporter } from '../src/importer/tomoshi-importer.js';

type FixtureSense = { pos: string[]; en: string[]; zh: string[]; field?: string[]; misc?: string[]; notes?: string | null };
type FixtureEntry = {
  id: string;
  kanji: Array<{ text: string; info?: string[]; priority?: string[] }>;
  kana: Array<{ text: string; info?: string[]; priority?: string[]; restrictedTo?: string[] }>;
  senses: FixtureSense[];
  japanese?: string[];
};

// Abbreviated excerpts from Tomoshi v2026-10-06, raw DB SHA-256:
// 9553113449a87f4da1524012cc8185e2286797571a70c2d9a47bc88ab9720f51.
// These fixtures omit some glosses and replace furigana with empty arrays.
// Data attribution and modification notice: tests/fixtures/tomoshi-NOTICE.md.
const auditedEntries: FixtureEntry[] = [
  {
    id: '1358280',
    kanji: [{ text: '食べる', priority: ['ichi1', 'news2', 'nf25'] }, { text: '喰べる', info: ['search-only kanji form'] }],
    kana: [{ text: 'たべる', priority: ['ichi1', 'news2', 'nf25'] }],
    senses: [
      { pos: ['Ichidan verb', 'transitive verb'], en: ['to eat'], zh: ['吃；食用'] },
      { pos: ['Ichidan verb', 'transitive verb'], en: ['to live on (e.g. a salary)', 'to live off', 'to subsist on'], zh: ['靠……生活；以……为生；依靠……维持生计'] },
    ],
    japanese: ['何かを、口から嚙んで飲み込む。食うの丁寧語', '生計を立てる。くらす。飯を食う。'],
  },
  {
    id: '1567920',
    kanji: [{ text: '曖昧', priority: ['ichi1', 'news2', 'nf35'] }, { text: 'あい昧' }],
    kana: [{ text: 'あいまい', priority: ['ichi1', 'news2', 'nf35'] }],
    senses: [
      { pos: ['adjectival nouns or quasi-adjectives (keiyodoshi)', 'noun (common) (futsuumeishi)'], en: ['vague', 'ambiguous', 'unclear'], zh: ['模糊；含糊；不明确'] },
      { pos: ['adjectival nouns or quasi-adjectives (keiyodoshi)', 'noun (common) (futsuumeishi)'], en: ['shady', 'disreputable'], zh: ['阴暗；可疑；不正当'] },
      { pos: ['adjectival nouns or quasi-adjectives (keiyodoshi)', 'noun (common) (futsuumeishi)'], en: ['fuzzy'], zh: ['模糊的；不确定的'], field: ['mathematics', 'computing'] },
    ],
    japanese: ['分明でないこと。事がはっきりとしないこと。', '後ろ暗いこと。また、そのさま。', '両義性。多義性。'],
  },
  {
    id: '1596090',
    kanji: [{ text: '折角', priority: ['ichi1'] }, { text: '切角', info: ['ateji (phonetic) reading', 'rarely used kanji form'] }],
    kana: [{ text: 'せっかく', priority: ['ichi1'] }],
    senses: [
      { pos: ['adverb (fukushi)', 'noun (common) (futsuumeishi)'], en: ['with trouble', 'at great pains'], zh: ['费力；费劲；好不容易'], misc: ['word usually written using kana alone'] },
      { pos: ["nouns which may take the genitive case particle 'no'"], en: ['rare', 'valuable', 'precious', 'long-awaited'], zh: ['罕见；珍贵；宝贵；难得'], misc: ['word usually written using kana alone'] },
      { pos: ["nouns which may take the genitive case particle 'no'"], en: ['kind', 'generous'], zh: ['亲切；慷慨；善良'], misc: ['word usually written using kana alone'] },
    ],
    japanese: ['わざわざ、骨を折って。', '親切にも。運よく。恵まれたことに。好都合に。'],
  },
  {
    id: '1326820',
    kanji: [{ text: '取り組む', priority: ['ichi1', 'news2', 'nf37'] }, { text: '取組む' }],
    kana: [{ text: 'とりくむ', priority: ['ichi1', 'news2', 'nf37'] }],
    senses: [
      { pos: ["Godan verb with 'mu' ending", 'intransitive verb'], en: ['to grapple with', 'to wrestle with'], zh: ['摔跤；较量；交手'] },
      { pos: ["Godan verb with 'mu' ending", 'intransitive verb'], en: ['to tackle (e.g. a problem)', 'to come to grips with'], zh: ['努力解决；着手处理；认真对付'] },
    ],
    japanese: ['組み合う。相手となり争う。', '真剣に事に当たる。'],
  },
  {
    id: '1450110',
    kanji: [{ text: '踏まえる', priority: ['news1', 'nf05'] }],
    kana: [{ text: 'ふまえる', priority: ['news1', 'nf05'] }],
    senses: [
      { pos: ['Ichidan verb', 'transitive verb'], en: ['to be based on', 'to take into account'], zh: ['基于；考虑到；建立在；源于'] },
      { pos: ['Ichidan verb', 'transitive verb'], en: ["to have one's feet firmly planted on"], zh: ['脚踏实地；站稳脚跟'] },
    ],
    japanese: ['足で踏みつけで押さえる。', '考慮する。', '根拠とする。'],
  },
  {
    id: '1004480',
    kanji: [{ text: '拘る' }, { text: '拘わる' }],
    kana: [{ text: 'こだわる', priority: ['ichi1'] }],
    senses: [
      { pos: ["Godan verb with 'ru' ending", 'intransitive verb'], en: ['to be obsessive (about)', 'to be overly concerned (with)'], zh: ['过分讲究；过分在意；过分关注；固执'], misc: ['word usually written using kana alone'] },
      { pos: ["Godan verb with 'ru' ending", 'intransitive verb'], en: ['to be particular (about)', 'to pay special attention (to)'], zh: ['讲究；注重；坚持；不妥协'], notes: 'positive nuance', misc: ['word usually written using kana alone'] },
      { pos: ["Godan verb with 'ru' ending", 'intransitive verb'], en: ['to get stuck', 'to be obstructed'], zh: ['卡住；受阻'], misc: ['dated term', 'word usually written using kana alone'] },
    ],
    japanese: ['あることを必要以上に気にする。拘泥する。', '普通の人が気にしないようなことに関して好みを持つ。'],
  },
  {
    id: '1004310', kanji: [{ text: '斯う', info: ['rarely used kanji form'] }], kana: [{ text: 'こう', priority: ['spec1'] }],
    senses: [{ pos: ['adverb (fukushi)'], en: ['in this way'], zh: ['这样；如此；这么'], misc: ['word usually written using kana alone'] }],
  },
  {
    id: '1167880', kanji: [{ text: '稲子' }, { text: '蝗' }], kana: [{ text: 'いなご' }, { text: 'こう', restrictedTo: ['蝗'] }, { text: 'イナゴ' }],
    senses: [{ pos: ['noun (common) (futsuumeishi)'], en: ['rice grasshopper (of genus Oxya)'], zh: ['稻蝗；水稻蝗虫'], misc: ['word usually written using kana alone'] }],
  },
];

describe('TomoshiImporter → generic structured schema', () => {
  const temporaryDirectories: string[] = [];
  const dictionaryIds: string[] = [];

  afterAll(async () => {
    if (dictionaryIds.length) await prisma.dictionary.deleteMany({ where: { id: { in: dictionaryIds } } });
    await Promise.all(temporaryDirectories.map((directory) => fs.rm(directory, { recursive: true, force: true })));
    await prisma.$disconnect();
  });

  it('imports audited entries with stable source identity and correctly scoped definitions', async () => {
    const sourcePath = await createFixture(temporaryDirectories, auditedEntries);
    const importer = new TomoshiImporter(prisma);
    const first = await importer.import(sourcePath, { batchSize: 2, name: 'Tomoshi audited fixture' });
    dictionaryIds.push(first.dictionaryId);
    const second = await importer.import(sourcePath, { batchSize: 3 });

    expect(second.dictionaryId).toBe(first.dictionaryId);
    expect(first.entries).toBe(auditedEntries.length);
    expect(first.targetLanguages).toEqual(['en', 'ja', 'zh-CN']);
    expect(first.rejectedRecords).toBe(0);
    expect(first.omitted.frequencyRanks).toBe(auditedEntries.length);
    expect(first.omitted.vocabularyJlptLevels).toBe(auditedEntries.length);
    expect(await prisma.dictionaryEntry.count({ where: { dictionaryId: first.dictionaryId } })).toBe(auditedEntries.length);

    const dictionary = await prisma.dictionary.findUniqueOrThrow({ where: { id: first.dictionaryId } });
    expect(dictionary).toMatchObject({ sourceFormat: 'tomoshi', sourceLanguage: 'ja', contentModel: 'structured' });
    expect(dictionary.targetLanguages).toEqual(['en', 'ja', 'zh-CN']);

    const eat = await prisma.dictionaryEntry.findFirstOrThrow({
      where: { dictionaryId: first.dictionaryId, sourceRecordId: '1358280' },
      include: { structuredEntry: { include: { forms: { orderBy: { ordinal: 'asc' } }, senses: { orderBy: { ordinal: 'asc' }, include: { senseDefinitions: true } }, entryDefinitions: true } } },
    });
    expect(eat.headwordOriginal).toBe('食べる');
    expect(eat.entryRaw).toBeNull();
    expect(eat.entrySanitizedHtml).toBeNull();
    expect(eat.entryPlainText).toContain('吃；食用');
    expect(eat.structuredEntry?.forms.map((form) => [form.text, form.kind, form.ordinal])).toEqual([
      ['食べる', 'kanji', 0], ['喰べる', 'kanji', 1], ['たべる', 'kana', 2],
    ]);
    expect(eat.structuredEntry?.forms[1].tags).toEqual(['search-only kanji form']);
    expect(eat.structuredEntry?.senses.map((sense) => [sense.ordinal, sense.sourceSenseOrdinal])).toEqual([[0, 0], [1, 1]]);
    expect(eat.structuredEntry?.senses[0].senseDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: 'zh-CN', source: 'tomoshi', text: '吃；食用' }),
      expect.objectContaining({ language: 'en', source: 'jmdict', text: 'to eat' }),
    ]));
    expect(eat.structuredEntry?.entryDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: 'ja', source: 'wiktionary', text: '何かを、口から嚙んで飲み込む。食うの丁寧語' }),
    ]));
    expect(eat.structuredEntry?.senses.flatMap((sense) => sense.senseDefinitions).some((definition) => definition.language === 'ja')).toBe(false);

    for (const fixture of auditedEntries) {
      const entry = await prisma.dictionaryEntry.findFirstOrThrow({
        where: { dictionaryId: first.dictionaryId, sourceRecordId: fixture.id },
        include: { structuredEntry: { include: {
          forms: { orderBy: { ordinal: 'asc' } },
          entryDefinitions: { orderBy: { ordinal: 'asc' } },
          senses: { orderBy: { ordinal: 'asc' }, include: { senseDefinitions: { orderBy: { ordinal: 'asc' } } } },
        } } },
      });
      expect(entry.entryRaw).toBeNull();
      expect(entry.entrySanitizedHtml).toBeNull();
      expect(entry.structuredEntry?.forms.map((form) => form.text)).toEqual([...fixture.kanji, ...fixture.kana].map((form) => form.text));
      expect(entry.structuredEntry?.entryDefinitions.map((definition) => definition.text)).toEqual(fixture.japanese ?? []);
      expect(entry.structuredEntry?.senses).toHaveLength(fixture.senses.length);
      entry.structuredEntry?.senses.forEach((sense, ordinal) => {
        expect(sense.sourceSenseOrdinal).toBe(ordinal);
        expect(sense.ordinal).toBe(ordinal);
        expect(sense.senseDefinitions.filter((definition) => definition.language === 'zh-CN').map((definition) => definition.text)).toEqual(fixture.senses[ordinal].zh);
        expect(sense.senseDefinitions.some((definition) => definition.language === 'ja')).toBe(false);
      });
    }

    const duplicateForms = await prisma.form.findMany({
      where: { normalizedText: 'こう', structuredEntry: { entry: { dictionaryId: first.dictionaryId } } },
      select: { structuredEntryId: true },
    });
    expect(duplicateForms).toHaveLength(2);
    expect(new Set(duplicateForms.map((form) => form.structuredEntryId)).size).toBe(2);
  });

  it('rejects an out-of-range Chinese sense ordinal without guessing', async () => {
    const sourcePath = await createFixture(temporaryDirectories, [auditedEntries[0]], true);
    await expect(new TomoshiImporter(prisma).import(sourcePath, { batchSize: 1 })).rejects.toBeInstanceOf(TomoshiImportRecordError);
    const failed = await prisma.dictionary.findFirstOrThrow({ where: { sourceFilename: path.basename(sourcePath) }, orderBy: { createdAt: 'desc' } });
    dictionaryIds.push(failed.id);
    expect(failed.status).toBe('failed');
    expect(failed.failureSummary).toContain('invalid source sense ordinal 99');
    expect(await prisma.dictionaryEntry.count({ where: { dictionaryId: failed.id } })).toBe(0);
  });
});

async function createFixture(directories: string[], entries: FixtureEntry[], invalidOrdinal = false): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tomoshi-importer-'));
  directories.push(directory);
  const filename = path.join(directory, `tomoshi-${crypto.randomUUID()}.db`);
  const database = new DatabaseSync(filename);
  database.exec(`
    CREATE TABLE entries (id TEXT PRIMARY KEY, is_common INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE forms (text TEXT NOT NULL, entry_id TEXT NOT NULL, is_kana INTEGER NOT NULL, is_common INTEGER NOT NULL);
    CREATE TABLE jpn_defs (entry_id TEXT NOT NULL, source TEXT NOT NULL, glosses TEXT NOT NULL, furigana TEXT NOT NULL);
    CREATE TABLE zh_defs (entry_id TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'zh-CN', data TEXT NOT NULL, PRIMARY KEY (entry_id, locale));
    CREATE TABLE freq_rank (entry_id TEXT PRIMARY KEY, rank INTEGER NOT NULL);
    CREATE TABLE vocab_jlpt (entry_id TEXT PRIMARY KEY, level TEXT NOT NULL, source TEXT NOT NULL);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE table_licenses (table_name TEXT PRIMARY KEY, license TEXT, source_db TEXT, attribution TEXT);
  `);
  database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('export_version', '2');
  database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('source_schema_version', '16');
  database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('exported_at', '2026-10-06T02:21:13+0900');
  for (const table of ['entries', 'forms', 'jpn_defs', 'zh_defs']) {
    database.prepare('INSERT INTO table_licenses VALUES (?, ?, ?, ?)').run(table, 'CC BY-SA 4.0', table === 'jpn_defs' ? 'wiktionary' : 'jmdict', 'fixture attribution');
  }
  const insertEntry = database.prepare('INSERT INTO entries VALUES (?, ?, ?)');
  const insertForm = database.prepare('INSERT INTO forms VALUES (?, ?, ?, ?)');
  const insertJapanese = database.prepare('INSERT INTO jpn_defs VALUES (?, ?, ?, ?)');
  const insertChinese = database.prepare('INSERT INTO zh_defs VALUES (?, ?, ?)');
  entries.forEach((entry, entryIndex) => {
    const data = {
      id: entry.id,
      kanji: entry.kanji.map((form) => ({ text: form.text, info: form.info ?? [], priority: form.priority ?? [] })),
      kana: entry.kana.map((form) => ({ text: form.text, info: form.info ?? [], priority: form.priority ?? [], restricted_to: form.restrictedTo ?? [] })),
      senses: entry.senses.map((sense) => ({
        pos: sense.pos,
        glosses: [...sense.en.map((text) => ({ text, lang: 'eng', gloss_type: null })), ...sense.zh.map((text) => ({ text, lang: 'zho', gloss_type: null }))],
        notes: sense.notes ?? null,
        field: sense.field ?? [],
        misc: sense.misc ?? [],
      })),
      is_common: true,
      variant_note: entryIndex === 0 ? { common: 'audited fixture note' } : undefined,
    };
    insertEntry.run(entry.id, 1, JSON.stringify(data));
    entry.kanji.forEach((form) => insertForm.run(form.text, entry.id, 0, 1));
    entry.kana.forEach((form) => insertForm.run(form.text, entry.id, 1, 1));
    if (entry.japanese) insertJapanese.run(entry.id, 'wiktionary', JSON.stringify(entry.japanese), JSON.stringify(entry.japanese.map(() => [])));
    const chineseSenses = Object.fromEntries(entry.senses.map((sense, ordinal) => [String(ordinal), { glosses: sense.zh.map((text) => ({ text })) }]));
    if (invalidOrdinal) chineseSenses['99'] = { glosses: [{ text: 'invalid mapping' }] };
    insertChinese.run(entry.id, 'zh-CN', JSON.stringify({ senses: chineseSenses }));
    if (Number(entry.id) % 2 === 0) {
      database.prepare('INSERT INTO freq_rank VALUES (?, ?)').run(entry.id, Number(entry.id) % 30_000);
      database.prepare('INSERT INTO vocab_jlpt VALUES (?, ?, ?)').run(entry.id, 'N2', 'waller');
    }
  });
  database.close();
  return filename;
}
