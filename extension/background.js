import { createDictionaryApi, DEFAULT_BACKEND_URL, normalizeBackendUrl } from './api-client.js';

async function configuredBackendUrl() {
  const { backendUrl = DEFAULT_BACKEND_URL } = await chrome.storage.sync.get('backendUrl');
  return normalizeBackendUrl(backendUrl);
}

async function requireHostPermission(backendUrl) {
  const origin = `${new URL(backendUrl).origin}/*`;
  if (!await chrome.permissions.contains({ origins: [origin] })) {
    throw new Error('Backend access is not allowed. Open the extension settings and grant access.');
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!['lookup', 'suggest', 'addVocabulary'].includes(message?.type)) return false;

  void (async () => {
    const backendUrl = await configuredBackendUrl();
    await requireHostPermission(backendUrl);
    const api = createDictionaryApi(backendUrl);
    if (message.type === 'lookup') return api.lookup(message.word);
    if (message.type === 'suggest') return api.suggest(message.prefix);
    return api.addVocabulary(message.entryId);
  })().then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unexpected extension error.' }),
  );
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
