import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { MeikyoImportBatchError, MeikyoImporter } from '../src/importer/meikyo-importer.js';
import { projectMeikyoEntry } from '../src/meikyo/meikyo-canonical-projector.js';

const directories: string[] = [];
const dictionaryIds: string[] = [];

afterAll(async () => {
  await prisma.dictionary.deleteMany({ where: { id: { in: dictionaryIds } } }).catch(() => undefined);
  await prisma.$disconnect();
  await Promise.all(directories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })));
});

describe('MeikyoImporter persistence', () => {
  it('persists a projected lexical graph and keeps custom links source-only', async () => {
    const source = await fixture([
      { headword: '一生懸命', text: 'いっしょう‐けんめい［一生懸命］\n【形動・副】\n◯全力を尽くして物事をするさま。/拼命。\n｢~働く/拼命地工作｣\n▶一般注記\n⑴補足。/补充。\nunknown payload' },
      { headword: '&c', text: 'etching @@@LINK=░エッチング░【etching】🗏0331№5379⚠️补' },
    ]);
    const summary = await new MeikyoImporter(prisma).import(source, { batchSize: 2, name: 'Meikyo fixture' });
    dictionaryIds.push(summary.dictionaryId);
    expect(summary).toMatchObject({ sourceRecords: 2, entries: 1, customLinksDeferred: 1, forms: 2, senses: 0,
      entryDefinitions: 2, senseDefinitions: 0, examples: 1, exampleTexts: 2, contentBlocks: 6, contentTexts: 8, sourceArtifacts: 2, rejectedRecords: 0 });

    const records = await prisma.dictionarySourceRecord.findMany({ where: { dictionaryId: summary.dictionaryId },
      orderBy: { sourceOrdinal: 'asc' }, include: { artifacts: true, entry: { include: { structuredEntry: {
        include: { forms: true, senses: true, entryDefinitions: true, examples: { include: { texts: true } },
          contentBlocks: { include: { texts: true } } },
      } } } } });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ sourceKey: 'stardict:0', recordKind: 'lexical', rawPayload: expect.stringContaining('いっしょう'),
      entry: { headwordOriginal: '一生懸命', structuredEntry: { senses: [], forms: expect.arrayContaining([
        expect.objectContaining({ text: '一生懸命', ordinal: 0 }), expect.objectContaining({ text: 'いっしょうけんめい', ordinal: 1 }),
      ]) } }, artifacts: [expect.objectContaining({ parserName: 'MeikyoParser', parserVersion: '1', representationVersion: 1 })] });
    const structured = records[0].entry!.structuredEntry!;
    expect(structured.entryDefinitions.map((item) => [item.language, item.text])).toEqual([['ja', '全力を尽くして物事をするさま。'], ['zh-CN', '拼命。']]);
    expect(structured.examples[0].texts.map((item) => [item.language, item.text])).toEqual([['ja', '~働く'], ['zh-CN', '拼命地工作']]);
    expect(structured.contentBlocks.sort((a, b) => a.ordinal - b.ordinal)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'definition' }), expect.objectContaining({ kind: 'example' }),
      expect.objectContaining({ kind: 'subdivision', parentBlockId: expect.any(String) }), expect.objectContaining({ kind: 'raw' }),
    ]));
    expect(records[1]).toMatchObject({ sourceKey: 'stardict:1', recordKind: 'deferred-custom-link', entryId: null, entry: null });
    expect(await prisma.dictionaryEntry.count({ where: { dictionaryId: summary.dictionaryId } })).toBe(1);
    expect(await prisma.entrySourceArtifact.count({ where: { entry: { dictionaryId: summary.dictionaryId } } })).toBe(0);
  });

  it('is idempotent and preserves DictionaryEntry and VocabularyItem identity', async () => {
    const source = await fixture([{ headword: '曖昧', text: 'あいまい［曖昧］\n【形動】\n◯はっきりしない。/暧昧。' }]);
    const importer = new MeikyoImporter(prisma); const first = await importer.import(source, { batchSize: 1 }); dictionaryIds.push(first.dictionaryId);
    const entry = await prisma.dictionaryEntry.findFirstOrThrow({ where: { dictionaryId: first.dictionaryId } });
    const vocabulary = await prisma.vocabularyItem.create({ data: { entryId: entry.id } });
    const before = await counts(first.dictionaryId); const second = await importer.import(source, { batchSize: 1 });
    expect(second.dictionaryId).toBe(first.dictionaryId); expect(await counts(first.dictionaryId)).toEqual(before);
    expect(await prisma.vocabularyItem.findUnique({ where: { id: vocabulary.id } })).toMatchObject({ entryId: entry.id });
    expect((await prisma.dictionaryEntry.findFirstOrThrow({ where: { dictionaryId: first.dictionaryId } })).id).toBe(entry.id);
  });

  it('resumes safely after interruption at a committed batch boundary', async () => {
    const source = await fixture([
      { headword: '食べる', text: '【他下一】\n①食物を取る。/吃。' },
      { headword: 'せっかく', text: '【名・副】\n◯特別な機会。/特意。' },
      { headword: '覚える', text: '【他下一】\n①記憶する。/记住。' },
    ]);
    const importer = new MeikyoImporter(prisma); let interruptedId = '';
    await expect(importer.import(source, { batchSize: 1, onProgress: ({ current }) => { if (current === 1) throw new Error('fixture interruption'); } })).rejects.toThrow('fixture interruption');
    const failed = await prisma.dictionary.findFirstOrThrow({ where: { name: 'fixture', status: 'failed' }, orderBy: { createdAt: 'desc' } });
    interruptedId = failed.id; dictionaryIds.push(interruptedId);
    expect(await prisma.dictionarySourceRecord.count({ where: { dictionaryId: interruptedId } })).toBe(1);
    const resumed = await importer.import(source, { batchSize: 2 });
    expect(resumed.dictionaryId).toBe(interruptedId);
    expect(await prisma.dictionarySourceRecord.count({ where: { dictionaryId: interruptedId } })).toBe(3);
    expect(await prisma.dictionaryEntry.count({ where: { dictionaryId: interruptedId } })).toBe(3);
    expect((await prisma.dictionary.findUniqueOrThrow({ where: { id: interruptedId } })).status).toBe('ready');
  });

  it('retains old parser artifacts when a bumped parser version is reprocessed', async () => {
    const source = await fixture([{ headword: 'おぼえる', text: '【他下一】\n①記憶する。/记住。' }]);
    const first = await new MeikyoImporter(prisma).import(source, { batchSize: 1 }); dictionaryIds.push(first.dictionaryId);
    const versionTwo = new MeikyoImporter(prisma, { project: (ast) => {
      const projected = projectMeikyoEntry(ast);
      return { ...projected, sourceArtifact: { ...projected.sourceArtifact, parserVersion: '2' } };
    } });
    await versionTwo.import(source, { batchSize: 1 });
    const record = await prisma.dictionarySourceRecord.findFirstOrThrow({ where: { dictionaryId: first.dictionaryId }, include: { artifacts: true } });
    expect(record.artifacts.map((artifact) => artifact.parserVersion).sort()).toEqual(['1', '2']);
    expect((await prisma.dictionary.findUniqueOrThrow({ where: { id: first.dictionaryId } })).parserVersion).toBe('2');
  });

  it('creates a distinct dictionary snapshot when source bytes change', async () => {
    const firstSource = await fixture([{ headword: '語', text: '【名】\n◯ことば。/词语。' }]);
    const secondSource = await fixture([{ headword: '語', text: '【名】\n◯ことば。/词语，语言。' }]);
    const importer = new MeikyoImporter(prisma); const first = await importer.import(firstSource); const second = await importer.import(secondSource);
    dictionaryIds.push(first.dictionaryId, second.dictionaryId);
    expect(second.dictionaryId).not.toBe(first.dictionaryId);
    const dictionaries = await prisma.dictionary.findMany({ where: { id: { in: [first.dictionaryId, second.dictionaryId] } } });
    expect(new Set(dictionaries.map((item) => item.fileChecksum)).size).toBe(2);
  });

  it('rolls back a whole batch on persistence failure and reports its source identities', async () => {
    const source = await fixture([
      { headword: '甲', text: '【名】\n◯第一。/第一。\n▶注記' },
      { headword: '乙', text: '【名】\n◯第二。/第二。' },
    ]);
    const importer = new MeikyoImporter(prisma, {
      project: (ast) => {
        const projected = projectMeikyoEntry(ast);
        if (projected.kind === 'entry' && projected.contentBlocks.length > 1) projected.contentBlocks[1].ordinal = projected.contentBlocks[0].ordinal;
        return projected;
      },
      validate: () => ({ valid: true, issues: [] }),
    });
    await expect(importer.import(source, { batchSize: 2 })).rejects.toBeInstanceOf(MeikyoImportBatchError);
    const failed = await prisma.dictionary.findFirstOrThrow({ where: { name: 'fixture', status: 'failed' }, orderBy: { createdAt: 'desc' } });
    dictionaryIds.push(failed.id);
    expect(failed.failureSummary).toContain('stardict:0'); expect(failed.failureSummary).toContain('甲');
    expect(await prisma.dictionarySourceRecord.count({ where: { dictionaryId: failed.id } })).toBe(0);
    expect(await prisma.dictionaryEntry.count({ where: { dictionaryId: failed.id } })).toBe(0);
  });
});

async function counts(dictionaryId: string) {
  const entries = await prisma.dictionaryEntry.findMany({ where: { dictionaryId }, select: { id: true } }); const ids = entries.map((entry) => entry.id);
  return {
    sourceRecords: await prisma.dictionarySourceRecord.count({ where: { dictionaryId } }),
    artifacts: await prisma.dictionarySourceArtifact.count({ where: { sourceRecord: { dictionaryId } } }),
    entries: entries.length, structured: await prisma.structuredEntry.count({ where: { entryId: { in: ids } } }),
    forms: await prisma.form.count({ where: { structuredEntryId: { in: ids } } }),
    definitions: await prisma.entryDefinition.count({ where: { structuredEntryId: { in: ids } } }),
    examples: await prisma.example.count({ where: { structuredEntryId: { in: ids } } }),
    blocks: await prisma.contentBlock.count({ where: { structuredEntryId: { in: ids } } }),
  };
}

async function fixture(entries: Array<{ headword: string; text: string }>): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'meikyo-importer-')); directories.push(directory);
  const payloadParts = entries.map((entry) => Buffer.from(entry.text)); const indexParts: Buffer[] = []; let offset = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const numbers = Buffer.alloc(8); numbers.writeUInt32BE(offset, 0); numbers.writeUInt32BE(payloadParts[index].length, 4);
    indexParts.push(Buffer.from(`${entries[index].headword}\0`), numbers); offset += payloadParts[index].length;
  }
  const idx = Buffer.concat(indexParts);
  await fs.promises.writeFile(path.join(directory, 'fixture.ifo'), `StarDict's dict ifo file\nversion=3.0.0\nbookname=fixture\nwordcount=${entries.length}\nidxfilesize=${idx.length}\nsametypesequence=m\n`);
  await fs.promises.writeFile(path.join(directory, 'fixture.idx'), idx);
  await fs.promises.writeFile(path.join(directory, 'fixture.dict.dz'), zlib.gzipSync(Buffer.concat(payloadParts)));
  return directory;
}
