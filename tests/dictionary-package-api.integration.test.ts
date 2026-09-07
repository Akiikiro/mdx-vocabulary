import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiServer } from '../src/http/server.js';
import { DictionaryStylesheetCompatibilityService } from '../src/dictionary-stylesheets/dictionary-stylesheet-compatibility-service.js';
import { DictionaryPackageStorage } from '../src/storage/dictionary-package-storage.js';

interface FixtureFile { filename: string; content: string | Buffer }

describe('dictionary package HTTP import', () => {
  const database = new PrismaClient();
  const dictionaryIds: string[] = [];
  let storageRoot: string;
  let server: FastifyInstance;

  beforeAll(async () => {
    storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdx-vocabulary-package-test-'));
    server = await createApiServer(database, {
      packageStorage: new DictionaryPackageStorage(storageRoot),
      startImportJob: () => {},
    });
  });

  afterAll(async () => {
    await server.close();
    if (dictionaryIds.length) await database.dictionary.deleteMany({ where: { id: { in: dictionaryIds } } });
    await database.$disconnect();
    await fsp.rm(storageRoot, { recursive: true, force: true });
  });

  async function upload(files: FixtureFile[]) {
    const multipart = multipartBody(files);
    return server.inject({
      method: 'POST', url: '/api/dictionaries/import', payload: multipart.body,
      headers: { 'content-type': `multipart/form-data; boundary=${multipart.boundary}` },
    });
  }

  it('imports one MDX and one CSS, stores MDD resources, serves CSS, and appears when ready', async () => {
    const response = await upload([
      { filename: 'Fixture/fixture.mdx', content: 'small mdx fixture' },
      { filename: 'Fixture/theme.css', content: '.entry { color: navy; }' },
      { filename: 'Fixture/fixture.mdd', content: Buffer.from([1, 2, 3]) },
      { filename: 'Fixture/fixture.1.mdd', content: Buffer.from([4, 5]) },
      { filename: 'Fixture/cover.jpg', content: Buffer.from([0xff, 0xd8, 0xff]) },
    ]);

    expect(response.statusCode).toBe(202);
    const imported = response.json();
    dictionaryIds.push(imported.dictionaryId);
    expect(imported).toEqual(expect.objectContaining({
      name: 'fixture', status: 'queued', fileCount: 5, resourceCount: 3,
      stylesheetUrl: `/api/dictionaries/${imported.dictionaryId}/assets/styles/theme.css`,
    }));

    const dictionary = await database.dictionary.findUniqueOrThrow({ where: { id: imported.dictionaryId } });
    expect(dictionary.storageKey).toBe(`dictionaries/${imported.dictionaryId}/source.mdx`);
    expect(dictionary.packageStorageKey).toBe(`dictionaries/${imported.dictionaryId}`);
    const queuedStatus = await server.inject({ method: 'GET', url: `/api/dictionaries/${imported.dictionaryId}/import-status` });
    expect(queuedStatus.json()).toEqual({
      dictionaryId: imported.dictionaryId, status: 'queued', progress: { current: 0, total: null },
    });
    const packageRoot = path.join(storageRoot, dictionary.packageStorageKey!);
    await expect(fsp.readFile(path.join(packageRoot, 'source.mdx'), 'utf8')).resolves.toBe('small mdx fixture');
    await expect(fsp.readFile(path.join(packageRoot, 'styles/theme.css'), 'utf8')).resolves.toBe('.entry { color: navy; }');
    await expect(fsp.readFile(path.join(packageRoot, 'resources/fixture.mdd'))).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(fsp.readFile(path.join(packageRoot, 'resources/fixture.1.mdd'))).resolves.toEqual(Buffer.from([4, 5]));

    const stylesheet = await server.inject({ method: 'GET', url: imported.stylesheetUrl });
    expect(stylesheet.statusCode).toBe(200);
    expect(stylesheet.headers['content-type']).toContain('text/css');
    expect(stylesheet.body).toBe('.entry { color: navy; }');

    await database.dictionary.update({ where: { id: imported.dictionaryId }, data: { status: 'ready', importedAt: new Date() } });
    const dictionaries = await server.inject({ method: 'GET', url: '/api/dictionaries' });
    expect(dictionaries.json().items).toContainEqual(expect.objectContaining({
      id: imported.dictionaryId, stylesheetUrl: imported.stylesheetUrl,
    }));
  });

  it('accepts an MDX-only package without a stylesheet', async () => {
    const response = await upload([{ filename: 'Plain/plain.mdx', content: 'mdx only' }]);
    expect(response.statusCode).toBe(202);
    const imported = response.json();
    dictionaryIds.push(imported.dictionaryId);
    expect(imported.stylesheetUrl).toBeNull();
    expect((await database.dictionary.findUniqueOrThrow({ where: { id: imported.dictionaryId } })).stylesheetUrl).toBeNull();
  });

  it('detects Oxford compatibility from stylesheet content, independent of dictionary UUID', async () => {
    const oxfordCss = await fsp.readFile(path.resolve('web/public/dictionaries/oxford8/O8C.css'));
    const response = await upload([
      { filename: 'Reimport/renamed.mdx', content: 'small mdx fixture' },
      { filename: 'Reimport/renamed-theme.css', content: oxfordCss },
    ]);
    expect(response.statusCode).toBe(202);
    const imported = response.json();
    dictionaryIds.push(imported.dictionaryId);
    expect(imported.stylesheetCompatibilityProfile).toBe('oxford8');
    expect(imported.stylesheetUrl).toContain(`/api/dictionaries/${imported.dictionaryId}/`);
    expect((await database.dictionary.findUniqueOrThrow({ where: { id: imported.dictionaryId } }))
      .stylesheetCompatibilityProfile).toBe('oxford8');
  });

  it('reconciles a package imported before compatibility metadata existed', async () => {
    const oxfordCss = await fsp.readFile(path.resolve('web/public/dictionaries/oxford8/O8C.css'));
    const response = await upload([
      { filename: 'Existing/existing.mdx', content: 'small mdx fixture' },
      { filename: 'Existing/O8C.css', content: oxfordCss },
    ]);
    const imported = response.json();
    dictionaryIds.push(imported.dictionaryId);
    await database.dictionary.update({
      where: { id: imported.dictionaryId },
      data: { stylesheetCompatibilityProfile: null },
    });

    await new DictionaryStylesheetCompatibilityService(
      database,
      new DictionaryPackageStorage(storageRoot),
    ).reconcileStoredPackages();

    expect((await database.dictionary.findUniqueOrThrow({ where: { id: imported.dictionaryId } }))
      .stylesheetCompatibilityProfile).toBe('oxford8');
  });

  it('documents the streaming multipart package request', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/docs/json' });
    expect(openApi.json().paths['/api/dictionaries/import'].post.requestBody.content['multipart/form-data'].schema)
      .toEqual(expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({ files: expect.objectContaining({ type: 'array' }) }),
      }));
  });

  it.each([
    ['no MDX', [{ filename: 'Invalid/style.css', content: '.entry {}' }]],
    ['multiple MDX', [
      { filename: 'Invalid/one.mdx', content: 'one' },
      { filename: 'Invalid/two.mdx', content: 'two' },
    ]],
    ['multiple CSS', [
      { filename: 'Invalid/one.mdx', content: 'one' },
      { filename: 'Invalid/one.css', content: 'one' },
      { filename: 'Invalid/two.css', content: 'two' },
    ]],
  ])('rejects a package with %s', async (_case, files) => {
    const response = await upload(files);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_DICTIONARY_PACKAGE');
  });

  it('rejects path traversal without writing outside package storage', async () => {
    const escapedPath = path.join(storageRoot, 'escape.mdx');
    const response = await upload([{ filename: '../escape.mdx', content: 'escape' }]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_DICTIONARY_PACKAGE');
    await expect(fsp.access(escapedPath)).rejects.toThrow();
  });
});

function multipartBody(files: FixtureFile[]): { boundary: string; body: Buffer } {
  const boundary = `----mdx-vocabulary-${crypto.randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ));
    chunks.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}
