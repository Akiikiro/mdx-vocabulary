export interface DictionaryMetadata {
  header: Record<string, unknown>;
  mdxVersion: string;
  encoding: string;
  entryCount: number;
}
export interface RawMdxEntry { headword: string; rawEntry: string; redirectTarget: string | null; }
export interface MdxParserAdapter {
  inspect(filePath: string): Promise<DictionaryMetadata>;
  iterateEntries(filePath: string): AsyncIterable<RawMdxEntry>;
}
