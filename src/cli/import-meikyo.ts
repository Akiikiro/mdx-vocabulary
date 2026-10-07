import 'dotenv/config';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prisma } from '../db.js';
import { MeikyoImporter } from '../importer/meikyo-importer.js';

export async function runMeikyoImport(argv = process.argv.slice(2)): Promise<void> {
  const inputPath = argv[0];
  if (!inputPath) throw new Error('Usage: npm run import-meikyo -- /path/to/stardict-directory [--name "Dictionary name"] [--batch-size 100]');
  const nameIndex = argv.indexOf('--name'); const name = nameIndex === -1 ? undefined : argv[nameIndex + 1];
  if (nameIndex !== -1 && !name) throw new Error('--name requires a value');
  const batchIndex = argv.indexOf('--batch-size'); const batchRaw = batchIndex === -1 ? undefined : argv[batchIndex + 1];
  if (batchIndex !== -1 && !batchRaw) throw new Error('--batch-size requires a value');
  const batchSize = batchRaw === undefined ? undefined : Number(batchRaw);
  const summary = await new MeikyoImporter(prisma).import(path.resolve(inputPath), {
    name, batchSize,
    onProgress: ({ current, total }) => { if (current === total || current % 10_000 === 0) console.log(`Imported ${current}/${total} source records`); },
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMeikyoImport().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
