import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { AIModelService } from '../ai/ai-model-service.js';
import { LLMProviderError, type LLMProvider } from '../ai/llm-provider.js';
import { OllamaLLMProvider } from '../ai/ollama-llm-provider.js';
import {
  VocabularyGenerateError,
  VocabularyGenerateService,
} from '../ai/vocabulary-generate-service.js';
import { config } from '../config.js';
import { DictionaryStylesheetCompatibilityService } from '../dictionary-stylesheets/dictionary-stylesheet-compatibility-service.js';
import {
  DictionaryPackageImportService,
  DictionaryPackageValidationError,
} from '../importer/dictionary-package-import-service.js';
import { DictionaryQueryService, parseLazyDictionaryDetailEnabled, type DictionaryDetailShadowHook, type LazyPrimaryEvent, type LazyPrimaryOptions } from '../query/dictionary-query-service.js';
import { classifyLazyDetailFailure, DictionaryDetailShadowVerifier, parseShadowSampleRate } from '../query/dictionary-detail-shadow-verifier.js';
import { LazyDictionaryDetailPocService } from '../query/lazy-dictionary-detail-poc-service.js';
import { JsMdictLazyAdapter } from '../mdx/lazy-mdx-adapter.js';
import { LocalDirectoryStorage } from '../storage/local-directory-storage.js';
import { JsMddResourceAdapter, type MddResourceAdapter } from '../mdx/mdd-resource-adapter.js';
import { DictionaryResourceService } from '../resources/dictionary-resource-service.js';
import {
  PronunciationAudioError,
  PronunciationAudioService,
} from '../resources/pronunciation-audio-service.js';
import {
  EdgeTtsError,
  EdgeTtsService,
  MAX_TTS_RATE,
  MAX_TTS_TEXT_LENGTH,
  MIN_TTS_RATE,
  type EdgeTtsVoice,
} from '../resources/edge-tts-service.js';
import { InvalidLogicalResourcePathError } from '../resources/logical-resource-path.js';
import {
  DictionaryPackageStorage,
  InvalidPackagePathError,
} from '../storage/dictionary-package-storage.js';
import {
  VocabularyEntryNotFoundError,
  VocabularyItemNotFoundError,
  VocabularyService,
} from '../vocabulary/vocabulary-service.js';

export interface DictionaryListItemDTO {
  id: string;
  name: string;
  entryCount: number | null;
  mdxFormatVersion: string | null;
  sourceEncoding: string | null;
  importedAt: string | null;
  stylesheetUrl: string | null;
  stylesheetCompatibilityProfile: string | null;
}

interface SearchParams { dictionaryId: string }
interface EntryParams { entryId: string }
interface VocabularyParams { id: string }
interface AddVocabularyBody { entryId: string }
interface SearchQuery { q: string; mode?: 'exact' | 'prefix'; limit?: number; offset?: number }
interface DictionaryParams { dictionaryId: string }
interface DictionaryAssetParams extends DictionaryParams { '*': string }
interface EdgeTtsQuery { word: string; voice: EdgeTtsVoice }
interface TtsBody { text: string; voice: EdgeTtsVoice; rate: number }
interface GenerateParagraphBody { provider: string; model: string; words: string[] }

export interface ApiServerOptions {
  startImportJob?: (jobId: string) => void | Promise<void>;
  packageStorage?: DictionaryPackageStorage;
  mddResourceAdapter?: MddResourceAdapter;
  pronunciationAudioService?: Pick<PronunciationAudioService, 'getAudio'>;
  edgeTtsService?: Pick<EdgeTtsService, 'getAudio' | 'getTextAudio'>;
  llmProviders?: readonly LLMProvider[];
  detailShadow?: DictionaryDetailShadowHook;
  lazyPrimary?: LazyPrimaryOptions;
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const errorSchema = {
  type: 'object', required: ['error'],
  properties: {
    error: {
      type: 'object', required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
} as const;
const dictionarySchema = {
  type: 'object',
  required: ['id', 'name', 'entryCount', 'mdxFormatVersion', 'sourceEncoding', 'importedAt', 'stylesheetUrl', 'stylesheetCompatibilityProfile'],
  properties: {
    id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
    entryCount: { type: 'integer', nullable: true },
    mdxFormatVersion: { type: 'string', nullable: true },
    sourceEncoding: { type: 'string', nullable: true },
    importedAt: { type: 'string', format: 'date-time', nullable: true },
    stylesheetUrl: { type: 'string', nullable: true },
    stylesheetCompatibilityProfile: { type: 'string', nullable: true },
  },
} as const;
const searchEntrySchema = {
  type: 'object',
  required: ['id', 'dictionaryId', 'headword', 'kind', 'plainText', 'redirectTarget', 'sourceOrdinal'],
  properties: {
    id: { type: 'string', format: 'uuid' }, dictionaryId: { type: 'string', format: 'uuid' },
    headword: { type: 'string' },
    kind: { type: 'string', enum: ['definition', 'redirect', 'unknown'] },
    plainText: { type: 'string' }, redirectTarget: { type: 'string', nullable: true },
    sourceOrdinal: { type: 'integer' },
  },
} as const;
const detailEntrySchema = {
  ...searchEntrySchema,
  required: [...searchEntrySchema.required, 'sanitizedHtml'],
  properties: { ...searchEntrySchema.properties, sanitizedHtml: { type: 'string' } },
} as const;
const vocabularyItemSchema = {
  type: 'object',
  required: ['id', 'entryId', 'createdAt', 'entry'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    entryId: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    entry: searchEntrySchema,
  },
} as const;
const dictionaryPackageUploadSchema = {
  type: 'object',
  properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
} as const;
const aiModelsSchema = {
  type: 'object', required: ['providers'],
  properties: {
    providers: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'displayName', 'models'],
        properties: {
          id: { type: 'string' }, displayName: { type: 'string' },
          models: {
            type: 'array',
            items: {
              type: 'object', required: ['id', 'displayName'],
              properties: { id: { type: 'string' }, displayName: { type: 'string' } },
            },
          },
        },
      },
    },
  },
} as const;
const generatedParagraphSchema = {
  type: 'object', required: ['paragraph', 'translation', 'usedWords'],
  properties: {
    paragraph: { type: 'string' },
    translation: { type: 'string' },
    usedWords: { type: 'array', items: { type: 'string' } },
  },
} as const;
const generateParagraphBodySchema = {
  type: 'object', required: ['provider', 'model', 'words'], additionalProperties: false,
  properties: {
    provider: { type: 'string', minLength: 1, maxLength: 200 },
    model: { type: 'string', minLength: 1, maxLength: 200 },
    words: {
      type: 'array', minItems: 1, maxItems: 30,
      items: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
} as const;

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function requireUuid(value: string, name: string): string {
  if (!value || !uuidPattern.test(value)) {
    throw new HttpError(400, 'INVALID_ID', `${name} must be a valid UUID`);
  }
  return value;
}

export async function createApiServer(database: PrismaClient, options: ApiServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const shadowRate = parseShadowSampleRate(process.env.SHADOW_DETAIL_SAMPLE_RATE);
  const lazyPrimaryEnabled = options.lazyPrimary?.enabled ?? parseLazyDictionaryDetailEnabled(process.env.LAZY_DICTIONARY_DETAIL_ENABLED);
  const lazyMdxAdapter = !options.detailShadow && !options.lazyPrimary && (shadowRate > 0 || lazyPrimaryEnabled) ? new JsMdictLazyAdapter() : null;
  const localStorage = new LocalDirectoryStorage(config.dataDir);
  const lazyDetailService = lazyMdxAdapter ? new LazyDictionaryDetailPocService(database, lazyMdxAdapter, (key) => localStorage.pathFor(key)) : null;
  const detailShadow = lazyPrimaryEnabled ? undefined : options.detailShadow ?? (lazyDetailService ? new DictionaryDetailShadowVerifier(
    database,
    lazyDetailService,
    shadowRate,
    process.env.SHADOW_DETAIL_SAMPLE_SEED ?? 'default',
    (result) => console.info(JSON.stringify({
      event: 'dictionary_detail_shadow', dictionaryId: result.dictionaryId, entryId: result.entryId,
      shadowStatus: result.status, mismatchType: result.failureCategory ?? (result.identityMismatches.length ? result.identityMismatches : undefined),
      htmlMismatch: result.htmlMismatch, plainTextMismatch: result.plainTextMismatch,
      lazyDurationMs: result.lazyDurationMs, storedDurationMs: result.storedDurationMs,
    })),
  ) : undefined);
  const logLazyPrimary = (event: LazyPrimaryEvent) => console.info(JSON.stringify(event));
  const lazyPrimary = options.lazyPrimary ?? (lazyPrimaryEnabled && lazyDetailService
    ? { enabled: true, reader: lazyDetailService, observe: logLazyPrimary } : undefined);
  const queryService = new DictionaryQueryService(database, detailShadow, lazyPrimary);
  if (lazyPrimaryEnabled && lazyDetailService && process.env.LAZY_DICTIONARY_DETAIL_WARMUP === 'true') {
    const active = await database.dictionary.findFirst({ where: { status: 'ready', packageStorageKey: { not: null } }, orderBy: { importedAt: 'desc' }, select: { id: true } });
    if (active) {
      try { const result = await lazyDetailService.warmupDictionary(active.id); console.info(JSON.stringify({ event: 'dictionary_detail_lazy_warmup', dictionaryId: active.id, status: 'success', ...result })); }
      catch (error) { console.info(JSON.stringify({ event: 'dictionary_detail_lazy_warmup', dictionaryId: active.id, status: 'failure', failureReason: classifyLazyDetailFailure(error) })); }
    }
  }
  const vocabularyService = new VocabularyService(database);
  const aiModelService = new AIModelService(options.llmProviders ?? configuredLLMProviders());
  const vocabularyGenerateService = new VocabularyGenerateService(aiModelService);
  const packageStorage = options.packageStorage ?? new DictionaryPackageStorage(config.dataDir);
  const mddResourceAdapter = options.mddResourceAdapter ?? new JsMddResourceAdapter();
  const resourceService = new DictionaryResourceService(database, packageStorage, mddResourceAdapter);
  const pronunciationAudioService = options.pronunciationAudioService ?? new PronunciationAudioService(
    database,
    resourceService,
    packageStorage.pathForStorageKey('.cache/pronunciation-audio'),
  );
  const edgeTtsService = options.edgeTtsService ?? new EdgeTtsService(
    packageStorage.pathForStorageKey('.cache/edge-tts'),
  );
  app.addHook('onClose', async () => { mddResourceAdapter.close?.(); lazyMdxAdapter?.close(); });
  const packageImportService = new DictionaryPackageImportService(database, packageStorage);
  await new DictionaryStylesheetCompatibilityService(database, packageStorage).reconcileStoredPackages();
  const startImportJob = options.startImportJob ?? startWorkerProcess;

  await app.register(swagger, {
    transform: ({ schema, url }) => {
      if (url === '/api/dictionaries/import') {
        return { schema: { ...schema, body: dictionaryPackageUploadSchema }, url };
      }
      if (url === '/api/dictionaries/:dictionaryId/resources/*') {
        return {
          schema: {
            ...schema,
            response: {
              ...((schema.response ?? {}) as Record<string, unknown>),
              200: {
                description: 'Decoded bytes stored in the MDD resource; the response Content-Type is detected from its bytes',
                content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
              },
            },
          } as typeof schema,
          url,
        };
      }
      if (url === '/api/dictionaries/:dictionaryId/browser-audio/*') {
        return {
          schema: {
            ...schema,
            response: {
              ...((schema.response ?? {}) as Record<string, unknown>),
              200: {
                description: 'Browser-compatible MP3 derived from an Ogg/Speex pronunciation resource',
                content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
              },
            },
          } as typeof schema,
          url,
        };
      }
      if (url === '/api/experimental/edge-tts') {
        return {
          schema: {
            ...schema,
            response: {
              ...((schema.response ?? {}) as Record<string, unknown>),
              200: {
                description: 'Experimental Edge TTS MP3 pronunciation',
                content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
              },
            },
          } as typeof schema,
          url,
        };
      }
      if (url === '/api/tts') {
        return {
          schema: {
            ...schema,
            response: {
              ...((schema.response ?? {}) as Record<string, unknown>),
              200: {
                description: 'On-demand text-to-speech MP3 audio',
                content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
              },
            },
          } as typeof schema,
          url,
        };
      }
      return { schema, url };
    },
    openapi: {
      openapi: '3.0.3',
      info: { title: 'MDX Vocabulary API', version: '0.1.0' },
      tags: [
        { name: 'dictionaries', description: 'Ready dictionaries and entry search' },
        { name: 'entries', description: 'Dictionary entry details' },
        { name: 'resources', description: 'Dictionary-scoped MDD binary resources' },
        { name: 'vocabulary', description: 'Local vocabulary book' },
        { name: 'ai', description: 'Configured AI providers and models' },
      ],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
  await app.register(multipart, {
    limits: { files: 100, fileSize: 2 * 1024 * 1024 * 1024, parts: 100 },
    preservePath: true,
  });

  app.get('/api/ai/models', {
    schema: {
      operationId: 'listAIModels', summary: 'List configured AI providers and available models', tags: ['ai'],
      response: { 200: aiModelsSchema, 503: errorSchema, 500: errorSchema },
    },
  }, async () => {
    try {
      return await aiModelService.listModels();
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw new HttpError(503, 'AI_PROVIDER_UNAVAILABLE', 'AI model discovery is unavailable');
      }
      throw error;
    }
  });

  app.post<{ Body: GenerateParagraphBody }>('/api/ai/generate-paragraph', {
    schema: {
      operationId: 'generateVocabularyParagraph', summary: 'Generate a bilingual vocabulary review paragraph', tags: ['ai'],
      body: generateParagraphBodySchema,
      response: {
        200: generatedParagraphSchema,
        400: errorSchema, 502: errorSchema, 503: errorSchema, 500: errorSchema,
      },
    },
  }, async (request) => {
    try {
      return await vocabularyGenerateService.generate(request.body);
    } catch (error) {
      if (error instanceof VocabularyGenerateError) {
        const status = error.code === 'AI_PROVIDER_UNAVAILABLE'
          ? 503
          : error.code === 'AI_GENERATION_INVALID_RESPONSE' ? 502 : 400;
        throw new HttpError(status, error.code, error.message);
      }
      throw error;
    }
  });

  app.post<{ Body: GenerateParagraphBody }>('/api/ai/generate-paragraph/stream', {
    schema: {
      operationId: 'streamVocabularyParagraph', summary: 'Stream a bilingual vocabulary review paragraph', tags: ['ai'],
      body: generateParagraphBodySchema,
      produces: ['application/x-ndjson'],
      response: {
        200: { type: 'string', description: 'Newline-delimited vocabulary generation events' },
        400: errorSchema, 500: errorSchema,
      },
    },
  }, async (request, reply) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once('aborted', abort);
    reply.raw.once('close', () => {
      if (!reply.raw.writableEnded) abort();
    });

    async function* eventLines(): AsyncIterable<string> {
      try {
        for await (const event of vocabularyGenerateService.generateStream(request.body, controller.signal)) {
          yield `${JSON.stringify(event)}\n`;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof VocabularyGenerateError) {
          yield `${JSON.stringify({ error: { code: error.code, message: error.message }, type: 'error' })}\n`;
          return;
        }
        app.log.error(error);
        yield `${JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, type: 'error' })}\n`;
      } finally {
        request.raw.off('aborted', abort);
      }
    }

    return reply
      .header('cache-control', 'no-cache, no-transform')
      .header('x-accel-buffering', 'no')
      .type('application/x-ndjson; charset=utf-8')
      .send(Readable.from(eventLines()));
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send(errorBody(error.code, error.message));
    }
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      return reply.code(400).send(errorBody('INVALID_QUERY', 'Invalid request parameters'));
    }
    app.log.error(error);
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'An unexpected error occurred'));
  });

  app.get('/api/dictionaries', {
    schema: {
      operationId: 'listDictionaries', summary: 'List ready dictionaries', tags: ['dictionaries'],
      response: {
        200: {
          type: 'object', required: ['items'],
          properties: { items: { type: 'array', items: dictionarySchema } },
        },
        500: errorSchema,
      },
    },
  }, async () => {
    const dictionaries = await database.dictionary.findMany({
      where: { status: 'ready' }, orderBy: { importedAt: 'desc' },
      select: {
        id: true, name: true, entryCount: true, mdxFormatVersion: true,
        sourceEncoding: true, importedAt: true, stylesheetUrl: true, stylesheetCompatibilityProfile: true,
      },
    });
    const items: DictionaryListItemDTO[] = dictionaries.map((dictionary) => ({
      ...dictionary, importedAt: dictionary.importedAt?.toISOString() ?? null,
    }));
    return { items };
  });

  app.get<{ Params: SearchParams; Querystring: SearchQuery }>('/api/dictionaries/:dictionaryId/search', {
    schema: {
      operationId: 'searchDictionary', summary: 'Search entries in a ready dictionary', tags: ['dictionaries'],
      params: {
        type: 'object', required: ['dictionaryId'],
        properties: { dictionaryId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object', required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1 },
          mode: { type: 'string', enum: ['exact', 'prefix'], default: 'exact' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
      response: {
        200: {
          type: 'object', required: ['items', 'pagination'],
          properties: {
            items: { type: 'array', items: searchEntrySchema },
            pagination: {
              type: 'object', required: ['limit', 'offset', 'returned'],
              properties: {
                limit: { type: 'integer' }, offset: { type: 'integer' }, returned: { type: 'integer' },
              },
            },
          },
        },
        400: errorSchema, 404: errorSchema, 409: errorSchema, 500: errorSchema,
      },
    },
  }, async (request) => {
    const dictionaryId = requireUuid(request.params.dictionaryId, 'dictionaryId');
    const query = request.query.q.trim();
    if (!query) throw new HttpError(400, 'INVALID_QUERY', 'q must not be empty');
    const mode = request.query.mode ?? 'exact';
    const limit = request.query.limit ?? 20;
    const offset = request.query.offset ?? 0;

    const dictionary = await database.dictionary.findUnique({
      where: { id: dictionaryId }, select: { status: true },
    });
    if (!dictionary) throw new HttpError(404, 'DICTIONARY_NOT_FOUND', 'Dictionary not found');
    if (dictionary.status !== 'ready') {
      throw new HttpError(409, 'DICTIONARY_NOT_READY', 'Dictionary is not ready');
    }

    const options = { limit, offset };
    const items = mode === 'exact'
      ? await queryService.searchExact(dictionaryId, query, options)
      : await queryService.searchPrefix(dictionaryId, query, options);
    return { items, pagination: { limit, offset, returned: items.length } };
  });

  app.post('/api/dictionaries/import', {
    schema: {
      operationId: 'importDictionaryPackage', summary: 'Upload and import an MDict dictionary package', tags: ['dictionaries'],
      consumes: ['multipart/form-data'],
      response: {
        202: {
          type: 'object',
          required: ['dictionaryId', 'jobId', 'name', 'status', 'stylesheetUrl', 'stylesheetCompatibilityProfile', 'fileCount', 'resourceCount'],
          properties: {
            dictionaryId: { type: 'string', format: 'uuid' }, jobId: { type: 'string', format: 'uuid' },
            name: { type: 'string' }, status: { type: 'string', enum: ['queued'] },
            stylesheetUrl: { type: 'string', nullable: true }, fileCount: { type: 'integer' }, resourceCount: { type: 'integer' },
            stylesheetCompatibilityProfile: { type: 'string', nullable: true },
          },
        },
        400: errorSchema, 500: errorSchema,
      },
    },
  }, async (request, reply) => {
    const stagingDirectory = await packageStorage.createStagingDirectory();
    try {
      const files = [];
      for await (const part of request.parts()) {
        if (part.type !== 'file') continue;
        files.push(await packageStorage.stageFile(stagingDirectory, part.filename, part.file));
      }
      const result = await packageImportService.import(stagingDirectory, files);
      await startImportJob(result.jobId);
      return reply.code(202).send(result);
    } catch (error) {
      await packageStorage.cleanup(stagingDirectory);
      if (error instanceof DictionaryPackageValidationError || error instanceof InvalidPackagePathError) {
        throw new HttpError(400, 'INVALID_DICTIONARY_PACKAGE', error.message);
      }
      throw error;
    }
  });

  app.get<{ Params: DictionaryParams }>('/api/dictionaries/:dictionaryId/import-status', {
    schema: {
      operationId: 'getDictionaryImportStatus', summary: 'Get dictionary import status', tags: ['dictionaries'],
      params: { type: 'object', required: ['dictionaryId'], properties: { dictionaryId: { type: 'string', format: 'uuid' } } },
      response: {
        200: {
          type: 'object', required: ['dictionaryId', 'status', 'progress'],
          properties: {
            dictionaryId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['queued', 'importing', 'ready', 'failed'] },
            progress: {
              type: 'object', required: ['current', 'total'],
              properties: { current: { type: 'integer' }, total: { type: 'integer', nullable: true } },
            },
          },
        },
        400: errorSchema, 404: errorSchema, 500: errorSchema,
      },
    },
  }, async (request) => {
    const dictionaryId = requireUuid(request.params.dictionaryId, 'dictionaryId');
    const dictionary = await database.dictionary.findUnique({
      where: { id: dictionaryId },
      select: {
        id: true, status: true,
        importJobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { progressCurrent: true, progressTotal: true } },
      },
    });
    if (!dictionary) throw new HttpError(404, 'DICTIONARY_NOT_FOUND', 'Dictionary not found');
    const job = dictionary.importJobs[0];
    return {
      dictionaryId: dictionary.id,
      status: dictionary.status,
      progress: { current: job?.progressCurrent ?? 0, total: job?.progressTotal ?? null },
    };
  });

  app.get<{ Params: DictionaryAssetParams }>('/api/dictionaries/:dictionaryId/assets/*', {
    schema: {
      operationId: 'getDictionaryStylesheet', summary: 'Get a dictionary CSS asset', tags: ['dictionaries'],
      params: {
        type: 'object', required: ['dictionaryId', '*'],
        properties: { dictionaryId: { type: 'string', format: 'uuid' }, '*': { type: 'string' } },
      },
      response: { 200: { type: 'string' }, 400: errorSchema, 404: errorSchema, 500: errorSchema },
    },
  }, async (request, reply) => {
    const dictionaryId = requireUuid(request.params.dictionaryId, 'dictionaryId');
    const dictionary = await database.dictionary.findUnique({
      where: { id: dictionaryId }, select: { packageStorageKey: true, stylesheetUrl: true },
    });
    if (!dictionary?.packageStorageKey || dictionary.stylesheetUrl !== request.url) {
      throw new HttpError(404, 'DICTIONARY_ASSET_NOT_FOUND', 'Dictionary asset not found');
    }
    try {
      const assetPath = packageStorage.stylesheetPath(dictionary.packageStorageKey, request.params['*']);
      await import('node:fs/promises').then((fs) => fs.access(assetPath));
      return reply.type('text/css; charset=utf-8').send(createReadStream(assetPath));
    } catch (error) {
      if (error instanceof InvalidPackagePathError || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
        throw new HttpError(404, 'DICTIONARY_ASSET_NOT_FOUND', 'Dictionary asset not found');
      }
      throw error;
    }
  });

  app.get<{ Params: DictionaryAssetParams }>('/api/dictionaries/:dictionaryId/resources/*', {
    schema: {
      operationId: 'getDictionaryResource', summary: 'Get an exact dictionary MDD resource', tags: ['resources'],
      params: {
        type: 'object', required: ['dictionaryId', '*'],
        properties: {
          dictionaryId: { type: 'string', format: 'uuid' },
          '*': { type: 'string', minLength: 1, description: 'Case-sensitive, Unicode logical resource path' },
        },
      },
      response: {
        200: { type: 'string', format: 'binary', description: 'Decoded bytes stored in the MDD resource' },
        400: errorSchema, 404: errorSchema, 500: errorSchema,
      },
    },
  }, async (request, reply) => {
    const dictionaryId = requireUuid(request.params.dictionaryId, 'dictionaryId');
    try {
      const resource = await resourceService.getResource(dictionaryId, request.params['*']);
      if (!resource) throw new HttpError(404, 'DICTIONARY_RESOURCE_NOT_FOUND', 'Dictionary resource not found');
      return reply.header('Cache-Control', 'private, max-age=3600').type(resource.contentType).send(resource.bytes);
    } catch (error) {
      if (error instanceof InvalidLogicalResourcePathError) {
        throw new HttpError(400, 'INVALID_RESOURCE_PATH', error.message);
      }
      throw error;
    }
  });

  app.get<{ Params: DictionaryAssetParams }>('/api/dictionaries/:dictionaryId/browser-audio/*', {
    schema: {
      operationId: 'getBrowserPronunciationAudio', summary: 'Get browser-compatible pronunciation audio', tags: ['resources'],
      params: {
        type: 'object', required: ['dictionaryId', '*'],
        properties: {
          dictionaryId: { type: 'string', format: 'uuid' },
          '*': { type: 'string', minLength: 1, description: 'Case-sensitive, Unicode logical Ogg/Speex resource path' },
        },
      },
      response: {
        200: { type: 'string', format: 'binary', description: 'On-demand mono MP3 pronunciation audio' },
        400: errorSchema, 404: errorSchema, 415: errorSchema, 503: errorSchema, 500: errorSchema,
      },
    },
  }, async (request, reply) => {
    const dictionaryId = requireUuid(request.params.dictionaryId, 'dictionaryId');
    try {
      const audio = await pronunciationAudioService.getAudio(dictionaryId, request.params['*']);
      if (!audio) throw new HttpError(404, 'PRONUNCIATION_AUDIO_NOT_FOUND', 'Pronunciation audio not found');
      return reply.header('Cache-Control', 'private, max-age=3600').type(audio.contentType).send(audio.bytes);
    } catch (error) {
      if (error instanceof InvalidLogicalResourcePathError) {
        throw new HttpError(400, 'INVALID_RESOURCE_PATH', error.message);
      }
      if (error instanceof PronunciationAudioError) {
        const status = error.code === 'INVALID_PRONUNCIATION_AUDIO' ? 415 : 503;
        throw new HttpError(status, error.code, error.message);
      }
      throw error;
    }
  });

  app.get<{ Querystring: EdgeTtsQuery }>('/api/experimental/edge-tts', {
    schema: {
      operationId: 'getExperimentalEdgeTts', summary: 'Generate an experimental Edge TTS pronunciation', tags: ['resources'],
      querystring: {
        type: 'object', required: ['word', 'voice'], additionalProperties: false,
        properties: {
          word: { type: 'string', minLength: 1, maxLength: 100 },
          voice: { type: 'string', enum: ['female', 'male'] },
        },
      },
      response: {
        200: { type: 'string', format: 'binary', description: 'Experimental Edge TTS mono MP3' },
        400: errorSchema, 503: errorSchema, 500: errorSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const audio = await edgeTtsService.getAudio(request.query.word, request.query.voice);
      return reply
        .header('Cache-Control', 'private, max-age=86400')
        .type(audio.contentType)
        .send(audio.bytes);
    } catch (error) {
      if (error instanceof EdgeTtsError) {
        throw new HttpError(error.code === 'INVALID_EDGE_TTS_REQUEST' ? 400 : 503, error.code, error.message);
      }
      throw error;
    }
  });

  app.post<{ Body: TtsBody }>('/api/tts', {
    schema: {
      operationId: 'generateTtsAudio', summary: 'Generate text-to-speech audio', tags: ['resources'],
      body: {
        type: 'object', required: ['text', 'voice', 'rate'], additionalProperties: false,
        properties: {
          text: { type: 'string', minLength: 1, maxLength: MAX_TTS_TEXT_LENGTH },
          voice: { type: 'string', enum: ['female', 'male'] },
          rate: { type: 'number', minimum: MIN_TTS_RATE, maximum: MAX_TTS_RATE },
        },
      },
      response: {
        200: { type: 'string', format: 'binary', description: 'On-demand text-to-speech MP3 audio' },
        400: errorSchema, 503: errorSchema, 500: errorSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const audio = await edgeTtsService.getTextAudio(request.body.text, request.body.voice, request.body.rate);
      return reply
        .header('Cache-Control', 'private, max-age=86400')
        .type(audio.contentType)
        .send(audio.bytes);
    } catch (error) {
      if (error instanceof EdgeTtsError) {
        throw new HttpError(error.code === 'INVALID_EDGE_TTS_REQUEST' ? 400 : 503, error.code, error.message);
      }
      throw error;
    }
  });

  app.get<{ Params: EntryParams }>('/api/entries/:entryId', {
    schema: {
      operationId: 'getEntry', summary: 'Get an entry detail', tags: ['entries'],
      params: {
        type: 'object', required: ['entryId'],
        properties: { entryId: { type: 'string', format: 'uuid' } },
      },
      response: { 200: detailEntrySchema, 400: errorSchema, 404: errorSchema, 500: errorSchema },
    },
  }, async (request) => {
    const entryId = requireUuid(request.params.entryId, 'entryId');
    const entry = await queryService.getEntry(entryId);
    if (!entry) throw new HttpError(404, 'ENTRY_NOT_FOUND', 'Entry not found');
    return entry;
  });

  app.get('/api/vocabulary', {
    schema: {
      operationId: 'listVocabulary', summary: 'List vocabulary items', tags: ['vocabulary'],
      response: {
        200: {
          type: 'object', required: ['items'],
          properties: { items: { type: 'array', items: vocabularyItemSchema } },
        },
        500: errorSchema,
      },
    },
  }, async () => ({ items: await vocabularyService.list() }));

  app.post<{ Body: AddVocabularyBody }>('/api/vocabulary', {
    schema: {
      operationId: 'addVocabulary', summary: 'Add an entry to vocabulary', tags: ['vocabulary'],
      body: {
        type: 'object', required: ['entryId'], additionalProperties: false,
        properties: { entryId: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: vocabularyItemSchema, 201: vocabularyItemSchema,
        400: errorSchema, 404: errorSchema, 500: errorSchema,
      },
    },
  }, async (request, reply) => {
    const entryId = requireUuid(request.body.entryId, 'entryId');
    try {
      const result = await vocabularyService.add(entryId);
      return reply.code(result.created ? 201 : 200).send(result.item);
    } catch (error) {
      if (error instanceof VocabularyEntryNotFoundError) {
        throw new HttpError(404, 'ENTRY_NOT_FOUND', 'Entry not found');
      }
      throw error;
    }
  });

  app.delete<{ Params: VocabularyParams }>('/api/vocabulary/:id', {
    schema: {
      operationId: 'removeVocabulary', summary: 'Remove a vocabulary item', tags: ['vocabulary'],
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: { 204: { type: 'null' }, 400: errorSchema, 404: errorSchema, 500: errorSchema },
    },
  }, async (request, reply) => {
    const id = requireUuid(request.params.id, 'id');
    try {
      await vocabularyService.remove(id);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof VocabularyItemNotFoundError) {
        throw new HttpError(404, 'VOCABULARY_ITEM_NOT_FOUND', 'Vocabulary item not found');
      }
      throw error;
    }
  });

  await app.ready();
  return app;
}

function startWorkerProcess(jobId: string): void {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts', jobId], {
    cwd: process.cwd(), env: process.env, detached: true, stdio: 'ignore',
  });
  child.unref();
}

function configuredLLMProviders(): LLMProvider[] {
  return config.ollamaBaseUrl ? [new OllamaLLMProvider(config.ollamaBaseUrl, fetch, {
    requestTimeoutMs: config.ollamaRequestTimeoutMs,
    coldStartTimeoutMs: config.ollamaColdStartTimeoutMs,
    generationTimeoutMs: config.ollamaGenerationTimeoutMs,
  })] : [];
}
