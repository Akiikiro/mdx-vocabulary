import { describe, expect, it, vi } from 'vitest';
import { AIModelService } from '../src/ai/ai-model-service.js';
import { LLMProviderError, type LLMProvider } from '../src/ai/llm-provider.js';
import { VocabularyGenerateService } from '../src/ai/vocabulary-generate-service.js';

describe('VocabularyGenerateService', () => {
  it('uses a runtime-selected provider/model and validates inflected coverage', async () => {
    const paragraph = paragraphWith('studies', 'planned');
    const provider = fakeProvider([generatedOutput(['study', 'plan'], paragraph)]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));

    await expect(service.generate({ provider: 'fixture', model: 'model-b', words: ['study', 'plan'] }))
      .resolves.toEqual({ paragraph, translation: '自然的中文翻译。', usedWords: ['study', 'plan'] });
    expect(provider.generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-b', responseFormat: 'json', prompt: expect.stringMatching(
        /Target 120–130.*Do not replace.*Set usedWords to exactly \["study","plan"\]/s,
      ),
    }));
  });

  it('retries once with validation feedback and returns the corrected result', async () => {
    const provider = fakeProvider([
      generatedOutput(['cat'], paragraphWith('dog')),
      generatedOutput(['cat'], paragraphWith('cats')),
    ]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));

    const result = await service.generate({ provider: 'fixture', model: 'model-a', words: ['cat'] });
    expect(result.usedWords).toEqual(['cat']);
    expect(provider.generateText).toHaveBeenCalledTimes(2);
    expect(provider.generateText).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: expect.stringMatching(
        /only those failures.*"approval" does not satisfy.*Set usedWords to exactly \["cat"\].*paragraph is missing requested items: cat.*Never return the previous output unchanged/s,
      ),
    }));
  });

  it('rejects output that still fails validation after one retry', async () => {
    const provider = fakeProvider(['not json', generatedOutput(['cat'], paragraphWith('dog'))]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));
    await expect(service.generate({ provider: 'fixture', model: 'model-a', words: ['cat'] })).rejects.toMatchObject({
      code: 'AI_GENERATION_INVALID_RESPONSE',
    });
    expect(provider.generateText).toHaveBeenCalledTimes(2);
  });

  it('validates provider, model, words, and provider availability', async () => {
    const provider = fakeProvider([]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));
    await expect(service.generate({ provider: 'missing', model: 'model-a', words: ['cat'] })).rejects.toMatchObject({ code: 'AI_PROVIDER_NOT_FOUND' });
    await expect(service.generate({ provider: 'fixture', model: 'missing', words: ['cat'] })).rejects.toMatchObject({ code: 'AI_MODEL_NOT_FOUND' });
    await expect(service.generate({ provider: 'fixture', model: 'model-a', words: ['\u0000'] })).rejects.toMatchObject({ code: 'INVALID_VOCABULARY_GENERATE_REQUEST' });

    provider.listModels = vi.fn(async () => { throw new LLMProviderError('LLM_PROVIDER_UNAVAILABLE', 'private detail'); });
    await expect(service.generate({ provider: 'fixture', model: 'model-a', words: ['cat'] })).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE', message: 'AI provider is unavailable',
    });
  });
});

function fakeProvider(outputs: string[]): LLMProvider {
  return {
    id: 'fixture', displayName: 'Fixture',
    listModels: vi.fn(async () => [
      { id: 'model-a', displayName: 'Model A' }, { id: 'model-b', displayName: 'Model B' },
    ]),
    generateText: vi.fn(async (request) => ({ model: request.model, text: outputs.shift() ?? '' })),
  };
}

function paragraphWith(...featuredWords: string[]): string {
  return [...featuredWords, ...Array.from({ length: 100 - featuredWords.length }, () => 'learner')].join(' ');
}

function generatedOutput(usedWords: string[], paragraph: string): string {
  return JSON.stringify({ paragraph, translation: '自然的中文翻译。', usedWords });
}
