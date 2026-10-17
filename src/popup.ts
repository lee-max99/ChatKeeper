import './popup.css';
import { assertChatGPT } from './collector';
import { renderHtml, renderMarkdown, safeFilename } from './exporters';
import { saveDownload,downloadSummary } from './download-client';
import type { ExportJob, PageInfo } from './types';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = element<HTMLInputElement>('title');
const save = element<HTMLButtonElement>('export');
const refresh = element<HTMLButtonElement>('refresh');
const cancel = element<HTMLButtonElement>('cancel');
const status = element('status');
const floatingEnabled = element<HTMLInputElement>('floating-enabled');
let tabId: number | undefined;
let info: PageInfo | undefined;
let busy = false;
let downloadWhenReady = false;
let polling: ReturnType<typeof setTimeout> | undefined;
let phase = '读取记录…';

function format(): 'md' | 'html' { return document.querySelector<HTMLInputElement>('input[name="format"]:checked')?.value === 'html' ? 'html' : 'md'; }
function setStatus(message: string, error = false): void { status.textContent = message; status.className = error ? 'error' : busy ? 'busy' : ''; status.parentElement!.hidden = !message; }
function setBusy(value: boolean, cancellable = false): void {
  busy = value; save.disabled = value || !info || info.generating; refresh.disabled = value;
  title.disabled = value || !info; cancel.hidden = !cancellable; cancel.disabled = false;
  element('progress').hidden = !value;
  document.querySelectorAll<HTMLInputElement>('input[name="format"]').forEach(input => { input.disabled = value; });
  save.textContent = value ? phase : '导出全部';
}
async function request<T>(type: string): Promise<T> {
  const result = await chrome.tabs.sendMessage(tabId!, { type });
  if (!result?.ok) throw new Error(result?.error || '连接已断开，请刷新 ChatGPT 页面后重试。');
  return result;
}
function fail(error: unknown): void {
  clearTimeout(polling); downloadWhenReady = false; setBusy(false);
  setStatus(error instanceof Error ? error.message : '导出失败，请重试。', true);
}
async function poll(): Promise<void> {
  try {
    const job = await request<ExportJob>('CK_STATUS');
    if (job.state === 'running') {
      phase = '读取记录…';setBusy(true, true); setStatus('正在读取聊天记录…');
      polling = setTimeout(() => void poll(), 250); return;
    }
    if (job.state === 'error') throw new Error(job.error || '读取失败，请重试。');
    if (job.state !== 'done' || !job.data) { setBusy(false); setStatus(''); return; }
    element('count').textContent = `${job.data.messages.length} 条消息`;
    if (!downloadWhenReady) { setBusy(false); setStatus('对话已准备好'); return; }
    downloadWhenReady = false;
    await request('CK_CHECK');
    phase = '生成文件…';setBusy(true); setStatus('正在生成导出文件…');
    let data = { ...job.data, title: title.value.trim() || job.data.title, exportedAt: new Date().toISOString() };
    if (data.messages.some(message => message.images?.length)) {
      phase = '保存图片…';setBusy(true,true); setStatus('正在保存聊天图片…');
      const result = await chrome.tabs.sendMessage(tabId!, {type:'CK_IMAGES',ids:data.messages.map(message => message.id)});
      if (!result?.ok || !result.data) throw new Error(result?.error || '图片读取失败，请重试。');
      data = {...data,messages:result.data.messages,warnings:result.data.warnings};
    }
    phase = '生成文件…';setBusy(true);setStatus('正在生成导出文件…');
    const selected = format();
    const content = selected === 'md' ? renderMarkdown(data) : renderHtml(data);
    // Recheck after conversion as a long document may take time to format.
    await request('CK_CHECK');
    phase = '等待保存…';setBusy(true);
    const result = await saveDownload({ type: 'DOWNLOAD', format: selected,
      filename: safeFilename(`${data.title}_${new Date().toLocaleDateString('sv-SE')}`, selected), content,
    }, setStatus);
    setBusy(false); setStatus(downloadSummary(result,data));
  } catch (error) { fail(error); }
}
async function startExport(): Promise<void> {
  if (busy || !info) return;
  downloadWhenReady = true;phase = '读取记录…'; setBusy(true, true); setStatus('正在读取聊天记录…');
  try { await request('CK_PREPARE'); await poll(); } catch (error) { fail(error); }
}
async function initialize(): Promise<void> {
  clearTimeout(polling);phase = '读取记录…';setBusy(true); setStatus('正在读取对话信息…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) throw new Error('请在 ChatGPT 对话页打开 ChatKeeper。');
    assertChatGPT(tab.url); tabId = tab.id;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    info = (await request<{ data: PageInfo }>('CK_INFO')).data;
    title.value = info.title; element('source').textContent = `chatgpt.com${new URL(info.url).pathname}`;
    element('count').textContent = '当前对话';
    if (info.generating) { setBusy(false); setStatus('回答还在生成，结束后点击刷新。'); return; }
    const job = await request<ExportJob>('CK_STATUS');
    if (job.state === 'running' || job.state === 'done') { await poll(); return; }
    setBusy(false); setStatus(job.state === 'error' ? job.error || '上次导出未完成，可以重试。' : '', job.state === 'error');
  } catch (error) { info = undefined; fail(error); }
}
refresh.addEventListener('click', () => { if (!busy) void initialize(); });
save.addEventListener('click', () => void startExport());
cancel.addEventListener('click', () => {
  downloadWhenReady = false; cancel.disabled = true; setStatus('正在取消…');
  void request('CK_CANCEL').catch(fail);
});
document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change', () => { setBusy(false); void chrome.storage.local.set({ floatingFormat: format() }); }));
floatingEnabled.addEventListener('change', () => {
  void chrome.storage.local.set({ floatingEnabled: floatingEnabled.checked }).catch(fail);
});
void chrome.storage.local.get(['floatingEnabled', 'floatingFormat']).then(values => {
  floatingEnabled.checked = values.floatingEnabled !== false;
  document.querySelector<HTMLInputElement>(`input[value="${values.floatingFormat === 'html' ? 'html' : 'md'}"]`)!.checked = true;
}).catch(fail);
void initialize();
