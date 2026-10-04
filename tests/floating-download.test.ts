import { afterEach, expect, it, vi } from 'vitest';
import { mountFloatingDownload } from '../src/floating-download';
import type { ExportJob } from '../src/types';

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('lets a download join an automatic outline read and saves once without preparing a second copy', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<select id="download-format"><option value="md">Markdown</option><option value="html">HTML</option></select><button id="download"></button><button id="read-outline"></button><div><span id="download-status"></span><button id="download-cancel"></button></div>';
  const send = vi.fn(async (_message: object) => ({ ok: true }));
  vi.stubGlobal('chrome', { runtime: { sendMessage: send }, storage: { local: { get: async () => ({}), set: async () => {} } } });
  let job: ExportJob = { ok: true, state: 'idle' }; let preparations = 0;
  const bridge = (type: string) => {
    if (type === 'CK_INFO') return { ok: true, data: { generating: false } };
    if (type === 'CK_STATUS') return job;
    if (type === 'CK_PREPARE') { preparations++; job = { ok: true, state: 'running' }; }
    return { ok: true };
  };
  const ready = vi.fn(); const controls = mountFloatingDownload(root, bridge, ready, () => {});
  controls.start('outline');
  expect((root.getElementById('download') as HTMLButtonElement).disabled).toBe(false);
  (root.getElementById('download-format') as HTMLSelectElement).value = 'html';
  controls.start('download');
  job = { ok: true, state: 'done', data: { title: '当前会话', url: location.href, exportedAt: '', warnings: [], messages: [{ id: 'u', stable: true, role: 'user', html: '', markdown: '完整保存记录' }] } };
  await vi.advanceTimersByTimeAsync(200);
  expect(preparations).toBe(1); expect(ready).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0]).toMatchObject({ type: 'DOWNLOAD', format: 'html', content: expect.stringContaining('完整保存记录') });
  controls.reset();
});

it.each(['throw', 'reject'])('explains an invalidated extension context during download (%s) and allows retry after reconnecting', async mode => {
  vi.useFakeTimers();
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<select id="download-format"><option value="md">Markdown</option></select><button id="download"></button><button id="read-outline"></button><div><span id="download-status"></span><button id="download-cancel"></button></div>';
  const send = vi.fn((): Promise<{ ok: boolean }> => { if (mode === 'throw') throw new Error('Extension context invalidated.'); return Promise.reject(new Error('Extension context invalidated.')); });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send }, storage: { local: { get: async () => ({}), set: async () => {} } } });
  const data = { title: '当前会话', url: location.href, exportedAt: '', warnings: [], messages: [{ id: 'u', stable: true, role: 'user' as const, html: '', markdown: '完整保存记录' }] };
  const bridge = (type: string) => type === 'CK_INFO' ? { ok: true, data: { generating: false } } : type === 'CK_STATUS' ? { ok: true, state: 'done', data } : { ok: true };
  const controls = mountFloatingDownload(root, bridge, () => {}, () => {});
  controls.start('download'); await vi.advanceTimersByTimeAsync(0);
  expect(root.getElementById('download-status')!.textContent).toBe('扩展连接已失效，请刷新 ChatGPT 页面后再下载。');
  expect(controls.busy).toBe(false);
  send.mockImplementation(async () => ({ ok: true }));
  controls.start('download'); await vi.advanceTimersByTimeAsync(0);
  expect(root.getElementById('download-status')!.textContent).toBe('下载已开始');
  controls.reset();
});
