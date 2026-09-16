export interface Dictionary {
  id: string;
  name: string;
  entryCount: number | null;
  mdxFormatVersion: string | null;
  sourceEncoding: string | null;
  importedAt: string | null;
  stylesheetUrl: string | null;
  stylesheetCompatibilityProfile: string | null;
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

export interface VocabularyItem {
  id: string;
  entryId: string;
  createdAt: string;
  entry: SearchEntry;
}

export interface AIModel {
  id: string;
  displayName: string;
}

export interface AIProviderModels {
  id: string;
  displayName: string;
  models: AIModel[];
}

export interface GeneratedVocabularyParagraph {
  paragraph: string;
  translation: string;
  usedWords: string[];
}

export type VocabularyGenerationStage = 'first' | 'retry';

export type VocabularyGenerationStreamEvent =
  | { type: 'attempt'; stage: VocabularyGenerationStage }
  | { type: 'paragraph_delta'; stage: VocabularyGenerationStage; text: string }
  | { type: 'result'; result: GeneratedVocabularyParagraph }
  | { type: 'error'; error: { code: string; message: string } };

export interface DictionaryPackageImport {
  dictionaryId: string;
  jobId: string;
  name: string;
  status: 'queued';
  stylesheetUrl: string | null;
  stylesheetCompatibilityProfile: string | null;
  fileCount: number;
  resourceCount: number;
}

export interface DictionaryImportStatus {
  dictionaryId: string;
  status: 'queued' | 'importing' | 'ready' | 'failed';
  progress: { current: number; total: number | null };
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

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try { body = await response.json() as ApiErrorBody; } catch { /* Use status fallback. */ }
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

export async function listVocabulary(): Promise<VocabularyItem[]> {
  return (await getJson<{ items: VocabularyItem[] }>('/api/vocabulary')).items;
}

export async function listAIModels(): Promise<AIProviderModels[]> {
  return (await getJson<{ providers: AIProviderModels[] }>('/api/ai/models')).providers;
}

export function generateVocabularyParagraph(
  provider: string,
  model: string,
  words: string[],
): Promise<GeneratedVocabularyParagraph> {
  return requestJson<GeneratedVocabularyParagraph>('/api/ai/generate-paragraph', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, model, words }),
  });
}

export async function streamVocabularyParagraph(
  provider: string,
  model: string,
  words: string[],
  handlers: {
    onAttempt?: (stage: VocabularyGenerationStage) => void;
    onParagraphDelta?: (text: string, stage: VocabularyGenerationStage) => void;
  } = {},
  signal?: AbortSignal,
): Promise<GeneratedVocabularyParagraph> {
  const response = await fetch('/api/ai/generate-paragraph/stream', {
    method: 'POST',
    headers: { accept: 'application/x-ndjson', 'content-type': 'application/json' },
    body: JSON.stringify({ provider, model, words }),
    signal,
  });
  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try { body = await response.json() as ApiErrorBody; } catch { /* Use status fallback. */ }
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (!response.body) throw new Error('Streaming response is unavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let result: GeneratedVocabularyParagraph | null = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as VocabularyGenerationStreamEvent;
    if (event.type === 'attempt') handlers.onAttempt?.(event.stage);
    else if (event.type === 'paragraph_delta') handlers.onParagraphDelta?.(event.text, event.stage);
    else if (event.type === 'result') result = event.result;
    else if (event.type === 'error') throw new Error(event.error.message);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
    }
    buffered += decoder.decode();
    consumeLine(buffered);
  } finally {
    reader.releaseLock();
  }
  if (!result) throw new Error('Generation stream ended without a validated result');
  return result;
}

export function addVocabulary(entryId: string): Promise<VocabularyItem> {
  return requestJson<VocabularyItem>('/api/vocabulary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entryId }),
  });
}

export async function removeVocabulary(id: string): Promise<void> {
  const response = await fetch(`/api/vocabulary/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try { body = await response.json() as ApiErrorBody; } catch { /* Use status fallback. */ }
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
}

export function importDictionaryPackage(files: readonly File[]): Promise<DictionaryPackageImport> {
  const body = new FormData();
  for (const file of files) body.append('files', file, file.webkitRelativePath || file.name);
  return requestJson<DictionaryPackageImport>('/api/dictionaries/import', { method: 'POST', body });
}

export function getDictionaryImportStatus(dictionaryId: string): Promise<DictionaryImportStatus> {
  return getJson<DictionaryImportStatus>(`/api/dictionaries/${encodeURIComponent(dictionaryId)}/import-status`);
}
