import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { DictionaryStylesheetCompatibilityService } from '../dictionary-stylesheets/dictionary-stylesheet-compatibility-service.js';
import {
  DictionaryPackageImportService,
  DictionaryPackageValidationError,
} from '../importer/dictionary-package-import-service.js';
import { DictionaryQueryService } from '../query/dictionary-query-service.js';
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

export interface ApiServerOptions {
  startImportJob?: (jobId: string) => void | Promise<void>;
  packageStorage?: DictionaryPackageStorage;
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
  const queryService = new DictionaryQueryService(database);
  const vocabularyService = new VocabularyService(database);
  const packageStorage = options.packageStorage ?? new DictionaryPackageStorage(config.dataDir);
  const packageImportService = new DictionaryPackageImportService(database, packageStorage);
  await new DictionaryStylesheetCompatibilityService(database, packageStorage).reconcileStoredPackages();
  const startImportJob = options.startImportJob ?? startWorkerProcess;

  await app.register(swagger, {
    transform: ({ schema, url }) => ({
      schema: url === '/api/dictionaries/import'
        ? { ...schema, body: dictionaryPackageUploadSchema }
        : schema,
      url,
    }),
    openapi: {
      openapi: '3.0.3',
      info: { title: 'MDX Vocabulary API', version: '0.1.0' },
      tags: [
        { name: 'dictionaries', description: 'Ready dictionaries and entry search' },
        { name: 'entries', description: 'Dictionary entry details' },
        { name: 'vocabulary', description: 'Local vocabulary book' },
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
