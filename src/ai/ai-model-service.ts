import type { LLMProvider } from './llm-provider.js';

export interface AIModelDTO {
  id: string;
  displayName: string;
}

export interface AIProviderModelsDTO {
  id: string;
  displayName: string;
  models: AIModelDTO[];
}

export interface AIModelsDTO {
  providers: AIProviderModelsDTO[];
}

export class AIModelService {
  private readonly providersById: Map<string, LLMProvider>;

  constructor(providers: readonly LLMProvider[]) {
    this.providersById = new Map(providers.map((provider) => [provider.id, provider]));
    if (this.providersById.size !== providers.length) throw new Error('LLM provider IDs must be unique');
  }

  getProvider(providerId: string): LLMProvider | null {
    return this.providersById.get(providerId) ?? null;
  }

  async listModels(): Promise<AIModelsDTO> {
    return {
      providers: await Promise.all([...this.providersById.values()].map(async (provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        models: await provider.listModels(),
      }))),
    };
  }
}
