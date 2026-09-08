import crypto from 'node:crypto';
import fs from 'node:fs';
import { MDX } from 'js-mdict';
import { parseRedirect } from '../entries/normalize.js';

export interface MdxEntryLocator {
  version: 1;
  fileChecksum: string;
  keyText: string;
  keyBlockIndex: number;
  recordStartOffset: bigint;
  recordEndOffset: bigint;
}

export interface LazyMdxEntry {
  headword: string;
  rawEntry: string;
  redirectTarget: string | null;
}

export interface LazyMdxAdapter {
  listEntryLocators(mdxPath: string, expectedChecksum: string): Promise<MdxEntryLocator[]>;
  getEntryLocator(mdxPath: string, expectedChecksum: string, sourceOrdinal: number): Promise<MdxEntryLocator | null>;
  fetchByLocator(mdxPath: string, expectedChecksum: string, locator: MdxEntryLocator): Promise<LazyMdxEntry>;
  isInitialized?(mdxPath: string, expectedChecksum: string): boolean;
  close(): void;
}

interface KeywordItem {
  keyText: string;
  keyBlockIdx: number;
  recordStartOffset: number;
  recordEndOffset: number;
}

interface OpenMdx {
  keywordList: KeywordItem[];
  fetch(item: KeywordItem): { keyText: string; definition: string | null };
  close(): void;
}

interface CachedMdx {
  checksum: string;
  mdx: OpenMdx;
  itemsByLocator: Map<string, KeywordItem>;
}

export type OpenMdxFactory = (mdxPath: string) => OpenMdx;
export type FileChecksum = (mdxPath: string) => Promise<string>;

export class InvalidMdxLocatorError extends Error {}
export class MdxFileIdentityMismatchError extends Error {}
export class MdxEntryNotFoundByLocatorError extends Error {}

export function serializeMdxLocator(locator: MdxEntryLocator): string {
  validateLocator(locator);
  return JSON.stringify([
    locator.version, locator.fileChecksum, locator.keyText, locator.keyBlockIndex,
    locator.recordStartOffset.toString(), locator.recordEndOffset.toString(),
  ]);
}

export class JsMdictLazyAdapter implements LazyMdxAdapter {
  private readonly openFiles = new Map<string, CachedMdx>();
  private readonly openingFiles = new Map<string, Promise<CachedMdx>>();

  constructor(
    private readonly maxOpenFiles = 2,
    private readonly openMdx: OpenMdxFactory = (mdxPath) => new MDX(mdxPath),
    private readonly checksumFile: FileChecksum = sha256File,
  ) {
    if (!Number.isInteger(maxOpenFiles) || maxOpenFiles < 1) throw new RangeError('maxOpenFiles must be positive');
  }

  async listEntryLocators(mdxPath: string, expectedChecksum: string): Promise<MdxEntryLocator[]> {
    const cached = await this.getFile(mdxPath, expectedChecksum);
    return cached.mdx.keywordList.map((item) => locatorFor(expectedChecksum, item));
  }

  async getEntryLocator(mdxPath: string, expectedChecksum: string, sourceOrdinal: number): Promise<MdxEntryLocator | null> {
    if (!Number.isSafeInteger(sourceOrdinal) || sourceOrdinal < 0) throw new InvalidMdxLocatorError('Invalid MDX source ordinal');
    const cached = await this.getFile(mdxPath, expectedChecksum);
    const item = cached.mdx.keywordList[sourceOrdinal];
    return item ? locatorFor(expectedChecksum, item) : null;
  }

  async fetchByLocator(mdxPath: string, expectedChecksum: string, locator: MdxEntryLocator): Promise<LazyMdxEntry> {
    validateLocator(locator);
    if (locator.fileChecksum !== expectedChecksum) {
      throw new MdxFileIdentityMismatchError('MDX locator does not belong to the expected dictionary file');
    }
    const cached = await this.getFile(mdxPath, expectedChecksum);
    const item = cached.itemsByLocator.get(serializeMdxLocator(locator));
    if (!item) throw new MdxEntryNotFoundByLocatorError('MDX entry locator was not found in the dictionary file');
    const found = cached.mdx.fetch(item);
    if (found.definition === null) throw new MdxEntryNotFoundByLocatorError('MDX record has no definition');
    const rawEntry = found.definition.replaceAll('\0', '');
    return { headword: found.keyText, rawEntry, redirectTarget: parseRedirect(rawEntry) };
  }

  isInitialized(mdxPath: string, expectedChecksum: string): boolean {
    return this.openFiles.get(mdxPath)?.checksum === expectedChecksum;
  }

  close(): void {
    for (const cached of this.openFiles.values()) cached.mdx.close();
    this.openFiles.clear();
    this.openingFiles.clear();
  }

  private async getFile(mdxPath: string, expectedChecksum: string): Promise<CachedMdx> {
    if (!/^[0-9a-f]{64}$/u.test(expectedChecksum)) throw new MdxFileIdentityMismatchError('Invalid expected MDX checksum');
    const existing = this.openFiles.get(mdxPath);
    if (existing) {
      if (existing.checksum !== expectedChecksum) throw new MdxFileIdentityMismatchError('Open MDX checksum does not match dictionary metadata');
      this.openFiles.delete(mdxPath);
      this.openFiles.set(mdxPath, existing);
      return existing;
    }

    const openingKey = `${mdxPath}\0${expectedChecksum}`;
    const pending = this.openingFiles.get(openingKey);
    if (pending) return pending;
    const opening = this.openAndCache(mdxPath, expectedChecksum);
    this.openingFiles.set(openingKey, opening);
    try { return await opening; }
    finally { if (this.openingFiles.get(openingKey) === opening) this.openingFiles.delete(openingKey); }
  }

  private async openAndCache(mdxPath: string, expectedChecksum: string): Promise<CachedMdx> {
    const actualChecksum = await this.checksumFile(mdxPath);
    if (actualChecksum !== expectedChecksum) throw new MdxFileIdentityMismatchError('Stored MDX file checksum does not match dictionary metadata');
    const mdx = this.openMdx(mdxPath);
    try {
      const itemsByLocator = new Map<string, KeywordItem>();
      for (const item of mdx.keywordList) {
        const serialized = serializeMdxLocator(locatorFor(expectedChecksum, item));
        if (itemsByLocator.has(serialized)) throw new InvalidMdxLocatorError('MDX contains structurally indistinguishable keyword locators');
        itemsByLocator.set(serialized, item);
      }
      const cached = { checksum: expectedChecksum, mdx, itemsByLocator };
      this.openFiles.set(mdxPath, cached);
      if (this.openFiles.size > this.maxOpenFiles) {
        const oldestPath = this.openFiles.keys().next().value as string;
        this.openFiles.get(oldestPath)?.mdx.close();
        this.openFiles.delete(oldestPath);
      }
      return cached;
    } catch (error) { mdx.close(); throw error; }
  }
}

function locatorFor(fileChecksum: string, item: KeywordItem): MdxEntryLocator {
  return {
    version: 1, fileChecksum, keyText: item.keyText, keyBlockIndex: item.keyBlockIdx,
    recordStartOffset: BigInt(item.recordStartOffset), recordEndOffset: BigInt(item.recordEndOffset),
  };
}

function validateLocator(locator: MdxEntryLocator): void {
  if (locator.version !== 1 || !/^[0-9a-f]{64}$/u.test(locator.fileChecksum) || !locator.keyText
    || !Number.isSafeInteger(locator.keyBlockIndex) || locator.keyBlockIndex < 0
    || typeof locator.recordStartOffset !== 'bigint' || locator.recordStartOffset < 0n
    || typeof locator.recordEndOffset !== 'bigint' || locator.recordEndOffset < locator.recordStartOffset) {
    throw new InvalidMdxLocatorError('Malformed MDX entry locator');
  }
}

async function sha256File(mdxPath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(mdxPath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
