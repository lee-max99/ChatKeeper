type DownloadRequest = { type: 'DOWNLOAD'; format: 'md' | 'html'; filename: string; content: string };

// A download ID only acknowledges creation. Confirm its final browser state before reporting success.
export async function saveDownload(payload: DownloadRequest, progress: (message: string) => void, current: () => boolean = () => true): Promise<string> {
  progress('等待浏览器保存…');
  const created = await chrome.runtime.sendMessage(payload);
  if (!current()) return '';
  if (!created?.ok) throw new Error(created?.error || '浏览器未创建下载任务，请重试。');
  if (!Number.isInteger(created.id) || created.id < 0) throw new Error('浏览器未返回有效下载任务，无法确认文件已保存。');
  const deadline = Date.now() + 120_000;
  while (current()) {
    const result = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_STATUS', id: created.id });
    if (!current()) return '';
    if (!result?.ok) throw new Error(result?.error || '无法确认文件是否保存，请按 Ctrl+J 查看下载列表。');
    if (result.state === 'complete') return `已保存：${result.filename || payload.filename}`;
    if (result.state !== 'in_progress') throw new Error('下载状态异常，无法确认文件已保存。请按 Ctrl+J 查看。');
    if (Date.now() >= deadline) return '浏览器尚未确认保存完成，请按 Ctrl+J 查看下载状态。';
    progress(result.message || '正在等待浏览器保存…若未弹出窗口，请按 Ctrl+J 查看。');
    await new Promise<void>(resolve => setTimeout(resolve, 500));
  }
  return '';
}
