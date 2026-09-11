import 'dotenv/config';
import path from 'node:path';

export const config = {
  databaseUrl: process.env.DATABASE_URL!,
  dataDir: path.resolve(process.env.APP_DATA_DIR ?? './data'),
  batchSize: Number(process.env.IMPORT_BATCH_SIZE ?? '100'),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL?.trim() || null,
};

if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
