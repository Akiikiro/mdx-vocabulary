import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface StarDictMetadata {
  version: string;
  bookname: string;
  wordcount: number;
  idxfilesize: number;
  sametypesequence: string;
  idxoffsetbits: 32 | 64;
  fields: Readonly<Record<string, string>>;
}

export interface StarDictRecord {
  ordinal: number;
  headword: string;
  offset: bigint;
  size: number;
  text: string;
}

interface IndexRecord {
  headword: string;
  offset: bigint;
  size: number;
}

export class InvalidStarDictError extends Error {}

/** Read-only StarDict container reader. It deliberately knows nothing about Meikyo grammar. */
export class StarDictReader {
  readonly metadata: StarDictMetadata;
  readonly basePath: string;
  private readonly index: readonly IndexRecord[];
  private readonly payload: Buffer;

  private constructor(basePath: string, metadata: StarDictMetadata, index: IndexRecord[], payload: Buffer) {
    this.basePath = basePath;
    this.metadata = metadata;
    this.index = index;
    this.payload = payload;
  }

  static async open(sourcePath: string): Promise<StarDictReader> {
    const basePath = await resolveBasePath(sourcePath);
    const ifoPath = `${basePath}.ifo`;
    const fields = parseIfo(await fs.promises.readFile(ifoPath, 'utf8'));
    const offsetBits = fields.idxoffsetbits === undefined ? 32 : Number(fields.idxoffsetbits);
    if (offsetBits !== 32 && offsetBits !== 64) throw new InvalidStarDictError(`Unsupported idxoffsetbits: ${fields.idxoffsetbits}`);
    if (fields.sametypesequence !== 'm') {
      throw new InvalidStarDictError(`Expected sametypesequence=m, found ${fields.sametypesequence ?? 'missing'}`);
    }
    const wordcount = requiredInteger(fields, 'wordcount');
    const idxfilesize = requiredInteger(fields, 'idxfilesize');
    const idx = await fs.promises.readFile(`${basePath}.idx`);
    if (idx.length !== idxfilesize) throw new InvalidStarDictError(`idxfilesize declares ${idxfilesize}, read ${idx.length}`);
    const index = parseIndex(idx, offsetBits);
    if (index.length !== wordcount) throw new InvalidStarDictError(`wordcount declares ${wordcount}, parsed ${index.length}`);
    const payload = await readPayload(basePath);
    validateExtents(index, payload.length);
    return new StarDictReader(basePath, {
      version: fields.version ?? '', bookname: fields.bookname ?? '', wordcount, idxfilesize,
      sametypesequence: fields.sametypesequence, idxoffsetbits: offsetBits, fields,
    }, index, payload);
  }

  get recordCount(): number { return this.index.length; }

  *records(): Generator<StarDictRecord> {
    for (let ordinal = 0; ordinal < this.index.length; ordinal += 1) {
      const record = this.index[ordinal];
      const start = Number(record.offset);
      const bytes = this.payload.subarray(start, start + record.size);
      yield { ordinal, ...record, text: decodeUtf8(bytes, `payload record ${ordinal} (${record.headword})`) };
    }
  }
}

async function resolveBasePath(sourcePath: string): Promise<string> {
  const stat = await fs.promises.stat(sourcePath).catch(() => null);
  if (stat?.isDirectory()) {
    const names = (await fs.promises.readdir(sourcePath)).filter((name) => name.endsWith('.ifo'));
    if (names.length !== 1) throw new InvalidStarDictError(`Expected exactly one .ifo file in ${sourcePath}, found ${names.length}`);
    return path.join(sourcePath, names[0].slice(0, -4));
  }
  return sourcePath.endsWith('.ifo') ? sourcePath.slice(0, -4) : sourcePath;
}

function parseIfo(raw: string): Record<string, string> {
  const lines = raw.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  if (lines.shift() !== "StarDict's dict ifo file") throw new InvalidStarDictError('Invalid StarDict .ifo header');
  const fields: Record<string, string> = {};
  for (const line of lines) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new InvalidStarDictError(`Malformed .ifo line: ${line}`);
    fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return fields;
}

function requiredInteger(fields: Record<string, string>, name: string): number {
  const value = Number(fields[name]);
  if (!Number.isSafeInteger(value) || value < 0) throw new InvalidStarDictError(`Invalid or missing ${name}`);
  return value;
}

function parseIndex(bytes: Buffer, offsetBits: 32 | 64): IndexRecord[] {
  const records: IndexRecord[] = [];
  const width = offsetBits / 8;
  let cursor = 0;
  while (cursor < bytes.length) {
    const terminator = bytes.indexOf(0, cursor);
    if (terminator < 0 || terminator + 1 + width + 4 > bytes.length) throw new InvalidStarDictError(`Truncated .idx record at byte ${cursor}`);
    const headword = decodeUtf8(bytes.subarray(cursor, terminator), `.idx headword at byte ${cursor}`);
    cursor = terminator + 1;
    const offset = offsetBits === 64 ? bytes.readBigUInt64BE(cursor) : BigInt(bytes.readUInt32BE(cursor));
    cursor += width;
    const size = bytes.readUInt32BE(cursor);
    cursor += 4;
    records.push({ headword, offset, size });
  }
  return records;
}

function validateExtents(index: readonly IndexRecord[], payloadSize: number): void {
  for (let ordinal = 0; ordinal < index.length; ordinal += 1) {
    const { offset, size } = index[ordinal];
    if (offset > BigInt(Number.MAX_SAFE_INTEGER)) throw new InvalidStarDictError(`Record ${ordinal} offset exceeds JavaScript's safe range`);
    if (offset < 0n || offset + BigInt(size) > BigInt(payloadSize)) throw new InvalidStarDictError(`Record ${ordinal} exceeds dictionary payload`);
  }
}

async function readPayload(basePath: string): Promise<Buffer> {
  const plainPath = `${basePath}.dict`;
  const compressedPath = `${basePath}.dict.dz`;
  const plain = await fs.promises.readFile(plainPath).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (plain) return plain;
  const compressed = await fs.promises.readFile(compressedPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new InvalidStarDictError('Missing .dict or .dict.dz payload');
    throw error;
  });
  try { return zlib.gunzipSync(compressed); }
  catch (error) { throw new InvalidStarDictError(`Could not decompress .dict.dz: ${error instanceof Error ? error.message : String(error)}`); }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) { throw new InvalidStarDictError(`Invalid UTF-8 in ${label}: ${error instanceof Error ? error.message : String(error)}`); }
}
