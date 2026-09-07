import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { PostgresJobQueue } from '../jobs/postgres-job-queue.js';
import { LocalDirectoryStorage } from '../storage/local-directory-storage.js';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: npm run import-mdx -- /path/file.mdx [--stylesheet-url /dictionaries/name/style.css]');
const stylesheetOptionIndex = process.argv.indexOf('--stylesheet-url', 3);
const stylesheetUrl = stylesheetOptionIndex === -1 ? null : process.argv[stylesheetOptionIndex + 1];
if (stylesheetOptionIndex !== -1 && (!stylesheetUrl || !stylesheetUrl.startsWith('/') || stylesheetUrl.startsWith('//'))) {
  throw new Error('--stylesheet-url must be a root-relative URL such as /dictionaries/name/style.css');
}
const absolutePath = path.resolve(inputPath);
if (path.extname(absolutePath).toLowerCase() !== '.mdx') throw new Error('Only .mdx files are supported');
await fs.promises.access(absolutePath, fs.constants.R_OK);
const storage = new LocalDirectoryStorage(config.dataDir);
const stored = await storage.save(fs.createReadStream(absolutePath), path.basename(absolutePath));
const dictionary = await prisma.dictionary.create({ data: { name: path.basename(absolutePath, '.mdx'), sourceFilename: path.basename(absolutePath), fileChecksum: stored.checksum, storageKey: stored.storageKey, status: 'queued', stylesheetUrl } });
const queue = new PostgresJobQueue(prisma); const jobId = await queue.enqueue(dictionary.id);
const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts', jobId], { cwd: process.cwd(), stdio: 'inherit', env: process.env });
const exitCode = await new Promise<number>((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => resolve(code ?? 1)); });
const result = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId }, include: { dictionary: true } });
const redirects = await prisma.dictionaryEntry.count({ where: { dictionaryId: dictionary.id, entryKind: 'redirect' } });
const durationMs = result.completedAt ? result.completedAt.getTime() - result.createdAt.getTime() : 0;
console.log(`\nDictionary: ${result.dictionary.name}\nStatus: ${result.dictionary.status}\n\nMDX version: ${result.dictionary.mdxFormatVersion}\nEncoding: ${result.dictionary.sourceEncoding}\n\nEntries: ${result.dictionary.entryCount}\nImported: ${result.progressCurrent}\nRedirects: ${redirects}\nFailed: ${result.status === 'failed' ? 1 : 0}\n\nDuration: ${(durationMs / 1000).toFixed(2)}s\nEntries/sec: ${durationMs ? (result.progressCurrent / (durationMs / 1000)).toFixed(2) : 'n/a'}`);
await prisma.$disconnect(); process.exitCode = exitCode;
