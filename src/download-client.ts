import type {Conversation} from './types';
type DownloadRequest = { type: 'DOWNLOAD'; format: 'md' | 'html'; filename: string; content: string };
const unconfirmed = '保存结果待确认，请按 Ctrl+J 查看下载列表，确认后再决定是否重试。';
export function downloadSummary(result:string,data:Conversation):string {
  const missing = data.warnings.map(warning => warning.match(/(\d+) 张图片未能保存/)).find(Boolean)?.[1];
  return result.startsWith('已保存：') && missing ? `${result}；${missing} 张图片未保存，详情见导出文件。` : result;
}

// A download ID only acknowledges creation. Confirm its final browser state before reporting success.
export async function saveDownload(payload: DownloadRequest, progress: (message: string) => void, current: () => boolean = () => true): Promise<string> {
  progress('等待浏览器保存…');
  let created;
  try {created = await chrome.runtime.sendMessage(payload);}
  catch (error) {
    if (/extension context invalidated/i.test(String(error))) throw error;
    if (/receiving end does not exist/i.test(String(error))) throw new Error('扩展连接已断开，请重新加载扩展并刷新 ChatGPT 页面后重试。');
    return current() ? unconfirmed : '';
  }
  if (!current()) return '';
  if (!created?.ok) throw new Error(created?.error || '浏览器未创建下载任务，请重试。');
  if (!Number.isInteger(created.id) || created.id < 0) throw new Error('浏览器未返回有效下载任务，无法确认文件已保存。');
  const deadline = Date.now() + 120_000;
  while (current()) {
    let result;
    try {result = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_STATUS', id: created.id });}
    catch {return current() ? unconfirmed : '';}
    if (!current()) return '';
    if (!result || result.unconfirmed) return unconfirmed;
    if (!result.ok) throw new Error(result.error || '无法确认文件是否保存，请按 Ctrl+J 查看下载列表。');
    if (result.state === 'complete') return `已保存：${result.filename || payload.filename}`;
    if (result.state !== 'in_progress' || Date.now() >= deadline) return unconfirmed;
    progress(result.message || '正在等待浏览器保存…若未弹出窗口，请按 Ctrl+J 查看。');
    await new Promise<void>(resolve => setTimeout(resolve, 500));
  }
  return '';
}
