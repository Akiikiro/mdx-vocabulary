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
    const fetchImplementation = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(input.toString());
      return url.pathname.endsWith('/api/ps')
        ? jsonResponse({ models: [{ name: 'gemma3:4b' }] })
        : jsonResponse({ model: 'gemma3:4b', response: 'generated text' });
    });
    const provider = new OllamaLLMProvider('http://ollama.test:11434/base/', fetchImplementation);

    await expect(provider.generateText({
      model: 'gemma3:4b', prompt: 'provider-neutral prompt', temperature: 0.2, maxOutputTokens: 50,
      responseFormat: 'json',
    })).resolves.toEqual({ model: 'gemma3:4b', text: 'generated text' });
    expect(fetchImplementation).toHaveBeenNthCalledWith(1, new URL('http://ollama.test:11434/base/api/ps'), expect.objectContaining({ method: 'GET' }));
    expect(fetchImplementation).toHaveBeenNthCalledWith(2, new URL('http://ollama.test:11434/base/api/generate'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        model: 'gemma3:4b', prompt: 'provider-neutral prompt', stream: false, format: 'json',
        options: { temperature: 0.2, num_predict: 50 },
      }),
    }));
  });

  it('maps a provider-neutral JSON schema response format to Ollama format', async () => {
    const schema = {
      type: 'object',
      properties: { paragraph: { type: 'string' } },
      required: ['paragraph'],
      additionalProperties: false,
    };
    const fetchImplementation = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(input.toString());
      return url.pathname.endsWith('/api/ps')
        ? jsonResponse({ models: [{ name: 'gemma3:4b' }] })
        : jsonResponse({ model: 'gemma3:4b', response: '{"paragraph":"text"}' });
    });
    const provider = new OllamaLLMProvider('http://ollama.test:11434', fetchImplementation);

    await provider.generateText({
      model: 'gemma3:4b',
      prompt: 'structured prompt',
      responseFormat: { type: 'json_schema', schema },
    });

    const generationBody = JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body));
    expect(generationBody.format).toEqual(schema);
  });

  it('streams Ollama NDJSON chunks with the JSON schema and stream enabled', async () => {
    const schema = { type: 'object', properties: { paragraph: { type: 'string' } } };
    const bodies: unknown[] = [];
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith('/api/ps')) return jsonResponse({ models: [{ name: 'gemma3:4b' }] });
      bodies.push(JSON.parse(String(init?.body)));
      return chunkedResponse([
        '{"response":"{\\"paragraph\\":\\"你","done":false}\n{"res',
        'ponse":"好\\"}","done":false}\n',
        '{"response":"","done":true}\n',
      ]);
    });
    const provider = new OllamaLLMProvider('http://ollama.test:11434', fetchImplementation);

    const chunks: string[] = [];
    for await (const chunk of provider.generateTextStream({
      model: 'gemma3:4b', prompt: 'prompt', temperature: 0.7,
      responseFormat: { type: 'json_schema', schema },
    })) chunks.push(chunk.textDelta);

    expect(chunks.join('')).toBe('{"paragraph":"你好"}');
    expect(bodies).toEqual([expect.objectContaining({ stream: true, format: schema, options: { temperature: 0.7 } })]);
  });

  it('forwards cancellation to an active Ollama streaming request', async () => {
    const requestStarted = deferred<AbortSignal>();
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith('/api/ps')) return jsonResponse({ models: [{ name: 'gemma3:4b' }] });
      requestStarted.resolve(init?.signal as AbortSignal);
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    });
    const provider = new OllamaLLMProvider('http://ollama.test:11434', fetchImplementation);
    const controller = new AbortController();
    const iterator = provider.generateTextStream({ model: 'gemma3:4b', prompt: 'prompt' }, controller.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    const forwardedSignal = await requestStarted.promise;

    controller.abort();

    expect(forwardedSignal.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('treats an omitted latest tag as exactly equivalent when checking loaded models', async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(input.toString());
      return url.pathname === '/api/ps'
        ? jsonResponse({ models: [{ name: 'qwen3:8b' }, { name: 'fixture:latest' }] })
        : jsonResponse({ model: 'fixture:latest', response: 'generated' });
    });
    const provider = new OllamaLLMProvider('http://ollama.test:11434', fetchImplementation);

    await provider.generateText({ model: 'fixture', prompt: 'prompt' });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const generationBody = JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body));
    expect(generationBody).toMatchObject({ model: 'fixture', prompt: 'prompt' });
  });

  it('does not use prefix or family matching and preloads before generation', async () => {
    let loaded = false;
    const requestBodies: unknown[] = [];
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.pathname === '/api/ps') {
        return jsonResponse({ models: [{ name: loaded ? 'qwen:96k' : 'qwen:128k' }] });
      }
      const body = JSON.parse(String(init?.body));
      requestBodies.push(body);
      if (body.prompt === '') loaded = true;
      return jsonResponse(body.prompt === '' ? {} : { model: body.model, response: 'generated' });
    });
    const provider = new OllamaLLMProvider('http://ollama.test:11434', fetchImplementation);

    await provider.generateText({ model: 'qwen:96k', prompt: 'real prompt' });

    expect(requestBodies).toEqual([
      { model: 'qwen:96k', prompt: '', stream: false },
      { model: 'qwen:96k', prompt: 'real prompt', stream: false, options: {} },
    ]);
  });

  it('shares one preload task across concurrent requests for the same model', async () => {
    const gate = deferred<void>();
    let loaded = false;
    let preloadCount = 0;
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.pathname === '/api/ps') return jsonResponse({ models: loaded ? [{ name: 'fixture:latest' }] : [] });
      const body = JSON.parse(String(init?.body));
      if (body.prompt === '') {
        preloadCount += 1;
        await gate.promise;
        loaded = true;
        return jsonResponse({});
      }
      return jsonResponse({ model: body.model, response: body.prompt });
    });
    const provider = new OllamaLLMProvider('http://ollama.test:11434', fetchImplementation);

    const first = provider.generateText({ model: 'fixture', prompt: 'first' });
    const second = provider.generateText({ model: 'fixture:latest', prompt: 'second' });
    await vi.waitFor(() => expect(preloadCount).toBe(1));
    gate.resolve(undefined);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { model: 'fixture', text: 'first' },
      { model: 'fixture:latest', text: 'second' },
    ]);
    expect(preloadCount).toBe(1);
  });

  it('serializes preload tasks for different models', async () => {
    const firstGate = deferred<void>();
    const preloadOrder: string[] = [];
    const loaded = new Set<string>();
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.pathname === '/api/ps') return jsonResponse({ models: [...loaded].map((name) => ({ name })) });
      const body = JSON.parse(String(init?.body));
      if (body.prompt === '') {
        preloadOrder.push(body.model);
        if (body.model === 'model-a') await firstGate.promise;
        loaded.add(normalizedTestTag(body.model));
        return jsonResponse({});
      }
      return jsonResponse({ model: body.model, response: 'generated' });
    });
    const provider = new OllamaLLMProvider('http://ollama.test:11434', fetchImplementation);

    const first = provider.generateText({ model: 'model-a', prompt: 'first' });
    const second = provider.generateText({ model: 'model-b', prompt: 'second' });
    await vi.waitFor(() => expect(preloadOrder).toEqual(['model-a']));
    firstGate.resolve(undefined);
    await Promise.all([first, second]);

    expect(preloadOrder).toEqual(['model-a', 'model-b']);
  });

  it('uses separate request, cold-start, and generation timeouts', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    let loaded = false;
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.pathname === '/api/ps') return jsonResponse({ models: loaded ? [{ name: 'fixture:latest' }] : [] });
      const body = JSON.parse(String(init?.body));
      if (body.prompt === '') {
        loaded = true;
        return jsonResponse({});
      }
      return jsonResponse({ model: body.model, response: 'generated' });
    });
    const provider = new OllamaLLMProvider('http://ollama.test:11434', fetchImplementation, {
      requestTimeoutMs: 101,
      coldStartTimeoutMs: 202,
      generationTimeoutMs: 303,
    });

    await provider.generateText({ model: 'fixture', prompt: 'prompt' });

    expect(timeoutSpy.mock.calls.map(([timeout]) => timeout)).toEqual([101, 101, 202, 101, 303]);
    timeoutSpy.mockRestore();
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function chunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200 });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function normalizedTestTag(model: string): string {
  return model.includes(':') ? model : `${model}:latest`;
}
