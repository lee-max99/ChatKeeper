chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request?.type !== 'DOWNLOAD') return false;
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) {
    respond({ ok: false, error: '无效的下载来源。' }); return false;
  }
  if (typeof request.content !== 'string' || !request.content.trim() || request.content.length > 10_000_000 ||
      typeof request.filename !== 'string' || /[\\/\x00-\x1f]/.test(request.filename) ||
      !['md', 'html'].includes(request.format) || !request.filename.endsWith(`.${request.format}`)) {
    respond({ ok: false, error: '导出文件无效或过大（上限 1000 万字符）。' }); return false;
  }
  const mime = request.format === 'md' ? 'text/markdown' : 'text/html';
  chrome.downloads.download({
    url: `data:${mime};charset=utf-8,${encodeURIComponent(request.content)}`,
    filename: request.filename, saveAs: true, conflictAction: 'uniquify',
  }).then(id => respond({ ok: true, id }), error => respond({ ok: false, error: `下载未开始：${String(error.message || error)}` }));
  return true;
});
