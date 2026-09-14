export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3000';

export function normalizeBackendUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error('Backend URL must be a valid HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Backend URL must use HTTP or HTTPS and must not include credentials.');
  }
  if (url.search || url.hash) throw new Error('Backend URL must not include a query or fragment.');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function backendPermissionOrigin(backendUrl) {
  return `${new URL(normalizeBackendUrl(backendUrl)).origin}/*`;
}

export function createDictionaryApi(backendUrl, fetchImplementation = fetch) {
  const baseUrl = normalizeBackendUrl(backendUrl);

  async function request(path, init = {}) {
    let response;
    try {
      response = await fetchImplementation(`${baseUrl}${path}`, init);
    } catch {
      throw new Error(`Cannot reach mdx-vocabulary at ${baseUrl}.`);
    }
    if (!response.ok) {
      let message;
      try {
        message = (await response.json())?.error?.message;
      } catch {
        // Use the status fallback below.
      }
      throw new Error(message || `Backend request failed (${response.status}).`);
    }
    return response.json();
  }

  return {
    async lookup(word) {
      const { items: dictionaries } = await request('/api/dictionaries');
      for (const dictionary of dictionaries) {
        const parameters = new URLSearchParams({ q: word, mode: 'exact', limit: '1', offset: '0' });
        const { items } = await request(`/api/dictionaries/${encodeURIComponent(dictionary.id)}/search?${parameters}`);
        if (items.length > 0) {
          const entry = await request(`/api/entries/${encodeURIComponent(items[0].id)}`);
          return { entry, dictionary: { id: dictionary.id, name: dictionary.name } };
        }
      }
      return null;
    },

    addVocabulary(entryId) {
      return request('/api/vocabulary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entryId }),
      });
    },
  };
}
