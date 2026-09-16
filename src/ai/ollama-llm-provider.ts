import {
  LLMProviderError,
  type LLMModel,
  type LLMProvider,
  type LLMTextGenerationChunk,
  type LLMTextGenerationRequest,
  type LLMTextGenerationResult,
} from './llm-provider.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_COLD_START_TIMEOUT_MS = 180_000;
const DEFAULT_GENERATION_TIMEOUT_MS = 60_000;

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown }>;
}

interface OllamaGenerateResponse {
  model?: unknown;
  response?: unknown;
}

interface OllamaProcessResponse {
  models?: Array<{ name?: unknown }>;
}

export interface OllamaLLMProviderOptions {
  requestTimeoutMs?: number;
  coldStartTimeoutMs?: number;
  generationTimeoutMs?: number;
}

export class OllamaLLMProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama';
  private readonly baseUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly coldStartTimeoutMs: number;
  private readonly generationTimeoutMs: number;
  private readonly preloadByModel = new Map<string, Promise<void>>();
  private preloadQueue: Promise<void> = Promise.resolve();

  constructor(
    baseUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    options: OllamaLLMProviderOptions = {},
  ) {
    this.baseUrl = parseBaseUrl(baseUrl);
    this.requestTimeoutMs = positiveTimeout(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs');
    this.coldStartTimeoutMs = positiveTimeout(options.coldStartTimeoutMs, DEFAULT_COLD_START_TIMEOUT_MS, 'coldStartTimeoutMs');
    this.generationTimeoutMs = positiveTimeout(options.generationTimeoutMs, DEFAULT_GENERATION_TIMEOUT_MS, 'generationTimeoutMs');
  }

  async listModels(): Promise<LLMModel[]> {
    const body = await this.requestJson<OllamaTagsResponse>('api/tags', { method: 'GET' });
    if (!Array.isArray(body.models)) {
      throw new LLMProviderError('LLM_PROVIDER_INVALID_RESPONSE', 'Ollama returned an invalid model list');
    }
    return [...new Set(body.models
      .map((model) => model.name)
      .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
      .map((name) => name.trim()))]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => ({ id, displayName: id }));
  }

  async generateText(request: LLMTextGenerationRequest): Promise<LLMTextGenerationResult> {
    await this.ensureModelLoaded(request.model);
    const body = await this.requestJson<OllamaGenerateResponse>('api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        stream: false,
        ...(request.responseFormat === 'json'
          ? { format: 'json' }
          : request.responseFormat?.type === 'json_schema'
            ? { format: request.responseFormat.schema }
            : {}),
        options: {
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined ? {} : { num_predict: request.maxOutputTokens }),
        },
      }),
    }, this.generationTimeoutMs);
    if (typeof body.response !== 'string') {
      throw new LLMProviderError('LLM_PROVIDER_INVALID_RESPONSE', 'Ollama returned an invalid generation response');
    }
    return { model: typeof body.model === 'string' ? body.model : request.model, text: body.response };
  }

  async *generateTextStream(
    request: LLMTextGenerationRequest,
    signal?: AbortSignal,
  ): AsyncIterable<LLMTextGenerationChunk> {
    await this.ensureModelLoaded(request.model);
    if (signal?.aborted) throw signal.reason;

    let response: Response;
    try {
      response = await this.fetchImplementation(new URL('api/generate', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          stream: true,
          ...(request.responseFormat === 'json'
            ? { format: 'json' }
            : request.responseFormat?.type === 'json_schema'
              ? { format: request.responseFormat.schema }
              : {}),
          options: {
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            ...(request.maxOutputTokens === undefined ? {} : { num_predict: request.maxOutputTokens }),
          },
        }),
        signal: combineSignals(AbortSignal.timeout(this.generationTimeoutMs), signal),
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new LLMProviderError('LLM_PROVIDER_UNAVAILABLE', 'Ollama is unavailable');
    }
    if (!response.ok || !response.body) {
      throw new LLMProviderError('LLM_PROVIDER_UNAVAILABLE', 'Ollama is unavailable');
    }

    let completed = false;
    try {
      for await (const line of ndjsonLines(response.body)) {
        let chunk: OllamaGenerateResponse & { done?: unknown };
        try {
          chunk = JSON.parse(line) as OllamaGenerateResponse & { done?: unknown };
        } catch {
          throw new LLMProviderError('LLM_PROVIDER_INVALID_RESPONSE', 'Ollama returned invalid streaming JSON');
        }
        if (typeof chunk.response !== 'string' || typeof chunk.done !== 'boolean') {
          throw new LLMProviderError('LLM_PROVIDER_INVALID_RESPONSE', 'Ollama returned an invalid streaming response');
        }
        if (chunk.response) yield { textDelta: chunk.response };
        if (chunk.done) completed = true;
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof LLMProviderError) throw error;
      throw new LLMProviderError('LLM_PROVIDER_UNAVAILABLE', 'Ollama is unavailable');
    }
    if (!completed) {
      throw new LLMProviderError('LLM_PROVIDER_INVALID_RESPONSE', 'Ollama ended an incomplete streaming response');
    }
  }

  private async ensureModelLoaded(model: string): Promise<void> {
    const normalizedModel = normalizeModelTag(model);
    if (await this.isModelLoaded(normalizedModel)) return;

    const existing = this.preloadByModel.get(normalizedModel);
    if (existing) return existing;

    const preload = this.preloadQueue.catch(() => undefined).then(async () => {
      if (await this.isModelLoaded(normalizedModel)) return;
      await this.requestJson<unknown>('api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: '', stream: false }),
      }, this.coldStartTimeoutMs);
      if (!await this.isModelLoaded(normalizedModel)) {
        throw new LLMProviderError('LLM_PROVIDER_UNAVAILABLE', 'Ollama did not load the requested model');
      }
    });
    this.preloadByModel.set(normalizedModel, preload);
    this.preloadQueue = preload.catch(() => undefined);
    try {
      await preload;
    } finally {
      if (this.preloadByModel.get(normalizedModel) === preload) this.preloadByModel.delete(normalizedModel);
    }
  }

  private async isModelLoaded(normalizedModel: string): Promise<boolean> {
    const body = await this.requestJson<OllamaProcessResponse>('api/ps', { method: 'GET' }, this.requestTimeoutMs);
    if (!Array.isArray(body.models)) {
      throw new LLMProviderError('LLM_PROVIDER_INVALID_RESPONSE', 'Ollama returned an invalid process list');
    }
    return body.models.some((model) => typeof model.name === 'string'
      && normalizeModelTag(model.name) === normalizedModel);
  }

  private async requestJson<T>(path: string, init: RequestInit, timeoutMs = this.requestTimeoutMs): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(new URL(path, this.baseUrl), {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new LLMProviderError('LLM_PROVIDER_UNAVAILABLE', 'Ollama is unavailable');
    }
    if (!response.ok) {
      throw new LLMProviderError('LLM_PROVIDER_UNAVAILABLE', 'Ollama is unavailable');
    }
    try {
      return await response.json() as T;
    } catch {
      throw new LLMProviderError('LLM_PROVIDER_INVALID_RESPONSE', 'Ollama returned invalid JSON');
    }
  }
}

async function* ndjsonLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) yield line;
    }
    buffered += decoder.decode();
    if (buffered.trim()) yield buffered;
  } finally {
    reader.releaseLock();
  }
}

function combineSignals(timeout: AbortSignal, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

function normalizeModelTag(value: string): string {
  const trimmed = value.trim();
  const finalSegment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return finalSegment.includes(':') ? trimmed : `${trimmed}:latest`;
}

function positiveTimeout(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) throw new Error(`${name} must be a positive integer`);
  return resolved;
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.endsWith('/') ? value : `${value}/`);
  } catch {
    throw new Error('OLLAMA_BASE_URL must be a valid HTTP(S) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OLLAMA_BASE_URL must be a valid HTTP(S) URL');
  }
  return url;
}
