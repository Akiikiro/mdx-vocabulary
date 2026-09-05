import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { PrismaClient } from '@prisma/client';
import { DictionaryQueryService } from '../query/dictionary-query-service.js';

export interface DictionaryListItemDTO {
  id: string;
  name: string;
  entryCount: number | null;
  mdxFormatVersion: string | null;
  sourceEncoding: string | null;
  importedAt: string | null;
}

interface SearchParams { dictionaryId: string }
interface EntryParams { entryId: string }
interface SearchQuery { q: string; mode?: 'exact' | 'prefix'; limit?: number; offset?: number }

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
  required: ['id', 'name', 'entryCount', 'mdxFormatVersion', 'sourceEncoding', 'importedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
    entryCount: { type: 'integer', nullable: true },
    mdxFormatVersion: { type: 'string', nullable: true },
    sourceEncoding: { type: 'string', nullable: true },
    importedAt: { type: 'string', format: 'date-time', nullable: true },
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

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function requireUuid(value: string, name: string): string {
  if (!value || !uuidPattern.test(value)) {
    throw new HttpError(400, 'INVALID_ID', `${name} must be a valid UUID`);
  }
  return value;
}

export async function createApiServer(database: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const queryService = new DictionaryQueryService(database);

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'MDX Vocabulary API', version: '0.1.0' },
      tags: [
        { name: 'dictionaries', description: 'Ready dictionaries and entry search' },
        { name: 'entries', description: 'Dictionary entry details' },
      ],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: { docExpansion: 'list', deepLinking: true },
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
        sourceEncoding: true, importedAt: true,
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

  await app.ready();
  return app;
}
