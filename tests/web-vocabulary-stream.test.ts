import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTtsAudio, streamVocabularyParagraph } from '../web/src/api.js';

describe('streamVocabularyParagraph', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('consumes chunked NDJSON, resets attempts, and returns only the validated result', async () => {
    const attempts: string[] = [];
    const deltas: string[] = [];
    const result = { paragraph: 'Final paragraph.', translation: '最终翻译。', usedWords: ['final'] };
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      '{"type":"attempt","stage":"first"}\n{"type":"paragraph_delta",',
      '"stage":"first","text":"Draft"}\n{"type":"attempt","stage":"retry"}\n',
      `${JSON.stringify({ type: 'paragraph_delta', stage: 'retry', text: 'Final paragraph.' })}\n`,
      `${JSON.stringify({ type: 'result', result })}\n`,
    ])));

    await expect(streamVocabularyParagraph('ollama', 'model', ['final'], {
      onAttempt: (stage) => attempts.push(stage),
      onParagraphDelta: (text) => deltas.push(text),
    })).resolves.toEqual(result);

    expect(attempts).toEqual(['first', 'retry']);
    expect(deltas).toEqual(['Draft', 'Final paragraph.']);
    expect(fetch).toHaveBeenCalledWith('/api/ai/generate-paragraph/stream', expect.objectContaining({
      method: 'POST', signal: undefined,
    }));
  });

  it('throws a terminal stream error without accepting a draft as final', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      '{"type":"attempt","stage":"first"}\n',
      '{"type":"paragraph_delta","stage":"first","text":"Unvalidated"}\n',
      '{"type":"error","error":{"code":"AI_GENERATION_INVALID_RESPONSE","message":"Invalid result"}}\n',
    ])));

    await expect(streamVocabularyParagraph('ollama', 'model', ['word'])).rejects.toThrow('Invalid result');
  });

  it('requests paragraph audio on demand and forwards its AbortSignal', async () => {
    const audio = new Blob(['ID3audio'], { type: 'audio/mpeg' });
    const fetchMock = vi.fn(async () => new Response(audio, { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const result = await generateTtsAudio('Validated paragraph.', 'female', 1, controller.signal);

    expect(result.type).toBe('audio/mpeg');
    expect(fetchMock).toHaveBeenCalledWith('/api/tts', {
      method: 'POST',
      headers: { accept: 'audio/mpeg', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Validated paragraph.', voice: 'female', rate: 1 }),
      signal: controller.signal,
    });
  });
});

function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}
