import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { DictionaryQueryService } from '../src/query/dictionary-query-service.js';

describe('DictionaryQueryService → PostgreSQL', () => {
  const service = new DictionaryQueryService(prisma);
  let dictionaryId: string;

  beforeAll(async () => {
    const apple = await prisma.dictionaryEntry.findFirst({
      where: { headwordNormalized: 'apple' },
      select: { dictionaryId: true },
    });
    if (!apple) throw new Error('Integration database must contain an "apple" entry');
    dictionaryId = apple.dictionaryId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(['apple', 'abandon'])('finds all exact matches for %s', async (query) => {
    const results = await service.searchExact(dictionaryId, query, {});

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.dictionaryId === dictionaryId)).toBe(true);
    expect(results.map((entry) => entry.sourceOrdinal)).toEqual(
      [...results].map((entry) => entry.sourceOrdinal).sort((a, b) => a - b),
    );
  });

  it('finds a paginated, sorted app prefix', async () => {
    const options = { limit: 20, offset: 1 };
    const expected = await prisma.dictionaryEntry.findMany({
      where: { dictionaryId, headwordNormalized: { startsWith: 'app' } },
      orderBy: [{ sortKey: 'asc' }, { sourceOrdinal: 'asc' }],
      skip: options.offset,
      take: options.limit,
      select: { id: true },
    });
    const results = await service.searchPrefix(dictionaryId, 'app', options);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(20);
    expect(results.every((entry) => entry.headword.toLocaleLowerCase('en-US').startsWith('app'))).toBe(true);
    expect(results.map((entry) => entry.id)).toEqual(expected.map((entry) => entry.id));
  });

  it('returns an empty list for a missing word', async () => {
    await expect(service.searchExact(dictionaryId, `missing-${crypto.randomUUID()}`, {})).resolves.toEqual([]);
  });

  it('returns redirect metadata and resolves its target content once', async () => {
    const [redirect] = await service.searchExact(dictionaryId, 'a catch-22 situation', {});

    expect(redirect).toBeDefined();
    expect(redirect.kind).toBe('redirect');
    expect(redirect.redirectTarget).toBeTruthy();
    expect(redirect.plainText.length).toBeGreaterThan(0);

    const detail = await service.getEntry(redirect.id);
    expect(detail?.redirectTarget).toBe(redirect.redirectTarget);
    expect(detail?.sanitizedHtml.length).toBeGreaterThan(0);
  });

  it('never exposes entry_raw', async () => {
    const [searchResult] = await service.searchExact(dictionaryId, 'apple', {});
    const detail = await service.getEntry(searchResult.id);

    expect(searchResult).not.toHaveProperty('entryRaw');
    expect(searchResult).not.toHaveProperty('entry_raw');
    expect(detail).not.toHaveProperty('entryRaw');
    expect(detail).not.toHaveProperty('entry_raw');
  });
});
