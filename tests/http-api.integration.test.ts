import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { createApiServer } from '../src/http/server.js';

describe('HTTP API → DictionaryQueryService → PostgreSQL', () => {
  let server: FastifyInstance;
  let dictionaryId: string;
  let appleEntryId: string;
  let vocabularyEntryId: string;
  let nonReadyDictionaryId: string;
  const createdVocabularyIds = new Set<string>();

  beforeAll(async () => {
    const apple = await prisma.dictionaryEntry.findFirst({
      where: { headwordNormalized: 'apple', dictionary: { status: 'ready' } },
      select: { id: true, dictionaryId: true },
    });
    if (!apple) throw new Error('Integration database must contain "apple" in a ready dictionary');
    dictionaryId = apple.dictionaryId;
    appleEntryId = apple.id;

    const vocabularyEntry = await prisma.dictionaryEntry.findFirst({
      where: { dictionaryId, vocabularyItem: null },
      orderBy: { sourceOrdinal: 'asc' },
      select: { id: true },
    });
    if (!vocabularyEntry) throw new Error('Integration database needs an entry not already in vocabulary');
    vocabularyEntryId = vocabularyEntry.id;

    const nonReady = await prisma.dictionary.create({
      data: {
        name: 'http-non-ready-fixture',
        sourceFilename: 'http-fixture.mdx',
        fileChecksum: crypto.randomUUID(),
        storageKey: `http-fixture-${crypto.randomUUID()}.mdx`,
        status: 'importing',
      },
      select: { id: true },
    });
    nonReadyDictionaryId = nonReady.id;

    server = await createApiServer(prisma);
  });

  afterAll(async () => {
    if (createdVocabularyIds.size) {
      await prisma.vocabularyItem.deleteMany({ where: { id: { in: [...createdVocabularyIds] } } });
    }
    await server.close();
    await prisma.dictionary.delete({ where: { id: nonReadyDictionaryId } });
    await prisma.$disconnect();
  });

  async function get(path: string): Promise<{ response: { status: number }; body: any }> {
    const response = await server.inject({ method: 'GET', url: path });
    return { response: { status: response.statusCode }, body: response.json() };
  }

  it('serves Swagger UI and an OpenAPI document for all public APIs', async () => {
    const docs = await server.inject({ method: 'GET', url: '/docs/' });
    const openApi = await server.inject({ method: 'GET', url: '/docs/json' });

    expect(docs.statusCode).toBe(200);
    expect(docs.headers['content-type']).toContain('text/html');
    expect(openApi.statusCode).toBe(200);
    expect(openApi.json()).toEqual(expect.objectContaining({
      openapi: '3.0.3',
      paths: expect.objectContaining({
        '/api/dictionaries': expect.any(Object),
        '/api/dictionaries/{dictionaryId}/search': expect.any(Object),
        '/api/entries/{entryId}': expect.any(Object),
        '/api/vocabulary': expect.any(Object),
        '/api/vocabulary/{id}': expect.any(Object),
      }),
    }));
  });

  it('lists only ready dictionaries with a stable public shape', async () => {
    const { response, body } = await get('/api/dictionaries');

    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual(['items']);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items).toContainEqual(expect.objectContaining({
      id: dictionaryId,
      entryCount: 92667,
    }));
    expect(body.items.some((item: { id: string }) => item.id === nonReadyDictionaryId)).toBe(false);

    for (const item of body.items) {
      expect(Object.keys(item)).toEqual([
        'id',
        'name',
        'entryCount',
        'mdxFormatVersion',
        'sourceEncoding',
        'importedAt',
      ]);
      expect(item).not.toHaveProperty('storageKey');
      expect(item).not.toHaveProperty('fileChecksum');
      expect(item).not.toHaveProperty('headerMetadata');
      expect(item).not.toHaveProperty('failureSummary');
    }
  });

  it('returns exact apple with pagination metadata', async () => {
    const { response, body } = await get(`/api/dictionaries/${dictionaryId}/search?q=apple`);
    expect(response.status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.pagination).toEqual({ limit: 20, offset: 0, returned: body.items.length });
  });

  it('returns prefix app', async () => {
    const { response, body } = await get(`/api/dictionaries/${dictionaryId}/search?q=app&mode=prefix&limit=20&offset=0`);
    expect(response.status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item: { headword: string }) => item.headword.toLowerCase().startsWith('app'))).toBe(true);
  });

  it('returns 200 and an empty list for a missing word', async () => {
    const { response, body } = await get(`/api/dictionaries/${dictionaryId}/search?q=missing-${crypto.randomUUID()}`);
    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
  });

  it.each([
    ['invalid mode', '?q=apple&mode=fuzzy'],
    ['empty q', '?q=%20%20'],
  ])('returns 400 for %s', async (_case, queryString) => {
    const { response, body } = await get(`/api/dictionaries/${dictionaryId}/search${queryString}`);
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_QUERY');
  });

  it('returns 404 for a missing dictionary', async () => {
    const { response, body } = await get(`/api/dictionaries/${crypto.randomUUID()}/search?q=apple`);
    expect(response.status).toBe(404);
    expect(body.error.code).toBe('DICTIONARY_NOT_FOUND');
  });

  it('returns 409 for a dictionary that is not ready', async () => {
    const { response, body } = await get(`/api/dictionaries/${nonReadyDictionaryId}/search?q=apple`);
    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DICTIONARY_NOT_READY');
  });

  it('returns an existing entry detail', async () => {
    const { response, body } = await get(`/api/entries/${appleEntryId}`);
    expect(response.status).toBe(200);
    expect(body.id).toBe(appleEntryId);
    expect(body.sanitizedHtml).toBeTypeOf('string');
  });

  it('returns 404 for a missing entry', async () => {
    const { response, body } = await get(`/api/entries/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
    expect(body.error.code).toBe('ENTRY_NOT_FOUND');
  });

  it('does not expose raw entry data', async () => {
    const search = await get(`/api/dictionaries/${dictionaryId}/search?q=apple`);
    const detail = await get(`/api/entries/${appleEntryId}`);
    expect(JSON.stringify(search.body)).not.toMatch(/entry_?raw/i);
    expect(JSON.stringify(detail.body)).not.toMatch(/entry_?raw/i);
  });

  it('adds, lists, deduplicates, and removes a vocabulary item without exposing entryRaw', async () => {
    const added = await server.inject({
      method: 'POST', url: '/api/vocabulary', payload: { entryId: vocabularyEntryId },
    });
    expect(added.statusCode).toBe(201);
    const item = added.json();
    createdVocabularyIds.add(item.id);
    expect(item).toEqual(expect.objectContaining({
      id: expect.any(String), entryId: vocabularyEntryId, createdAt: expect.any(String),
      entry: expect.objectContaining({ id: vocabularyEntryId, headword: expect.any(String) }),
    }));
    expect(JSON.stringify(item)).not.toMatch(/entry_?raw/i);

    const duplicate = await server.inject({
      method: 'POST', url: '/api/vocabulary', payload: { entryId: vocabularyEntryId },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(item);

    const listed = await server.inject({ method: 'GET', url: '/api/vocabulary' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.filter((candidate: { entryId: string }) => candidate.entryId === vocabularyEntryId)).toEqual([item]);
    expect(JSON.stringify(listed.json())).not.toMatch(/entry_?raw/i);

    const removed = await server.inject({ method: 'DELETE', url: `/api/vocabulary/${item.id}` });
    expect(removed.statusCode).toBe(204);
    createdVocabularyIds.delete(item.id);

    const afterRemove = await server.inject({ method: 'GET', url: '/api/vocabulary' });
    expect(afterRemove.json().items.some((candidate: { id: string }) => candidate.id === item.id)).toBe(false);
  });

  it('rejects invalid vocabulary input', async () => {
    const invalidEntry = await server.inject({
      method: 'POST', url: '/api/vocabulary', payload: { entryId: 'not-a-uuid' },
    });
    const invalidItem = await server.inject({ method: 'DELETE', url: '/api/vocabulary/not-a-uuid' });
    expect(invalidEntry.statusCode).toBe(400);
    expect(invalidEntry.json().error.code).toBe('INVALID_QUERY');
    expect(invalidItem.statusCode).toBe(400);
    expect(invalidItem.json().error.code).toBe('INVALID_QUERY');
  });

  it('returns 404 for nonexistent entries and vocabulary items', async () => {
    const missingEntry = await server.inject({
      method: 'POST', url: '/api/vocabulary', payload: { entryId: crypto.randomUUID() },
    });
    const missingItem = await server.inject({
      method: 'DELETE', url: `/api/vocabulary/${crypto.randomUUID()}`,
    });
    expect(missingEntry.statusCode).toBe(404);
    expect(missingEntry.json().error.code).toBe('ENTRY_NOT_FOUND');
    expect(missingItem.statusCode).toBe(404);
    expect(missingItem.json().error.code).toBe('VOCABULARY_ITEM_NOT_FOUND');
  });
});
