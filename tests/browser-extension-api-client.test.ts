import { describe, expect, it, vi } from 'vitest';
import {
  backendPermissionOrigin,
  createDictionaryApi,
  normalizeBackendUrl,
} from '../extension/api-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('browser extension API client', () => {
  it('normalizes configurable backend URLs and derives a host permission', () => {
    expect(normalizeBackendUrl(' http://localhost:3000/ ')).toBe('http://localhost:3000');
    expect(backendPermissionOrigin('https://dictionary.example.test/base/')).toBe('https://dictionary.example.test/*');
    expect(() => normalizeBackendUrl('file:///tmp/backend')).toThrow(/HTTP or HTTPS/);
    expect(() => normalizeBackendUrl('http://user:secret@localhost:3000')).toThrow(/credentials/);
  });

  it('searches ready dictionaries in order and returns first exact entry detail', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/dictionaries') return jsonResponse({ items: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] });
      if (path === '/api/dictionaries/one/search') return jsonResponse({ items: [] });
      if (path === '/api/dictionaries/two/search') return jsonResponse({ items: [{ id: 'entry-two' }] });
      if (path === '/api/entries/entry-two') return jsonResponse({ id: 'entry-two', headword: 'Apple', plainText: 'A fruit.' });
      return jsonResponse({}, 404);
    });
    const api = createDictionaryApi('http://127.0.0.1:3000', fetchMock as typeof fetch);

    await expect(api.lookup('apple')).resolves.toEqual({
      dictionary: { id: 'two', name: 'Two' },
      entry: { id: 'entry-two', headword: 'Apple', plainText: 'A fruit.' },
      stylesheet: null,
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('q=apple&mode=exact&limit=1&offset=0');
  });

  it('uses prefix search for deduplicated autocomplete suggestions', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/dictionaries') {
        return jsonResponse({ items: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] });
      }
      if (parsed.pathname === '/api/dictionaries/one/search') {
        return jsonResponse({ items: [{ headword: 'Apple' }, { headword: 'applet' }] });
      }
      return jsonResponse({ items: [{ headword: 'apple' }, { headword: 'application' }] });
    });
    const suggestions = await createDictionaryApi('http://localhost:3000', fetchMock as typeof fetch).suggest('app', 3);

    expect(suggestions).toEqual([
      { headword: 'Apple', dictionaryName: 'One' },
      { headword: 'applet', dictionaryName: 'One' },
      { headword: 'application', dictionaryName: 'Two' },
    ]);
    expect(fetchMock.mock.calls.slice(1).every(([url]) => String(url).includes('mode=prefix'))).toBe(true);
  });

  it('loads a same-origin dictionary stylesheet with entry detail', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/dictionaries') return jsonResponse({ items: [{ id: 'one', name: 'One', stylesheetUrl: '/api/dictionaries/one/assets/dictionary.css' }] });
      if (path === '/api/dictionaries/one/search') return jsonResponse({ items: [{ id: 'entry-one' }] });
      if (path === '/api/entries/entry-one') return jsonResponse({ id: 'entry-one', headword: 'Apple', sanitizedHtml: '<b>fruit</b>' });
      if (path.endsWith('/dictionary.css')) return new Response('.entry { color: green; }');
      return jsonResponse({}, 404);
    });

    const result = await createDictionaryApi('http://localhost:3000', fetchMock as typeof fetch).lookup('apple');
    expect(result?.stylesheet).toBe('.entry { color: green; }');
  });

  it('returns null when no dictionary matches and sends vocabulary entry IDs', async () => {
    const lookupFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'one', name: 'One' }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    await expect(createDictionaryApi('http://localhost:3000', lookupFetch).lookup('missing')).resolves.toBeNull();

    const addFetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'saved' }, 201));
    await createDictionaryApi('http://localhost:3000', addFetch).addVocabulary('entry-id');
    expect(addFetch).toHaveBeenCalledWith('http://localhost:3000/api/vocabulary', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ entryId: 'entry-id' }),
    }));
  });

  it('surfaces backend error messages without exposing response internals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Dictionary unavailable' } }, 503));
    await expect(createDictionaryApi('http://localhost:3000', fetchMock).lookup('apple'))
      .rejects.toThrow('Dictionary unavailable');
  });
});
