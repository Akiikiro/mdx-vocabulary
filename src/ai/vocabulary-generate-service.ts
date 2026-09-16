import { AIModelService } from './ai-model-service.js';
import { LLMProviderError } from './llm-provider.js';

const MAX_VOCABULARY_ITEMS = 30;
const MAX_VOCABULARY_ITEM_LENGTH = 100;
const VOCABULARY_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    paragraph: { type: 'string', minLength: 1 },
    translation: { type: 'string', minLength: 1 },
    usedWords: { type: 'array', items: { type: 'string' } },
  },
  required: ['paragraph', 'translation', 'usedWords'],
  additionalProperties: false,
};

interface ParagraphLengthPolicy {
  min: number;
  max: number;
  targetMin: number;
  targetMax: number;
  sentenceGuidance: string;
}

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
        responseFormat: { type: 'json_schema', schema: VOCABULARY_GENERATION_SCHEMA },
        temperature: 0.7,
        maxOutputTokens: 900,
      });
      const firstValidation = validateGeneratedResult(first.text, words);
      logGenerationValidation('first', words, firstValidation);
      if (firstValidation.result) return firstValidation.result;

      const corrected = await provider.generateText({
        model: modelId,
        prompt: correctionPrompt(words, first.text, firstValidation.errors),
        responseFormat: { type: 'json_schema', schema: VOCABULARY_GENERATION_SCHEMA },
        temperature: 0,
        maxOutputTokens: 900,
      });
      const correctedValidation = validateGeneratedResult(corrected.text, words);
      logGenerationValidation('retry', words, correctedValidation);
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
  const length = paragraphLengthPolicy(words.length);
  return `Create one vocabulary-learning result using every requested vocabulary item.

Requirements:
- Write one natural, coherent English paragraph for an intermediate learner.
- Build the paragraph around one simple, plausible story or situation. Each sentence must follow logically from the previous sentences and contribute to that same situation.
- Give the paragraph a lightweight mini-story arc: establish the situation, introduce one small realistic problem or change, show a reasonable response, and end with an outcome. Do not write a diary-like list of flat actions such as "I did A. Then I did B. Then I did C."
- Target ${length.targetMin}–${length.targetMax} English words so the paragraph remains safely within the required ${length.min}–${length.max} word range. ${length.sentenceGuidance} Before returning JSON, count the English words and revise the paragraph if it is outside ${length.targetMin}–${length.targetMax} words.
- Use every requested item itself or only a simple grammatical inflection accepted by the validator (such as a plural, past tense, -ing, comparative, or superlative form).
- Do not replace a requested item with a derivationally related word. For example, use approve, approves, approved, or approving for "approve"; do not use "approval" as its replacement.
- Use each vocabulary item only where its meaning and common collocations naturally fit the situation. Never invent an unlikely action, decision, or cause-and-effect link merely to include a word.
- Different vocabulary items may appear in separate sentences; they only need to belong naturally to the same overall situation. Do not force unrelated items into the same sentence or make one vocabulary use the reason for another.
- Use "so", "because", "therefore", and similar connectors only when there is a genuine cause-and-effect relationship. For example, finding a bit of time does not cause someone to approve a plan, and a friend approving of a recipe does not by itself cause someone to eat more.
- Once an item has been used naturally, avoid repeating it unless repetition is genuinely needed for a clear, natural connection.
- Before returning, review every vocabulary use for natural collocation and review every cause/effect or logical connection between sentences. Revise anything a fluent English speaker would find implausible or awkward.
- paragraph must contain the complete real English paragraph.
- translation must contain a natural Chinese translation of the complete paragraph.
- usedWords must equal ${JSON.stringify(words)}, preserving every supplied string unchanged and keeping one supplied item per array element.
- Return JSON only. Do not include grammar analysis, Markdown headings, code fences, or extra commentary.
- Never return ellipsis, placeholder text, or sample values in any field.

Requested vocabulary items:
${JSON.stringify(words)}`;
}

function correctionPrompt(words: string[], previousOutput: string, errors: string[]): string {
  const length = paragraphLengthPolicy(words.length);
  const actions = correctionActions(words, errors, length);
  return `Correct the previous vocabulary-learning result with minimal edits. Do not freely rewrite content that already passes validation.

Correction actions—repair these detected problems while ensuring the final result satisfies the complete contract below:
${actions.map((action) => `- ${action}`).join('\n')}

Complete final contract—recheck every requirement before responding, including requirements that were not reported as validation problems:
- paragraph must contain ${length.min}–${length.max} English words; target ${length.targetMin}–${length.targetMax} words. ${length.sentenceGuidance}
- paragraph must use every requested vocabulary item itself or a simple grammatical inflection accepted by the validator. Do not use a derivational replacement.
- translation must be a non-empty, natural Chinese translation of the complete final paragraph.
- usedWords must exactly match ${JSON.stringify(words)}, preserving one supplied string per array element.
- Return JSON only. Never return ellipsis, placeholder text, sample values, Markdown, code fences, analysis, commentary, or any surrounding text.

Preservation rules:
- Preserve every already-valid requested vocabulary occurrence in the paragraph. Simple grammatical inflections remain allowed, but derivational replacements do not; for example, "approval" does not satisfy "approve".
- Any added or edited sentence must fit the same coherent situation, use natural collocations, and maintain plausible logical or cause/effect relationships. Do not add unnecessary vocabulary repetition.
- Leave paragraph wording unchanged except where a correction action explicitly requires a paragraph edit.
- Leave usedWords unchanged unless a correction action explicitly requires replacing it.
- Leave the Chinese translation unchanged if the paragraph is unchanged. If the paragraph changes, update only the corresponding translation text.
- Return JSON only with no Markdown, code fences, analysis, commentary, ellipsis, placeholder text, or sample values.

Requested vocabulary items:
${JSON.stringify(words)}

Validation problems:
${JSON.stringify(errors)}

Previous output:
${previousOutput}`;
}

function correctionActions(
  words: string[],
  errors: string[],
  length: ParagraphLengthPolicy,
): string[] {
  return errors.map((error) => {
    if (error.startsWith('paragraph must contain ')) {
      return `Fix paragraph length only: preserve its existing vocabulary usage and wording, then append natural supporting details if too short or trim only unnecessary wording if too long. Make the final paragraph ${length.targetMin}–${length.targetMax} English words and count it before responding. Copy the already-valid usedWords array unchanged as ${JSON.stringify(words)}.`;
    }
    if (error === 'usedWords does not match the requested vocabulary items' || error === 'usedWords must be an array of strings') {
      return `Replace usedWords only by copying this exact JSON array verbatim: ${JSON.stringify(words)}. Keep one supplied string per array item without combining, splitting, inflecting, correcting, or retyping it.`;
    }
    if (error.startsWith('paragraph is missing requested items:')) {
      const missing = error.slice('paragraph is missing requested items:'.length).trim();
      return `Repair paragraph coverage only for these missing items: ${missing}. Add or minimally edit only the sentences needed to use each missing item itself or a simple accepted inflection; preserve every already-valid vocabulary occurrence and avoid derivational replacements.`;
    }
    return `Fix only this validation problem while preserving every other field and already-valid detail: ${error}.`;
  });
}

function validateGeneratedResult(text: string, requestedWords: string[]): {
  result: VocabularyGenerateResult | null;
  errors: string[];
  paragraphWordCount: number | null;
} {
  const errors: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { result: null, errors: ['Output is not valid JSON'], paragraphWordCount: null };
  }
  if (!isRecord(value)) {
    return {
      result: null,
      errors: ['Output must be an object with only paragraph, translation, and usedWords'],
      paragraphWordCount: null,
    };
  }
  if (Object.keys(value).some((key) => !['paragraph', 'translation', 'usedWords'].includes(key))) {
    errors.push('Output must be an object with only paragraph, translation, and usedWords');
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
  const paragraphWordCount = typeof value.paragraph === 'string' ? paragraphWords.length : null;
  const length = paragraphLengthPolicy(requestedWords.length);
  if (paragraphWords.length < length.min || paragraphWords.length > length.max) {
    errors.push(`paragraph must contain ${length.min}–${length.max} English words`);
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
    ? { result: null, errors, paragraphWordCount }
    : {
        result: { paragraph, translation, usedWords: [...requestedWords] },
        errors: [],
        paragraphWordCount,
      };
}

function paragraphLengthPolicy(wordCount: number): ParagraphLengthPolicy {
  if (wordCount <= 3) {
    return { min: 35, max: 120, targetMin: 65, targetMax: 75, sentenceGuidance: 'Use roughly 5–7 sentences.' };
  }
  if (wordCount <= 7) {
    return { min: 50, max: 150, targetMin: 90, targetMax: 105, sentenceGuidance: 'Use roughly 7–9 sentences.' };
  }
  return { min: 80, max: 180, targetMin: 120, targetMax: 130, sentenceGuidance: 'Use roughly 10–12 sentences of 10–14 words each.' };
}

function logGenerationValidation(
  stage: 'first' | 'retry',
  requestedWords: string[],
  validation: { errors: string[]; paragraphWordCount: number | null },
): void {
  if (validation.errors.length === 0 || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return;
  console.info(JSON.stringify({
    event: 'vocabulary_generation_validation',
    stage,
    requestedWordCount: requestedWords.length,
    requestedWords,
    paragraphWordCount: validation.paragraphWordCount,
    failures: validation.errors,
  }));
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
