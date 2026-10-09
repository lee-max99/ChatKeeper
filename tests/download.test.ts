import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); });

it.each([
  { state: 'interrupted', error: 'USER_CANCELED', expected: /取消|阻止/ },
  { state: 'interrupted', error: 'FILE_NO_SPACE', expected: /空间/ },
  { state: 'complete', exists: false, expected: /移除/ },
])('reports the actual browser failure after a download ID was returned: $error', async item => {
  vi.resetModules(); let listener: any;
  vi.stubGlobal('chrome', {
    runtime: { id: 'keeper', getURL: (path: string) => `chrome-extension://keeper/${path}`, onMessage: { addListener: (fn: any) => { listener = fn; } } },
    downloads: { download: async () => 7, search: async () => [{ id: 7, byExtensionId: 'keeper', ...item }] },
  });
  await import('../src/background');
  const response = await new Promise<any>(resolve => { if (!listener({ type: 'DOWNLOAD_STATUS', id: 7 }, { id: 'keeper', url: 'chrome-extension://keeper/popup.html' }, resolve)) resolve(undefined); });
  expect(response?.ok).toBe(false); expect(response?.error).toMatch(item.expected);
});

it('does not acknowledge success if the browser returns no download ID', async () => {
  vi.resetModules(); let listener: any;
  vi.stubGlobal('chrome', {
    runtime: { id: 'keeper', getURL: (path: string) => `chrome-extension://keeper/${path}`, onMessage: { addListener: (fn: any) => { listener = fn; } } },
    downloads: { download: async () => undefined },
  });
  await import('../src/background');
  const response = await new Promise<any>(resolve => listener({ type: 'DOWNLOAD', content: '记录', format: 'md', filename: '会话.md' }, { id: 'keeper', url: 'chrome-extension://keeper/popup.html' }, resolve));
  expect(response.ok).toBe(false); expect(response.error).toMatch(/未创建/);
});

it('does not expose download records owned by another extension', async () => {
  vi.resetModules(); let listener: any;
  vi.stubGlobal('chrome', {
    runtime: { id: 'keeper', getURL: (path: string) => `chrome-extension://keeper/${path}`, onMessage: { addListener: (fn: any) => { listener = fn; } } },
    downloads: { search: async () => [{ id: 7, byExtensionId: 'another', filename: 'private-file.txt', state: 'complete' }] },
  });
  await import('../src/background');
  const response = await new Promise<any>(resolve => { if (!listener({ type: 'DOWNLOAD_STATUS', id: 7 }, { id: 'keeper', url: 'chrome-extension://keeper/popup.html' }, resolve)) resolve(undefined); });
  expect(response?.ok).toBe(false); expect(JSON.stringify(response)).not.toContain('private-file');
});
it('accepts the floating page export and rejects other sites, frames and extensions', async () => {
  vi.resetModules();
  let listener: any;
  const saved: Array<{ filename: string; url: string }> = [];
  vi.stubGlobal('chrome', {
    runtime: { id: 'keeper', getURL: (path: string) => `chrome-extension://keeper/${path}`, onMessage: { addListener: (fn: any) => { listener = fn; } } },
    downloads: { download: async (options: { filename: string; url: string }) => { saved.push(options); return 1; } },
  });
  await import('../src/background');
  const payload = { type: 'DOWNLOAD', filename: '会话.md', format: 'md', content: '当前会话内容' };
  const send = (sender: object, message = payload) => new Promise<any>(resolve => listener(message, sender, resolve));
  expect((await send({ id: 'keeper', tab: { id: 0 }, frameId: 0, url: 'https://chatgpt.com/c/current' })).ok).toBe(true);
  expect(decodeURIComponent(saved[0].url)).toContain('当前会话内容');
  for (const sender of [
    { id: 'keeper', tab: { id: 1 }, frameId: 0, url: 'https://chatgpt.com.evil.test/c/a' },
    { id: 'keeper', tab: { id: 1 }, frameId: 1, url: 'https://chatgpt.com/c/a' },
    { id: 'other', tab: { id: 1 }, frameId: 0, url: 'https://chatgpt.com/c/a' },
    { id: 'keeper', url: 'https://chatgpt.com/c/a' },
  ]) expect((await send(sender)).ok).toBe(false);
  expect((await send({ id: 'keeper', url: 'chrome-extension://keeper/popup.html' }, { ...payload, filename: '../会话.md' })).ok).toBe(false);
  expect(saved).toHaveLength(1);
});
