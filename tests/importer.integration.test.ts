import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { PostgresJobQueue } from '../src/jobs/postgres-job-queue.js';
import { MdxImporter } from '../src/importer/mdx-importer.js';
import type { MdxParserAdapter } from '../src/mdx/types.js';

const adapter: MdxParserAdapter = {
  inspect: async () => ({ header: { Title: 'fixture' }, mdxVersion: '2.0', encoding: 'UTF-8', entryCount: 2 }),
  async *iterateEntries() { yield { headword: 'apple', rawEntry: '<span>apple <b>苹果</b></span>', redirectTarget: null }; yield { headword: 'apples', rawEntry: '@@@LINK=apple\0', redirectTarget: 'apple' }; },
};
describe('MDX importer → PostgreSQL', () => {
  let dictionaryId: string;
  beforeAll(async () => { const d = await prisma.dictionary.create({ data: { name: 'integration-fixture', sourceFilename: 'fixture.mdx', fileChecksum: crypto.randomUUID(), storageKey: 'fixture.mdx', status: 'queued' } }); dictionaryId = d.id; });
  afterAll(async () => { await prisma.dictionary.delete({ where: { id: dictionaryId } }); await prisma.$disconnect(); });
  it('persists normalized entries, HTML, plain text, and redirects', async () => {
    const queue = new PostgresJobQueue(prisma); const jobId = await queue.enqueue(dictionaryId); await prisma.importJob.update({ where: { id: jobId }, data: { status: 'running' } });
    await new MdxImporter(prisma, queue, adapter, 1, (key) => key).import(jobId);
    const rows = await prisma.dictionaryEntry.findMany({ where: { dictionaryId }, orderBy: { sourceOrdinal: 'asc' } });
    expect(rows).toHaveLength(2); expect(rows[0].headwordNormalized).toBe('apple'); expect(rows[0].entryPlainText).toBe('apple 苹果'); expect(rows[1].entryKind).toBe('redirect'); expect(rows[1].redirectTargetOriginal).toBe('apple');
  });
});
