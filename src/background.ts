chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (!['DOWNLOAD', 'DOWNLOAD_STATUS'].includes(request?.type)) return false;
  let fromPage = false;
  try { const url = new URL(sender.url || ''); fromPage = sender.tab?.id !== undefined && sender.frameId === 0 && url.origin === 'https://chatgpt.com'; } catch { /* Reject invalid origins. */ }
  if (sender.id !== chrome.runtime.id || (sender.url !== chrome.runtime.getURL('popup.html') && !fromPage)) {
    respond({ ok: false, error: '无效的下载来源。' }); return false;
  }
  if (request.type === 'DOWNLOAD_STATUS') {
    if (!Number.isInteger(request.id) || request.id < 0) { respond({ ok: false, error: '无效的下载任务。' }); return false; }
    void chrome.downloads.search({ id: request.id }).then(([item]) => {
      if (!item || item.byExtensionId !== chrome.runtime.id) { respond({ ok: false, error: '未找到本次下载记录，无法确认文件已保存。请按 Ctrl+J 查看下载列表。' }); return; }
      if (item.state === 'interrupted') { respond({ ok: false, error: interruption(item.error) }); return; }
      if (item.state === 'complete' && item.exists === false) { respond({ ok: false, error: '下载记录显示文件已被移除，请重新导出。' }); return; }
      const review = item.danger && !['safe', 'accepted', 'allowlistedByPolicy', 'deepScannedSafe'].includes(item.danger);
      respond({ ok: true, state: item.state, filename: item.filename.split(/[\\/]/).pop(),
        message: item.paused ? '下载已暂停，请按 Ctrl+J 查看并继续。' : review ? '浏览器正在检查或等待处理此文件，请按 Ctrl+J 查看。' : '正在等待浏览器保存…若未弹出窗口，请按 Ctrl+J 查看。' });
    }, error => respond({ ok: false, error: `无法确认保存结果：${String(error?.message || error)}。请按 Ctrl+J 查看下载列表。` }));
    return true;
  }
  if (typeof request.content !== 'string' || !request.content.trim() || request.content.length > 10_000_000 ||
      typeof request.filename !== 'string' || /[\\/\x00-\x1f]/.test(request.filename) ||
      !['md', 'html'].includes(request.format) || !request.filename.endsWith(`.${request.format}`)) {
    respond({ ok: false, error: '导出文件无效或过大（上限 1000 万字符）。' }); return false;
  }
  const mime = request.format === 'md' ? 'text/markdown' : 'text/html';
  void Promise.resolve().then(() => chrome.downloads.download({
    url: `data:${mime};charset=utf-8,${encodeURIComponent(request.content)}`,
    filename: request.filename, saveAs: true, conflictAction: 'uniquify',
  })).then(id => {
    if (!Number.isInteger(id) || id < 0) { respond({ ok: false, error: '浏览器未创建下载任务，请刷新页面后重试。' }); return; }
    respond({ ok: true, id });
  }, error => respond({ ok: false, error: `下载未开始：${String(error?.message || error)}` }));
  return true;
});

export {};

function interruption(reason?: string): string {
  const descriptions: Record<string, string> = {
    USER_CANCELED: '保存已取消或被浏览器阻止，文件未保存。',
    FILE_ACCESS_DENIED: '浏览器没有权限写入所选文件夹，请换一个保存位置。',
    FILE_NO_SPACE: '保存位置的可用空间不足，请清理空间或换一个位置。',
    FILE_NAME_TOO_LONG: '文件名或保存路径过长，请缩短标题或更换保存位置。',
    FILE_BLOCKED: '浏览器或系统阻止了文件保存。',
    FILE_VIRUS_INFECTED: '安全检查阻止了文件保存。',
    FILE_FAILED: '文件写入失败，请检查保存位置后重试。',
    FILE_TRANSIENT_ERROR: '文件暂时无法写入，请稍后重试。',
    USER_SHUTDOWN: '浏览器关闭导致保存中断。',
    CRASH: '浏览器异常导致保存中断。',
  };
  return `${descriptions[reason || ''] || '下载已中断，文件未保存。'} 请按 Ctrl+J 查看下载记录。${reason ? `（${reason}）` : ''}`;
}
