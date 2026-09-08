import { prisma } from '../db.js';
import { config } from '../config.js';
import { JsMdictLazyAdapter } from '../mdx/lazy-mdx-adapter.js';
import { LocalDirectoryStorage } from '../storage/local-directory-storage.js';
import { DictionaryQueryService } from '../query/dictionary-query-service.js';
import { LazyDictionaryDetailPocService } from '../query/lazy-dictionary-detail-poc-service.js';
import { DictionaryDetailShadowVerifier } from '../query/dictionary-detail-shadow-verifier.js';
import { LazyDetailDiagnosticService } from '../query/lazy-detail-diagnostic-service.js';

const args = process.argv.slice(2); const dictionaryId = args[0]; const all = args.includes('--all');
const sampleArg = args.find((x) => x.startsWith('--sample-size=')); const seedArg = args.find((x) => x.startsWith('--seed=')); const concurrencyArg = args.find((x) => x.startsWith('--concurrency='));
const known = new Set(['--all', ...(sampleArg ? [sampleArg] : []), ...(seedArg ? [seedArg] : []), ...(concurrencyArg ? [concurrencyArg] : [])]);
if (!dictionaryId || (all && sampleArg !== undefined) || args.slice(1).some((x) => !known.has(x))) {
  console.error('Usage: npm run verify-lazy-detail -- <dictionaryId> [--sample-size=1000 | --all] [--seed=value] [--concurrency=2]'); process.exitCode = 2;
} else {
  const adapter = new JsMdictLazyAdapter();
  try {
    const storage = new LocalDirectoryStorage(config.dataDir); const lazy = new LazyDictionaryDetailPocService(prisma, adapter, (key) => storage.pathFor(key));
    const shadow = new DictionaryDetailShadowVerifier(prisma, lazy); const diagnostic = new LazyDetailDiagnosticService(prisma, new DictionaryQueryService(prisma), shadow);
    const summary = await diagnostic.run(dictionaryId, { all, sampleSize: sampleArg ? Number(sampleArg.slice(14)) : undefined, seed: seedArg?.slice(7), concurrency: concurrencyArg ? Number(concurrencyArg.slice(14)) : undefined });
    console.log(JSON.stringify(summary, null, 2)); if (summary.failure || summary.mismatch) process.exitCode = 1;
  } finally { adapter.close(); await prisma.$disconnect(); }
}
