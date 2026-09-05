import { MDX } from 'js-mdict';
import type { DictionaryMetadata, MdxParserAdapter, RawMdxEntry } from './types.js';

export const JS_MDICT_VERSION = '6.0.6';
export class JsMdictAdapter implements MdxParserAdapter {
  async inspect(filePath: string): Promise<DictionaryMetadata> {
    const mdx = new MDX(filePath);
    try {
      return { header: mdx.header, mdxVersion: String(mdx.header.GeneratedByEngineVersion ?? mdx.meta.version), encoding: mdx.meta.encoding, entryCount: mdx.keywordList.length };
    } finally { mdx.close(); }
  }
  async *iterateEntries(filePath: string): AsyncIterable<RawMdxEntry> {
    const mdx = new MDX(filePath);
    try {
      for (const item of mdx.keywordList) {
        const found = mdx.fetch(item);
        const rawEntry = (found.definition ?? '').replaceAll('\0', ''); // PostgreSQL text cannot contain NUL.
        const redirect = /^@@@LINK=(.+)$/m.exec(rawEntry);
        yield { headword: found.keyText, rawEntry, redirectTarget: redirect?.[1]?.trim() ?? null };
      }
    } finally { mdx.close(); }
  }
}
