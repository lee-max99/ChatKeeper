import { renderHtml, renderMarkdown, safeFilename } from './exporters';
import type { Conversation, ExportJob, PageInfo } from './types';

function errorText(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : fallback;
  return /extension context invalidated/i.test(text) ? '扩展连接已失效，请刷新 ChatGPT 页面后再下载。' : text;
}

export function mountFloatingDownload(root: ShadowRoot, bridge: (type: string) => unknown, ready: (data: Conversation) => void, resized: () => void,
  lifecycle: { started?: (purpose: 'outline' | 'download') => void; failed?: (error: unknown) => void } = {}) {
  const button = root.getElementById('download') as HTMLButtonElement;
  const format = root.getElementById('download-format') as HTMLSelectElement;
  const read = root.getElementById('read-outline') as HTMLButtonElement;
  const cancel = root.getElementById('download-cancel') as HTMLButtonElement;
  const status = root.getElementById('download-status')!;
  let busy = false; let run = 0; let timer: ReturnType<typeof setTimeout> | undefined;
  let operation: 'outline' | 'download' | undefined;
  const request = <T>(type: string): T => {
    const result = bridge(type) as T & { ok: boolean; error?: string };
    if (!result?.ok) throw new Error(result?.error || '连接已断开，请刷新页面。');
    return result;
  };
  function message(text: string, error = false): void {
    status.textContent = text; status.className = error ? 'error' : '';
    status.parentElement!.hidden = !text && !busy; resized();
  }
  function setBusy(value: boolean): void {
    busy = value; button.disabled = value && operation === 'download'; format.disabled = value && operation === 'download'; read.disabled = value;
    button.textContent = value && operation === 'download' ? '准备中…' : '下载'; button.setAttribute('aria-busy', String(value && operation === 'download'));
    cancel.hidden = !value; cancel.disabled = false;
  }
  async function poll(token: number, url: string): Promise<void> {
    if (token !== run || location.href !== url) return;
    try {
      const job = request<ExportJob>('CK_STATUS');
      if (job.state === 'running') { timer = setTimeout(() => void poll(token, url), 200); return; }
      if (job.state === 'error') throw new Error(job.error || '读取失败，请重试。');
      if (job.state !== 'done' || !job.data) throw new Error('记录尚未准备好，请重试。');
      request('CK_CHECK'); ready(job.data);
      if (operation === 'outline') { setBusy(false); message(''); return; }
      const selected = format.value === 'html' ? 'html' : 'md';
      const data = { ...job.data, exportedAt: new Date().toISOString() };
      const content = selected === 'html' ? renderHtml(data) : renderMarkdown(data);
      request('CK_CHECK');
      if (token !== run || location.href !== url) return;
      cancel.hidden = true;
      const result = await chrome.runtime.sendMessage({ type: 'DOWNLOAD', format: selected,
        filename: safeFilename(`${data.title}_${new Date().toLocaleDateString('sv-SE')}`, selected), content });
      if (token !== run || location.href !== url) return;
      if (!result?.ok) throw new Error(result?.error || '下载未开始，请重试。');
      setBusy(false); message('下载已开始');
    } catch (error) {
      if (token !== run || location.href !== url) return;
      setBusy(false); lifecycle.failed?.(error); message(errorText(error, '导出失败，请重试。'), true);
    }
  }
  function start(purpose: 'outline' | 'download'): void {
    if (busy) {
      if (purpose === 'download' && operation === 'outline') {
        operation = 'download'; setBusy(true); message('正在准备完整记录…');
      }
      return;
    }
    const token = ++run; const url = location.href;
    operation = purpose;
    setBusy(true); message(purpose === 'outline' ? '正在读取目录…' : '正在准备完整记录…');
    try {
      const info = request<{ data: PageInfo }>('CK_INFO').data;
      if (info.generating) throw new Error('回答还在生成，请等待结束后重试。');
      const job = request<ExportJob>('CK_STATUS');
      lifecycle.started?.(purpose);
      if (job.state !== 'running') request('CK_PREPARE');
      void poll(token, url);
    } catch (error) {
      setBusy(false); lifecycle.failed?.(error); message(errorText(error, '读取失败，请重试。'), true);
    }
  }
  button.addEventListener('click', () => start('download'));
  read.addEventListener('click', () => start('outline'));
  cancel.addEventListener('click', () => { bridge('CK_CANCEL'); cancel.disabled = true; message('正在取消…'); });
  format.addEventListener('change', () => { void chrome.storage.local.set({ floatingFormat: format.value }); });
  void chrome.storage.local.get('floatingFormat').then(values => { if (!busy) format.value = values.floatingFormat === 'html' ? 'html' : 'md'; }).catch(() => {});
  return {
    start, message, get busy() { return busy; },
    reset() { run++; clearTimeout(timer); operation = undefined; setBusy(false); message(''); },
  };
}
