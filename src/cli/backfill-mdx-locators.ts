import { prisma } from '../db.js';
import { config } from '../config.js';
import { LocalDirectoryStorage } from '../storage/local-directory-storage.js';
import { JsMdictLazyAdapter } from '../mdx/lazy-mdx-adapter.js';
import { DictionaryNotFoundForLocatorBackfillError, MdxLocatorBackfillService } from '../entries/mdx-locator-backfill-service.js';

const args = process.argv.slice(2);
const dictionaryId = args[0];
const apply = args.includes('--apply');
const dryRun = args.includes('--dry-run');
const batchOption = args.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchOption ? Number(batchOption.slice('--batch-size='.length)) : 500;
const known = new Set(['--apply', '--dry-run', ...(batchOption ? [batchOption] : [])]);
if (!dictionaryId || (apply && dryRun) || args.slice(1).some((arg) => !known.has(arg))) {
  console.error('Usage: npm run backfill-mdx-locators -- <dictionaryId> [--dry-run | --apply] [--batch-size=500]');
  process.exitCode = 2;
} else {
  const adapter = new JsMdictLazyAdapter();
  try {
    const storage = new LocalDirectoryStorage(config.dataDir);
    const service = new MdxLocatorBackfillService(prisma, adapter, (key) => storage.pathFor(key));
    const summary = await service.backfill(dictionaryId, { apply, batchSize, onProgress: (p) => { if (p.processed === p.total || p.processed % 10_000 === 0) console.log(`Processed: ${p.processed} / ${p.total} | Mappable: ${p.mappable} | Existing: ${p.alreadyPopulated} | Written: ${p.written} | Failed: ${p.failures}`); } });
    console.log(JSON.stringify({ ...summary, elapsedMs: Math.round(summary.elapsedMs), entriesPerSecond: summary.elapsedMs ? Math.round(summary.processed / (summary.elapsedMs / 1000)) : null }, null, 2));
    if (summary.failures || summary.collisions) process.exitCode = 1;
  } catch (error) {
    if (error instanceof DictionaryNotFoundForLocatorBackfillError || error instanceof RangeError) { console.error(error.message); process.exitCode = 2; }
    else throw error;
  } finally { adapter.close(); await prisma.$disconnect(); }
}
