import { describe, expect, it, vi } from 'vitest';
import {
  InvalidMdxLocatorError,
  JsMdictLazyAdapter,
  MdxEntryNotFoundByLocatorError,
  MdxFileIdentityMismatchError,
  serializeMdxLocator,
} from '../src/mdx/lazy-mdx-adapter.js';

const checksum = 'a'.repeat(64);
const items = [
  { keyText: 'same', keyBlockIdx: 3, recordStartOffset: 100, recordEndOffset: 120 },
  { keyText: 'same', keyBlockIdx: 3, recordStartOffset: 120, recordEndOffset: 145 },
  { keyText: '東京', keyBlockIdx: 7, recordStartOffset: 900, recordEndOffset: 940 },
  { keyText: 'Redirect', keyBlockIdx: 8, recordStartOffset: 940, recordEndOffset: 970 },
];

describe('JsMdictLazyAdapter', () => {
  it('creates stable application locators and fetches duplicate records distinctly and repeatedly', async () => {
    const close = vi.fn();
    const open = vi.fn(() => ({
      keywordList: items,
      fetch: (item: typeof items[number]) => ({
        keyText: item.keyText,
        definition: item.recordStartOffset === 100 ? '<b>first</b>' : item.recordStartOffset === 120 ? '<b>second</b>' : '<b>unicode</b>',
      }),
      close,
    }));
    const hash = vi.fn(async () => checksum);
    const adapter = new JsMdictLazyAdapter(2, open, hash);
    const locators = await adapter.listEntryLocators('/dict.mdx', checksum);
    expect(await adapter.getEntryLocator('/dict.mdx', checksum, 1)).toEqual(locators[1]);
    expect(await adapter.getEntryLocator('/dict.mdx', checksum, 99)).toBeNull();

    expect(locators[0]).toEqual({
      version: 1, fileChecksum: checksum, keyText: 'same', keyBlockIndex: 3,
      recordStartOffset: 100n, recordEndOffset: 120n,
    });
    expect(serializeMdxLocator(locators[0])).toBe(serializeMdxLocator({ ...locators[0] }));
    expect(await adapter.fetchByLocator('/dict.mdx', checksum, locators[0])).toEqual(expect.objectContaining({ headword: 'same', rawEntry: '<b>first</b>' }));
    expect(await adapter.fetchByLocator('/dict.mdx', checksum, locators[1])).toEqual(expect.objectContaining({ headword: 'same', rawEntry: '<b>second</b>' }));
    expect(await adapter.fetchByLocator('/dict.mdx', checksum, locators[0])).toEqual(expect.objectContaining({ rawEntry: '<b>first</b>' }));
    expect(await adapter.fetchByLocator('/dict.mdx', checksum, locators[2])).toEqual(expect.objectContaining({ headword: '東京' }));
    expect(open).toHaveBeenCalledOnce();
    expect(hash).toHaveBeenCalledOnce();
    adapter.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('retrieves redirects without exposing a js-mdict keyword object', async () => {
    const adapter = new JsMdictLazyAdapter(1, () => ({
      keywordList: items,
      fetch: (item) => ({ keyText: item.keyText, definition: '@@@LINK=Target\r\n\0' }),
      close: () => {},
    }), async () => checksum);
    const locator = (await adapter.listEntryLocators('/dict.mdx', checksum))[3];
    expect(await adapter.fetchByLocator('/dict.mdx', checksum, locator)).toEqual({
      headword: 'Redirect', rawEntry: '@@@LINK=Target\r\n', redirectTarget: 'Target',
    });
    adapter.close();
  });

  it('rejects malformed, fabricated, and wrong-file locators', async () => {
    const adapter = new JsMdictLazyAdapter(1, () => ({ keywordList: items, fetch: () => ({ keyText: '', definition: '' }), close: () => {} }), async () => checksum);
    const locator = (await adapter.listEntryLocators('/dict.mdx', checksum))[0];
    await expect(adapter.fetchByLocator('/dict.mdx', 'b'.repeat(64), locator)).rejects.toBeInstanceOf(MdxFileIdentityMismatchError);
    await expect(adapter.fetchByLocator('/dict.mdx', checksum, { ...locator, recordStartOffset: 101n })).rejects.toBeInstanceOf(MdxEntryNotFoundByLocatorError);
    expect(() => serializeMdxLocator({ ...locator, recordEndOffset: -1n })).toThrow(InvalidMdxLocatorError);
    adapter.close();
  });

  it('rejects an on-disk checksum mismatch before opening the parser', async () => {
    const open = vi.fn();
    const adapter = new JsMdictLazyAdapter(1, open, async () => 'b'.repeat(64));
    await expect(adapter.listEntryLocators('/dict.mdx', checksum)).rejects.toBeInstanceOf(MdxFileIdentityMismatchError);
    expect(open).not.toHaveBeenCalled();
  });

  it('deduplicates simultaneous first initialization for the same file and checksum', async () => {
    const open = vi.fn(() => ({ keywordList: items, fetch: () => ({ keyText: 'same', definition: 'value' }), close: () => {} }));
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const hash = vi.fn(async () => { await waiting; return checksum; });
    const adapter = new JsMdictLazyAdapter(2, open, hash);
    const calls = [adapter.listEntryLocators('/same.mdx', checksum), adapter.getEntryLocator('/same.mdx', checksum, 0)];
    release();
    await Promise.all(calls);
    expect(hash).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    adapter.close();
  });

  it('reopens an evicted file and retries after failed initialization', async () => {
    const opens: string[] = []; const closed: string[] = []; let failFirst = true;
    const adapter = new JsMdictLazyAdapter(1, (file) => { opens.push(file); return { keywordList: items, fetch: () => ({ keyText: 'same', definition: 'ok' }), close: () => closed.push(file) }; }, async (file) => { if (file === '/retry.mdx' && failFirst) { failFirst = false; throw new Error('temporary'); } return checksum; });
    await expect(adapter.listEntryLocators('/retry.mdx', checksum)).rejects.toThrow('temporary');
    await expect(adapter.listEntryLocators('/retry.mdx', checksum)).resolves.toHaveLength(items.length);
    await adapter.listEntryLocators('/other.mdx', checksum); expect(closed).toContain('/retry.mdx');
    await adapter.listEntryLocators('/retry.mdx', checksum); expect(opens.filter((x) => x === '/retry.mdx')).toHaveLength(2);
    adapter.close();
  });
});
