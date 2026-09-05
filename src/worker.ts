import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { prisma } from './db.js';
import { PostgresJobQueue } from './jobs/postgres-job-queue.js';
import { MdxImporter } from './importer/mdx-importer.js';
import { JsMdictAdapter } from './mdx/js-mdict-adapter.js';
import { LocalDirectoryStorage } from './storage/local-directory-storage.js';

export async function runWorker(onlyJobId?: string): Promise<void> {
  const queue = new PostgresJobQueue(prisma);
  const storage = new LocalDirectoryStorage(config.dataDir);
  const importer = new MdxImporter(prisma, queue, new JsMdictAdapter(), config.batchSize, (key) => storage.pathFor(key));
  const workerId = `${process.pid}-${crypto.randomUUID()}`;
  for (;;) {
    let job;
    if (onlyJobId) {
      const claimed = await prisma.importJob.updateMany({ where: { id: onlyJobId, status: 'queued' }, data: { status: 'running', claimedBy: workerId, claimedAt: new Date(), attemptCount: { increment: 1 } } });
      job = claimed.count ? await prisma.importJob.findUniqueOrThrow({ where: { id: onlyJobId } }) : null;
    } else {
      job = await queue.claimNext(workerId);
    }
    if (!job) return;
    await importer.import(job.id);
    if (onlyJobId) return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorker(process.argv[2]).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
