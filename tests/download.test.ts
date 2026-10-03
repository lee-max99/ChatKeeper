import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); });
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
