import type { ImportJob } from '@prisma/client';
export type JobId = string;
export interface JobProgress { current: number; total?: number; }
export interface JobFailure { message: string; }
export interface JobQueue {
  enqueue(dictionaryId: string): Promise<JobId>;
  claimNext(workerId: string): Promise<ImportJob | null>;
  updateProgress(jobId: string, progress: JobProgress): Promise<void>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, failure: JobFailure): Promise<void>;
}
