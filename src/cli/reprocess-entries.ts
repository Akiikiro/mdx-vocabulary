import { prisma } from '../db.js';
import {
  DictionaryEntryReprocessingService,
  DictionaryNotFoundForReprocessingError,
} from '../entries/dictionary-entry-reprocessing-service.js';

const args = process.argv.slice(2);
const dictionaryId = args[0];
const apply = args.includes('--apply');
const dryRun = args.includes('--dry-run');
const batchOption = args.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchOption ? Number(batchOption.slice('--batch-size='.length)) : 500;
const knownOptions = new Set(['--apply', '--dry-run', ...(batchOption ? [batchOption] : [])]);

if (!dictionaryId || (apply && dryRun) || args.slice(1).some((arg) => !knownOptions.has(arg))) {
  console.error('Usage: npm run reprocess-entries -- <dictionaryId> [--dry-run | --apply] [--batch-size=500]');
  process.exitCode = 2;
} else {
  try {
    const service = new DictionaryEntryReprocessingService(prisma);
    let lastReported = 0;
    const summary = await service.reprocess(dictionaryId, {
      apply,
      batchSize,
      onProgress: (progress) => {
        if (progress.processed !== progress.total && progress.processed - lastReported < 10_000) return;
        lastReported = progress.processed;
        console.log(`Processed: ${progress.processed} / ${progress.total} | Changed: ${progress.entriesChanged} | HTML: ${progress.sanitizedHtmlChanged} | Plain text: ${progress.entryPlainTextChanged} | Unchanged: ${progress.unchanged} | Failed: ${progress.failed}`);
      },
    });
    console.log(JSON.stringify({
      dictionary: { id: summary.dictionaryId, name: summary.dictionaryName, packageBacked: summary.packageBacked },
      mode: summary.mode,
      scanned: summary.processed,
      entriesChanged: summary.entriesChanged,
      sanitizedHtmlChanged: summary.sanitizedHtmlChanged,
      entryPlainTextChanged: summary.entryPlainTextChanged,
      unchanged: summary.unchanged,
      failed: summary.failed,
      elapsedMs: Math.round(summary.elapsedMs),
      entriesPerSecond: summary.elapsedMs > 0 ? Math.round(summary.processed / (summary.elapsedMs / 1000)) : null,
      failures: summary.failures,
    }, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    if (error instanceof DictionaryNotFoundForReprocessingError || error instanceof RangeError) {
      console.error(error.message);
      process.exitCode = 2;
    } else {
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}
