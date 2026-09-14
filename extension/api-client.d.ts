export const DEFAULT_BACKEND_URL: string;

export interface DictionaryEntry {
  id: string;
  dictionaryId: string;
  headword: string;
  kind: 'definition' | 'redirect' | 'unknown';
  plainText: string;
  redirectTarget: string | null;
  sourceOrdinal: number;
  sanitizedHtml: string;
}

export interface LookupResult {
  dictionary: { id: string; name: string };
  entry: DictionaryEntry;
}

export function normalizeBackendUrl(value: unknown): string;
export function backendPermissionOrigin(backendUrl: string): string;
export function createDictionaryApi(backendUrl: string, fetchImplementation?: typeof fetch): {
  lookup(word: string): Promise<LookupResult | null>;
  addVocabulary(entryId: string): Promise<unknown>;
};
