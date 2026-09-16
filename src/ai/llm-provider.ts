export interface LLMModel {
  id: string;
  displayName: string;
}

export type JsonSchema = Record<string, unknown>;

export type LLMResponseFormat = 'json' | {
  type: 'json_schema';
  schema: JsonSchema;
};

export interface LLMTextGenerationRequest {
  model: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: LLMResponseFormat;
}

export interface LLMTextGenerationResult {
  model: string;
  text: string;
}

export interface LLMTextGenerationChunk {
  textDelta: string;
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  listModels(): Promise<LLMModel[]>;
  generateText(request: LLMTextGenerationRequest): Promise<LLMTextGenerationResult>;
  generateTextStream?(
    request: LLMTextGenerationRequest,
    signal?: AbortSignal,
  ): AsyncIterable<LLMTextGenerationChunk>;
}

export class LLMProviderError extends Error {
  constructor(
    readonly code: 'LLM_PROVIDER_UNAVAILABLE' | 'LLM_PROVIDER_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
  }
}
