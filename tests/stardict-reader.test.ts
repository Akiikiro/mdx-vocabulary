import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { InvalidStarDictError, StarDictReader } from '../src/stardict/stardict-reader.js';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true }))));

describe('StarDictReader', () => {
  it.each(['plain', 'compressed'] as const)('reads and validates a %s UTF-8 StarDict payload', async (mode) => {
    const directory = await fixture([{ headword: '一生懸命', text: '【副】\n◯懸命に。/拼命地。' }, { headword: '食べる', text: '【他下一】\n①食べる。/吃。' }], mode);
    const reader = await StarDictReader.open(directory);
    expect(reader.metadata).toMatchObject({ wordcount: 2, sametypesequence: 'm', idxoffsetbits: 32 });
    expect(Array.from(reader.records())).toEqual([
      expect.objectContaining({ ordinal: 0, headword: '一生懸命', offset: 0n, text: '【副】\n◯懸命に。/拼命地。' }),
      expect.objectContaining({ ordinal: 1, headword: '食べる', text: '【他下一】\n①食べる。/吃。' }),
    ]);
  });

  it('rejects inconsistent metadata and invalid extents', async () => {
    const directory = await fixture([{ headword: 'x', text: 'value' }], 'plain');
    const ifo = path.join(directory, 'fixture.ifo');
    await fs.promises.writeFile(ifo, (await fs.promises.readFile(ifo, 'utf8')).replace('wordcount=1', 'wordcount=2'));
    await expect(StarDictReader.open(directory)).rejects.toBeInstanceOf(InvalidStarDictError);
  });
});

async function fixture(entries: Array<{ headword: string; text: string }>, mode: 'plain' | 'compressed'): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'meikyo-stardict-'));
  temporaryDirectories.push(directory);
  const payloadParts = entries.map((entry) => Buffer.from(entry.text));
  const indexParts: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const header = Buffer.from(`${entries[index].headword}\0`);
    const numbers = Buffer.alloc(8);
    numbers.writeUInt32BE(offset, 0); numbers.writeUInt32BE(payloadParts[index].length, 4);
    indexParts.push(header, numbers); offset += payloadParts[index].length;
  }
  const index = Buffer.concat(indexParts);
  await fs.promises.writeFile(path.join(directory, 'fixture.ifo'), `StarDict's dict ifo file\nversion=3.0.0\nbookname=fixture\nwordcount=${entries.length}\nidxfilesize=${index.length}\nsametypesequence=m\n`);
  await fs.promises.writeFile(path.join(directory, 'fixture.idx'), index);
  const payload = Buffer.concat(payloadParts);
  await fs.promises.writeFile(path.join(directory, mode === 'plain' ? 'fixture.dict' : 'fixture.dict.dz'), mode === 'plain' ? payload : zlib.gzipSync(payload));
  return directory;
}
