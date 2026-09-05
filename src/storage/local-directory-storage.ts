import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { DictionaryStorage, StoredFile } from './types.js';

export class LocalDirectoryStorage implements DictionaryStorage {
  constructor(private readonly rootDirectory: string) {}
  async save(input: NodeJS.ReadableStream, _sourceFilename: string): Promise<StoredFile> {
    await fsp.mkdir(this.rootDirectory, { recursive: true });
    const storageKey = `${crypto.randomUUID()}.mdx`;
    const finalPath = path.join(this.rootDirectory, storageKey);
    const temporaryPath = `${finalPath}.part`;
    const hash = crypto.createHash('sha256'); let sizeBytes = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); sizeBytes += chunk.length; callback(null, chunk); } });
    try { await pipeline(input, meter, fs.createWriteStream(temporaryPath, { flags: 'wx' })); await fsp.rename(temporaryPath, finalPath); }
    catch (error) { await fsp.rm(temporaryPath, { force: true }); throw error; }
    return { storageKey, checksum: hash.digest('hex'), sizeBytes };
  }
  async open(storageKey: string): Promise<fs.ReadStream> { return fs.createReadStream(path.join(this.rootDirectory, storageKey)); }
  async remove(storageKey: string): Promise<void> { await fsp.rm(path.join(this.rootDirectory, storageKey), { force: true }); }
  pathFor(storageKey: string): string { return path.join(this.rootDirectory, storageKey); }
}
