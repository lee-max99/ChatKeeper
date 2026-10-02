import { readConversation } from './conversation-api';
import { pageInfo, validatePage } from './page-info';
import type { ExportJob } from './types';

const state = window as Window & { __chatKeeperReaderV3?: boolean };
if (!state.__chatKeeperReaderV3) {
  state.__chatKeeperReaderV3 = true;
  let controller: AbortController | undefined;
  let job: ExportJob = { ok: true, state: 'idle' };
  let jobUrl = '';
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['CK_INFO', 'CK_PREPARE', 'CK_STATUS', 'CK_CANCEL', 'CK_CHECK'].includes(request?.type)) return false;
    if (request.type === 'CK_CANCEL') { controller?.abort(); respond({ ok: true }); return false; }
    if (request.type === 'CK_STATUS') {
      if (jobUrl && jobUrl !== location.href) { controller?.abort(); job = { ok: true, state: 'error', error: '对话已切换，请重新打开 ChatKeeper。' }; }
      respond(job); return false;
    }
    try {
      const info = pageInfo(document, location.href);
      if (request.type === 'CK_INFO') { respond({ ok: true, data: info }); return false; }
      if (info.generating) throw new Error('回答还在生成，请等待结束后重试。');
      if (request.type === 'CK_CHECK') {
        if (!job.data) throw new Error('文件尚未准备好，请重试。');
        validatePage(job.data, info); respond({ ok: true }); return false;
      }
      if (controller) throw new Error('正在准备文件，请稍候。');
      controller = new AbortController(); const signal = controller.signal;
      job = { ok: true, state: 'running' }; jobUrl = info.url;
      void readConversation(info.url, info.visibleIds, signal).then(data => {
        if (signal.aborted) throw new Error('导出已取消。');
        validatePage(data, pageInfo(document, location.href));
        job = { ok: true, state: 'done', data };
      }).catch(error => {
        job = { ok: true, state: 'error', error: error instanceof Error ? error.message : '读取对话失败，请重试。' };
      }).finally(() => { controller = undefined; });
      respond({ ok: true });
    } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    return false;
  });
}
