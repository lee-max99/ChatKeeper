import { afterEach, expect, it, vi } from 'vitest';
import { mountFloatingDownload } from '../src/floating-download';
import type { ExportJob } from '../src/types';
import { selectQuestionGroups } from '../src/conversation-selection';

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('waits for browser confirmation and reports an interruption instead of claiming a download started', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<select id="download-format"><option value="md">Markdown</option></select><button id="download"></button><button id="read-outline"></button><div><span id="download-status"></span><button id="download-cancel"></button></div>';
  let searches = 0;
  const send = vi.fn(async (message: { type: string }) => message.type === 'DOWNLOAD' ? { ok: true, id: 7 } : ++searches === 1 ?
    { ok: true, state: 'in_progress' } : { ok: false, error: '保存已取消或被浏览器阻止，文件未保存。' });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send }, storage: { local: { get: async () => ({}), set: async () => {} } } });
  const data = { title: '当前会话', url: location.href, exportedAt: '', warnings: [], messages: [{ id: 'u', stable: true, role: 'user' as const, html: '', markdown: '保存记录' }] };
  const bridge = (type: string) => type === 'CK_INFO' ? { ok: true, data: { generating: false } } : type === 'CK_STATUS' ? { ok: true, state: 'done', data } : { ok: true };
  const controls = mountFloatingDownload(root, bridge, () => {}, () => {});
  controls.start('download'); await vi.advanceTimersByTimeAsync(0);
  expect(root.getElementById('download-status')!.textContent).not.toContain('下载已开始');
  expect(controls.busy).toBe(true);
  await vi.advanceTimersByTimeAsync(500);
  expect(root.getElementById('download-status')!.textContent).toContain('文件未保存');
  expect(controls.busy).toBe(false); controls.reset();
});

it('does not start a file when a selected question disappears from the fresh saved path', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<select id="download-format"><option value="md">Markdown</option></select><button id="download"></button><button id="read-outline"></button><div><span id="download-status"></span><button id="download-cancel"></button></div>';
  const send = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('chrome', { runtime: { sendMessage: send }, storage: { local: { get: async () => ({}), set: async () => {} } } });
  const old = { id: 'old', stable: true, role: 'user' as const, html: '', markdown: '原来所选的提问' };
  const data = { title: '当前会话', url: location.href, exportedAt: '', warnings: [], messages: [{ ...old, id: 'new', markdown: '另一路径的提问' }] };
  const bridge = (type: string) => type === 'CK_INFO' ? { ok: true, data: { generating: false } } : type === 'CK_STATUS' ? { ok: true, state: 'done', data } : { ok: true };
  const controls = mountFloatingDownload(root, bridge, () => {}, () => {}, { prepareExport: () => fresh => selectQuestionGroups(fresh, [old]) });
  controls.start('download'); await vi.advanceTimersByTimeAsync(0);
  expect(send).not.toHaveBeenCalled(); expect(controls.busy).toBe(false);
  expect(root.getElementById('download-status')!.textContent).toContain('所选提问已变化');
  controls.reset();
});

it.each(['md', 'html'])('snapshots the selection before an outline read completes and exports only those Q&A groups (%s)', async format => {
  vi.useFakeTimers();
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<select id="download-format"><option value="md">Markdown</option><option value="html">HTML</option></select><button id="download"></button><button id="read-outline"></button><div><span id="download-status"></span><button id="download-cancel"></button></div>';
  const send = vi.fn(async (_message: object) => ({ ok: true, id: 7, state: 'complete', filename: '会话.md' }));
  vi.stubGlobal('chrome', { runtime: { sendMessage: send }, storage: { local: { get: async () => ({}), set: async () => {} } } });
  const first = { id: 'u1', stable: true, role: 'user' as const, html: '', markdown: '所选提问' };
  const second = { ...first, id: 'u2', markdown: '未选提问' };
  const data = { title: '当前会话', url: location.href, exportedAt: '', warnings: [], messages: [first, { ...first, id: 'a1', role: 'assistant' as const, markdown: '所选回答' }, second] };
  let choices = [first]; let job: ExportJob = { ok: true, state: 'running' };
  const bridge = (type: string) => type === 'CK_INFO' ? { ok: true, data: { generating: false } } : type === 'CK_STATUS' ? job : { ok: true };
  const controls = mountFloatingDownload(root, bridge, () => { choices = [second]; }, () => {}, {
    prepareExport: () => { const snapshot = choices.map(item => ({ ...item })); return fresh => selectQuestionGroups(fresh, snapshot); },
  });
  controls.start('outline'); (root.getElementById('download-format') as HTMLSelectElement).value = format;
  controls.start('download'); job = { ok: true, state: 'done', data }; await vi.advanceTimersByTimeAsync(200);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('所选提问') });
  expect(send.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('所选回答') });
  expect((send.mock.calls[0][0] as { content: string }).content).not.toContain('未选提问');
  controls.reset();
});

it('lets a download join an automatic outline read and saves once without preparing a second copy', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<select id="download-format"><option value="md">Markdown</option><option value="html">HTML</option></select><button id="download"></button><button id="read-outline"></button><div><span id="download-status"></span><button id="download-cancel"></button></div>';
  const send = vi.fn(async (_message: object) => ({ ok: true, id: 7, state: 'complete', filename: '会话.md' }));
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
  expect(preparations).toBe(1); expect(ready).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledTimes(2);
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
  send.mockImplementation(async () => ({ ok: true, id: 7, state: 'complete', filename: '会话.md' }));
  controls.start('download'); await vi.advanceTimersByTimeAsync(0);
  expect(root.getElementById('download-status')!.textContent).toBe('已保存：会话.md');
  controls.reset();
});
