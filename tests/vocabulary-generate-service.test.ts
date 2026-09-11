import { describe, expect, it, vi } from 'vitest';
import { AIModelService } from '../src/ai/ai-model-service.js';
import { LLMProviderError, type LLMProvider } from '../src/ai/llm-provider.js';
import { VocabularyGenerateService } from '../src/ai/vocabulary-generate-service.js';

describe('VocabularyGenerateService', () => {
  it('uses a runtime-selected provider/model and validates inflected coverage', async () => {
    const paragraph = paragraphWithCount(70, 'studies', 'planned');
    const provider = fakeProvider([generatedOutput(['study', 'plan'], paragraph)]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));

    await expect(service.generate({ provider: 'fixture', model: 'model-b', words: ['study', 'plan'] }))
      .resolves.toEqual({ paragraph, translation: '自然的中文翻译。', usedWords: ['study', 'plan'] });
    expect(provider.generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-b', responseFormat: 'json', prompt: expect.stringMatching(
        /Target 65–75.*required 35–120.*Do not replace.*Set usedWords to exactly \["study","plan"\]/s,
      ),
    }));
  });

  it('prompts for one coherent situation, natural collocations, and plausible logical relationships', async () => {
    const words = ['bit', 'approve'];
    const provider = fakeProvider([generatedOutput(words, paragraphWithCount(70, ...words))]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));

    await service.generate({ provider: 'fixture', model: 'model-a', words });
    const prompt = vi.mocked(provider.generateText).mock.calls[0]?.[0].prompt ?? '';
    expect(prompt).toContain('one simple, plausible story or situation');
    expect(prompt).toContain('lightweight mini-story arc');
    expect(prompt).toContain('one small realistic problem or change');
    expect(prompt).toContain('show a reasonable response, and end with an outcome');
    expect(prompt).toContain('Do not write a diary-like list of flat actions');
    expect(prompt).toContain('meaning and common collocations naturally fit the situation');
    expect(prompt).toContain('Never invent an unlikely action, decision, or cause-and-effect link');
    expect(prompt).toContain('Different vocabulary items may appear in separate sentences');
    expect(prompt).toContain('similar connectors only when there is a genuine cause-and-effect relationship');
    expect(prompt).toContain('finding a bit of time does not cause someone to approve a plan');
    expect(prompt).toContain('avoid repeating it unless repetition is genuinely needed');
    expect(prompt).toContain('review every cause/effect or logical connection between sentences');
  });

  it('keeps the established paragraph length policy for ten requested words', async () => {
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const paragraph = paragraphWithCount(100, ...words);
    const provider = fakeProvider([generatedOutput(words, paragraph)]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));

    await expect(service.generate({ provider: 'fixture', model: 'model-a', words })).resolves.toEqual({
      paragraph, translation: '自然的中文翻译。', usedWords: words,
    });
    expect(provider.generateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringMatching(/Target 120–130.*required 80–180/s),
    }));
  });

  it('uses the wider validation range without changing the target for four to seven words', async () => {
    const words = ['one', 'two', 'three', 'four', 'five'];
    const paragraph = paragraphWithCount(50, ...words);
    const provider = fakeProvider([generatedOutput(words, paragraph)]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));

    await expect(service.generate({ provider: 'fixture', model: 'model-a', words })).resolves.toEqual({
      paragraph, translation: '自然的中文翻译。', usedWords: words,
    });
    expect(provider.generateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringMatching(/Target 90–105.*required 50–150/s),
    }));
  });

  it('retries once with validation feedback and returns the corrected result', async () => {
    const provider = fakeProvider([
      generatedOutput(['cat'], paragraphWithCount(70, 'dog')),
      generatedOutput(['cat'], paragraphWithCount(70, 'cats')),
    ]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));

    const result = await service.generate({ provider: 'fixture', model: 'model-a', words: ['cat'] });
    expect(result.usedWords).toEqual(['cat']);
    expect(provider.generateText).toHaveBeenCalledTimes(2);
    expect(provider.generateText).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: expect.stringMatching(
        /minimal edits.*Repair paragraph coverage only for these missing items: cat.*preserve every already-valid vocabulary occurrence/s,
      ),
    }));
    const correctionPrompt = vi.mocked(provider.generateText).mock.calls[1]?.[0].prompt ?? '';
    expect(correctionPrompt).not.toContain('Fix paragraph length only');
    expect(correctionPrompt).not.toContain('Replace usedWords only');
  });

  it('gives a length-only retry instructions to preserve valid vocabulary usage', async () => {
    const words = ['cat', 'dog'];
    const provider = fakeProvider([
      generatedOutput(words, paragraphWithCount(34, ...words)),
      generatedOutput(words, paragraphWithCount(70, ...words)),
    ]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));

    await service.generate({ provider: 'fixture', model: 'model-a', words });
    const prompt = vi.mocked(provider.generateText).mock.calls[1]?.[0].prompt ?? '';
    expect(prompt).toContain('Fix paragraph length only: preserve its existing vocabulary usage and wording');
    expect(prompt).toContain('Make the final paragraph 65–75 English words');
    expect(prompt).toContain('Copy the already-valid usedWords array unchanged as ["cat","dog"]');
    expect(prompt).not.toContain('Replace usedWords only');
    expect(prompt).not.toContain('Repair paragraph coverage only');
    expect(provider.generateText).toHaveBeenNthCalledWith(2, expect.objectContaining({ temperature: 0 }));
  });

  it('gives a usedWords-only retry the exact supplied array without requesting paragraph edits', async () => {
    const words = ['cat', 'dog'];
    const paragraph = paragraphWithCount(70, ...words);
    const provider = fakeProvider([
      generatedOutput(['cat,dog'], paragraph),
      generatedOutput(words, paragraph),
    ]);
    const service = new VocabularyGenerateService(new AIModelService([provider]));

    await service.generate({ provider: 'fixture', model: 'model-a', words });
    const prompt = vi.mocked(provider.generateText).mock.calls[1]?.[0].prompt ?? '';
    expect(prompt).toContain('Replace usedWords only by copying this exact JSON array verbatim: ["cat","dog"]');
    expect(prompt).not.toContain('Fix paragraph length only');
    expect(prompt).not.toContain('Repair paragraph coverage only');
  });

  it('rejects output that still fails validation after one retry', async () => {
    const provider = fakeProvider(['not json', generatedOutput(['cat'], paragraphWithCount(70, 'dog'))]);
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

function paragraphWithCount(count: number, ...featuredWords: string[]): string {
  return [...featuredWords, ...Array.from({ length: count - featuredWords.length }, () => 'learner')].join(' ');
}

function generatedOutput(usedWords: string[], paragraph: string): string {
  return JSON.stringify({ paragraph, translation: '自然的中文翻译。', usedWords });
}
