import 'dotenv/config';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prisma } from '../db.js';
import { TomoshiImporter } from '../importer/tomoshi-importer.js';

export async function runTomoshiImport(argv = process.argv.slice(2)): Promise<void> {
  const inputPath = argv[0];
  if (!inputPath) throw new Error('Usage: npm run import-tomoshi -- /path/tomoshi-dict-open.db [--name "Dictionary name"]');
  const nameIndex = argv.indexOf('--name');
  const name = nameIndex === -1 ? undefined : argv[nameIndex + 1];
  if (nameIndex !== -1 && !name) throw new Error('--name requires a value');
  const summary = await new TomoshiImporter(prisma).import(path.resolve(inputPath), {
    name,
    onProgress: ({ current, total }) => {
      if (current === total || current % 10_000 === 0) console.log(`Imported ${current}/${total} entries`);
    },
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTomoshiImport().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
