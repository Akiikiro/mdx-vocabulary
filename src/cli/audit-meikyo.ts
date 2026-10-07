import path from 'node:path';
import { auditMeikyoCorpus } from '../meikyo/meikyo-corpus-audit.js';

export async function runMeikyoAudit(argv = process.argv.slice(2)): Promise<void> {
  const [sourcePath] = argv;
  if (!sourcePath) throw new Error('Usage: npm run audit-meikyo -- <StarDict directory, .ifo, or base path>');
  const summary = await auditMeikyoCorpus(path.resolve(sourcePath));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.parseFailures !== 0 || summary.contentLossFailures !== 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMeikyoAudit().catch((error) => { console.error(error); process.exitCode = 1; });
}
