import { backendPermissionOrigin, DEFAULT_BACKEND_URL, normalizeBackendUrl } from './api-client.js';

const form = document.querySelector('#settings-form');
const input = document.querySelector('#backend-url');
const status = document.querySelector('#status');

const stored = await chrome.storage.sync.get('backendUrl');
input.value = stored.backendUrl || DEFAULT_BACKEND_URL;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  try {
    const backendUrl = normalizeBackendUrl(input.value);
    const granted = await chrome.permissions.request({ origins: [backendPermissionOrigin(backendUrl)] });
    if (!granted) throw new Error('未授予该后端地址的访问权限。');
    await chrome.storage.sync.set({ backendUrl });
    input.value = backendUrl;
    status.textContent = '设置已保存。';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '保存失败。';
  }
});
