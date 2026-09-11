import {
  LLMProviderError,
  type LLMModel,
  type LLMProvider,
  type LLMTextGenerationRequest,
  type LLMTextGenerationResult,
} from './llm-provider.js';

const REQUEST_TIMEOUT_MS = 15_000;

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown }>;
}

interface OllamaGenerateResponse {
  model?: unknown;
  response?: unknown;
}

export class OllamaLLMProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama';
  private readonly baseUrl: URL;

  constructor(baseUrl: string, private readonly fetchImplementation: typeof fetch = fetch) {
    this.baseUrl = parseBaseUrl(baseUrl);
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
    const body = await this.requestJson<OllamaGenerateResponse>('api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        stream: false,
        ...(request.responseFormat === 'json' ? { format: 'json' } : {}),
        options: {
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined ? {} : { num_predict: request.maxOutputTokens }),
        },
      }),
    });
    if (typeof body.response !== 'string') {
      throw new LLMProviderError('LLM_PROVIDER_INVALID_RESPONSE', 'Ollama returned an invalid generation response');
    }
    return { model: typeof body.model === 'string' ? body.model : request.model, text: body.response };
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(new URL(path, this.baseUrl), {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
