import { describe, expect, it, vi } from 'vitest';
import { LLMProviderError } from '../src/ai/llm-provider.js';
import { OllamaLLMProvider } from '../src/ai/ollama-llm-provider.js';

describe('OllamaLLMProvider', () => {
  it('maps discovered Ollama models to provider-neutral models', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: 'qwen3:8b' }, { name: 'gemma3:4b' }, { name: '' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new OllamaLLMProvider('http://ollama.test:11434', fetchImplementation);

    await expect(provider.listModels()).resolves.toEqual([
      { id: 'gemma3:4b', displayName: 'gemma3:4b' },
      { id: 'qwen3:8b', displayName: 'qwen3:8b' },
    ]);
    expect(fetchImplementation).toHaveBeenCalledWith(new URL('http://ollama.test:11434/api/tags'), expect.objectContaining({ method: 'GET' }));
  });

  it('passes the runtime-selected model through the generic generation contract', async () => {
    const fetchImplementation = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      model: 'gemma3:4b', response: 'generated text',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new OllamaLLMProvider('http://ollama.test:11434/base/', fetchImplementation);

    await expect(provider.generateText({
      model: 'gemma3:4b', prompt: 'provider-neutral prompt', temperature: 0.2, maxOutputTokens: 50,
      responseFormat: 'json',
    })).resolves.toEqual({ model: 'gemma3:4b', text: 'generated text' });
    expect(fetchImplementation).toHaveBeenCalledWith(new URL('http://ollama.test:11434/base/api/generate'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        model: 'gemma3:4b', prompt: 'provider-neutral prompt', stream: false, format: 'json',
        options: { temperature: 0.2, num_predict: 50 },
      }),
    }));
  });

  it('returns controlled provider errors without leaking network details', async () => {
    const provider = new OllamaLLMProvider('http://ollama.test:11434', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED private-host');
    }));
    await expect(provider.listModels()).rejects.toEqual(expect.objectContaining<Partial<LLMProviderError>>({
      code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Ollama is unavailable',
    }));
  });

  it('validates the configured base URL', () => {
    expect(() => new OllamaLLMProvider('file:///tmp/ollama')).toThrow('OLLAMA_BASE_URL must be a valid HTTP(S) URL');
  });
});
