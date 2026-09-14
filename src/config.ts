import 'dotenv/config';
import path from 'node:path';

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL!,
  dataDir: path.resolve(process.env.APP_DATA_DIR ?? './data'),
  batchSize: Number(process.env.IMPORT_BATCH_SIZE ?? '100'),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL?.trim() || null,
  ollamaRequestTimeoutMs: positiveIntegerEnvironment('OLLAMA_REQUEST_TIMEOUT_MS', 15_000),
  ollamaColdStartTimeoutMs: positiveIntegerEnvironment('OLLAMA_COLD_START_TIMEOUT_MS', 180_000),
  ollamaGenerationTimeoutMs: positiveIntegerEnvironment('OLLAMA_GENERATION_TIMEOUT_MS', 60_000),
};

if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
