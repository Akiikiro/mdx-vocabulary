export interface Dictionary {
  id: string;
  name: string;
  entryCount: number | null;
  mdxFormatVersion: string | null;
  sourceEncoding: string | null;
  importedAt: string | null;
}

export interface SearchEntry {
  id: string;
  dictionaryId: string;
  headword: string;
  kind: 'definition' | 'redirect' | 'unknown';
  plainText: string;
  redirectTarget: string | null;
  sourceOrdinal: number;
}

export interface EntryDetail extends SearchEntry {
  sanitizedHtml: string;
}

interface ApiErrorBody { error?: { message?: string } }

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = await response.json() as ApiErrorBody;
    } catch {
      // Fall through to the status-based message.
    }
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function listDictionaries(): Promise<Dictionary[]> {
  return (await getJson<{ items: Dictionary[] }>('/api/dictionaries')).items;
}

export async function searchEntries(
  dictionaryId: string,
  query: string,
  mode: 'exact' | 'prefix',
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<SearchEntry[]> {
  const parameters = new URLSearchParams({
    q: query,
    mode,
    limit: String(options.limit ?? 20),
    offset: String(options.offset ?? 0),
  });
  const response = await getJson<{ items: SearchEntry[] }>(
    `/api/dictionaries/${encodeURIComponent(dictionaryId)}/search?${parameters}`,
    options.signal,
  );
  return response.items;
}

export function getEntry(entryId: string, signal?: AbortSignal): Promise<EntryDetail> {
  return getJson<EntryDetail>(`/api/entries/${encodeURIComponent(entryId)}`, signal);
}
