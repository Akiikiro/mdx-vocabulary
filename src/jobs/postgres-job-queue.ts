import { Prisma, PrismaClient, type ImportJob } from '@prisma/client';
import type { JobFailure, JobId, JobProgress, JobQueue } from './types.js';

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly db: PrismaClient) {}
  async enqueue(dictionaryId: string): Promise<JobId> { return (await this.db.importJob.create({ data: { dictionaryId } })).id; }
  async claimNext(workerId: string): Promise<ImportJob | null> {
    const rows = await this.db.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE import_jobs SET status = 'running', claimed_by = ${workerId}, claimed_at = NOW(), attempt_count = attempt_count + 1
      WHERE id = (SELECT id FROM import_jobs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id`);
    return rows[0] ? this.db.importJob.findUnique({ where: { id: rows[0].id } }) : null;
  }
  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    await this.db.importJob.update({ where: { id: jobId }, data: { progressCurrent: progress.current, ...(progress.total === undefined ? {} : { progressTotal: progress.total }) } });
  }
  async complete(jobId: string): Promise<void> { await this.db.importJob.update({ where: { id: jobId }, data: { status: 'completed', completedAt: new Date() } }); }
  async fail(jobId: string, failure: JobFailure): Promise<void> { await this.db.importJob.update({ where: { id: jobId }, data: { status: 'failed', errorDetail: failure.message.slice(0, 8000), completedAt: new Date() } }); }
}
