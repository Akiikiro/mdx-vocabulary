import { AIModelService } from './ai-model-service.js';
import { LLMProviderError } from './llm-provider.js';

const MIN_PARAGRAPH_WORDS = 100;
const MAX_PARAGRAPH_WORDS = 150;
const MAX_VOCABULARY_ITEMS = 30;
const MAX_VOCABULARY_ITEM_LENGTH = 100;

export interface VocabularyGenerateRequest {
  provider: string;
  model: string;
  words: string[];
}

export interface VocabularyGenerateResult {
  paragraph: string;
  translation: string;
  usedWords: string[];
}

export class VocabularyGenerateError extends Error {
  constructor(
    readonly code:
      | 'INVALID_VOCABULARY_GENERATE_REQUEST'
      | 'AI_PROVIDER_NOT_FOUND'
      | 'AI_MODEL_NOT_FOUND'
      | 'AI_PROVIDER_UNAVAILABLE'
      | 'AI_GENERATION_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
  }
}

export class VocabularyGenerateService {
  constructor(private readonly models: AIModelService) {}

  async generate(request: VocabularyGenerateRequest): Promise<VocabularyGenerateResult> {
    const providerId = requiredIdentifier(request.provider, 'provider');
    const modelId = requiredIdentifier(request.model, 'model');
    const words = validateWords(request.words);
    const provider = this.models.getProvider(providerId);
    if (!provider) throw new VocabularyGenerateError('AI_PROVIDER_NOT_FOUND', 'AI provider not found');

    try {
      const availableModels = await provider.listModels();
      if (!availableModels.some((model) => model.id === modelId)) {
        throw new VocabularyGenerateError('AI_MODEL_NOT_FOUND', 'AI model not found');
      }

      const first = await provider.generateText({
        model: modelId,
        prompt: initialPrompt(words),
        responseFormat: 'json',
        temperature: 0.7,
        maxOutputTokens: 900,
      });
      const firstValidation = validateGeneratedResult(first.text, words);
      if (firstValidation.result) return firstValidation.result;

      const corrected = await provider.generateText({
        model: modelId,
        prompt: correctionPrompt(words, first.text, firstValidation.errors),
        responseFormat: 'json',
        temperature: 0.4,
        maxOutputTokens: 900,
      });
      const correctedValidation = validateGeneratedResult(corrected.text, words);
      if (correctedValidation.result) return correctedValidation.result;
      throw new VocabularyGenerateError(
        'AI_GENERATION_INVALID_RESPONSE',
        'AI generation did not produce a valid vocabulary paragraph',
      );
    } catch (error) {
      if (error instanceof VocabularyGenerateError) throw error;
      if (error instanceof LLMProviderError) {
        throw new VocabularyGenerateError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable');
      }
      throw error;
    }
  }
}

function initialPrompt(words: string[]): string {
  return `Create one vocabulary-learning result using every requested vocabulary item.

Requirements:
- Write one natural, coherent English paragraph for an intermediate learner.
- Target 120–130 English words so the paragraph remains safely within the required 100–150 word range. Use roughly 10–12 sentences of 10–14 words each. Before returning JSON, count the English words and revise the paragraph if it is outside 120–130 words.
- Use every requested item itself or only a simple grammatical inflection accepted by the validator (such as a plural, past tense, -ing, comparative, or superlative form).
- Do not replace a requested item with a derivationally related word. For example, use approve, approves, approved, or approving for "approve"; do not use "approval" as its replacement.
- Natural collocations matter more than forcing the exact base form.
- Do not force unrelated items into the same sentence.
- Provide a natural Chinese translation of the complete paragraph.
- Return JSON only, with exactly this shape: {"paragraph":"...","translation":"...","usedWords":["..."]}.
- Set usedWords to exactly ${JSON.stringify(words)}: preserve every supplied string unchanged and keep one supplied item per JSON array element.
- Do not include grammar analysis, Markdown headings, code fences, or extra commentary.

Requested vocabulary items:
${JSON.stringify(words)}`;
}

function correctionPrompt(words: string[], previousOutput: string, errors: string[]): string {
  return `Correct the previous vocabulary-learning result by fixing every listed validation failure and only those failures. Preserve all requested vocabulary items and all already-valid parts of the result.

The result must follow these requirements:
- Write one natural, coherent English paragraph for an intermediate learner, targeting 120–130 English words so it remains safely within the required 100–150 word range. Use roughly 10–12 sentences of 10–14 words each.
- Use every requested item itself or only a simple grammatical inflection accepted by the validator (such as a plural, past tense, -ing, comparative, or superlative form).
- Do not use derivational replacements. For example, "approval" does not satisfy the requested item "approve"; use approve, approves, approved, or approving instead.
- Keep every requested item represented even while correcting the listed failures, and prioritize natural collocations.
- A natural Chinese translation of the complete paragraph.
- JSON only with exactly: {"paragraph":"...","translation":"...","usedWords":["..."]}.
- Set usedWords to exactly ${JSON.stringify(words)}: copy every supplied string unchanged, in the supplied order, with one item per JSON array element. Do not combine, split, correct, inflect, or rewrite these strings.
- No grammar analysis, Markdown, code fences, or commentary.

Requested vocabulary items:
${JSON.stringify(words)}

Validation problems:
${JSON.stringify(errors)}

Fix each validation problem above explicitly. Do not omit or replace any requested vocabulary item while making the correction.
If paragraph length is listed as a problem, extend or rewrite the paragraph with natural supporting details until it contains 120–130 English words; count the words before returning it. Never return the previous output unchanged when any validation problem is listed.

Previous output:
${previousOutput}`;
}

function validateGeneratedResult(text: string, requestedWords: string[]): {
  result: VocabularyGenerateResult | null;
  errors: string[];
} {
  const errors: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { result: null, errors: ['Output is not valid JSON'] };
  }
  if (!isRecord(value) || Object.keys(value).some((key) => !['paragraph', 'translation', 'usedWords'].includes(key))) {
    return { result: null, errors: ['Output must be an object with only paragraph, translation, and usedWords'] };
  }
  const paragraph = typeof value.paragraph === 'string' ? value.paragraph.trim() : '';
  const translation = typeof value.translation === 'string' ? value.translation.trim() : '';
  const reportedWords = Array.isArray(value.usedWords) && value.usedWords.every((word) => typeof word === 'string')
    ? value.usedWords as string[]
    : null;
  if (!paragraph) errors.push('paragraph must be a non-empty string');
  if (!translation) errors.push('translation must be a non-empty string');
  if (!reportedWords) errors.push('usedWords must be an array of strings');

  const paragraphWords = lexicalTokens(paragraph);
  if (paragraphWords.length < MIN_PARAGRAPH_WORDS || paragraphWords.length > MAX_PARAGRAPH_WORDS) {
    errors.push(`paragraph must contain ${MIN_PARAGRAPH_WORDS}–${MAX_PARAGRAPH_WORDS} English words`);
  }
  const missingWords = requestedWords.filter((word) => !containsVocabularyItem(paragraphWords, lexicalTokens(word)));
  if (missingWords.length) errors.push(`paragraph is missing requested items: ${missingWords.join(', ')}`);

  if (reportedWords) {
    const expected = requestedWords.map(normalizeComparison).sort();
    const reported = reportedWords.map(normalizeComparison).sort();
    if (expected.length !== reported.length || expected.some((word, index) => word !== reported[index])) {
      errors.push('usedWords does not match the requested vocabulary items');
    }
  }

  return errors.length
    ? { result: null, errors }
    : { result: { paragraph, translation, usedWords: [...requestedWords] }, errors: [] };
}

function validateWords(input: string[]): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_VOCABULARY_ITEMS) {
    throw new VocabularyGenerateError(
      'INVALID_VOCABULARY_GENERATE_REQUEST',
      `words must contain 1 to ${MAX_VOCABULARY_ITEMS} items`,
    );
  }
  return input.map((inputWord) => {
    const word = typeof inputWord === 'string' ? inputWord.trim().normalize('NFC') : '';
    if (!word || Array.from(word).length > MAX_VOCABULARY_ITEM_LENGTH || /[\u0000-\u001f\u007f]/u.test(word)) {
      throw new VocabularyGenerateError(
        'INVALID_VOCABULARY_GENERATE_REQUEST',
        `each word must contain 1 to ${MAX_VOCABULARY_ITEM_LENGTH} safe characters`,
      );
    }
    if (lexicalTokens(word).length === 0) {
      throw new VocabularyGenerateError('INVALID_VOCABULARY_GENERATE_REQUEST', 'each word must contain letters or numbers');
    }
    return word;
  });
}

function requiredIdentifier(value: string, name: string): string {
  const identifier = typeof value === 'string' ? value.trim() : '';
  if (!identifier || identifier.length > 200 || /[\u0000-\u001f\u007f]/u.test(identifier)) {
    throw new VocabularyGenerateError('INVALID_VOCABULARY_GENERATE_REQUEST', `${name} is invalid`);
  }
  return identifier;
}

function lexicalTokens(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

function containsVocabularyItem(paragraphTokens: string[], targetTokens: string[]): boolean {
  if (targetTokens.length === 0 || paragraphTokens.length < targetTokens.length) return false;
  return paragraphTokens.some((_, start) => targetTokens.every(
    (target, offset) => inflectedForms(target).has(paragraphTokens[start + offset] ?? ''),
  ));
}

function inflectedForms(word: string): Set<string> {
  const forms = new Set([word, `${word}s`, `${word}ed`, `${word}ing`, `${word}er`, `${word}est`]);
  if (word.endsWith('e')) {
    forms.add(`${word}d`);
    forms.add(`${word.slice(0, -1)}ing`);
  }
  if (/[^aeiou]y$/u.test(word)) {
    const stem = word.slice(0, -1);
    forms.add(`${stem}ies`); forms.add(`${stem}ied`); forms.add(`${stem}ier`); forms.add(`${stem}iest`);
  }
  if (word.endsWith('ie')) forms.add(`${word.slice(0, -2)}ying`);
  if (/(?:s|x|z|ch|sh)$/u.test(word)) forms.add(`${word}es`);
  if (/[aeiou][^aeiouywx]$/u.test(word)) {
    const doubled = `${word}${word.at(-1)}`;
    forms.add(`${doubled}ed`); forms.add(`${doubled}ing`); forms.add(`${doubled}er`); forms.add(`${doubled}est`);
  }
  return forms;
}

function normalizeComparison(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
