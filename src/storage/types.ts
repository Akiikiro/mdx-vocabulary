import type { Readable } from 'node:stream';
export interface StoredFile { storageKey: string; checksum: string; sizeBytes: number; }
export interface DictionaryStorage {
  save(input: Readable, sourceFilename: string): Promise<StoredFile>;
  open(storageKey: string): Promise<Readable>;
  remove(storageKey: string): Promise<void>;
}
