export interface LLMModel {
  id: string;
  displayName: string;
}

export interface LLMTextGenerationRequest {
  model: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: 'json';
}

export interface LLMTextGenerationResult {
  model: string;
  text: string;
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  listModels(): Promise<LLMModel[]>;
  generateText(request: LLMTextGenerationRequest): Promise<LLMTextGenerationResult>;
}

export class LLMProviderError extends Error {
  constructor(
    readonly code: 'LLM_PROVIDER_UNAVAILABLE' | 'LLM_PROVIDER_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
  }
}
