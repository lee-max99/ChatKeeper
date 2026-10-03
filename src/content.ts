import { readConversation } from './conversation-api';
import { pageInfo, validatePage } from './page-info';
import { mountFloating } from './floating';
import type { ExportJob } from './types';

const state = window as Window & { __chatKeeperReaderV3?: boolean };
if (!state.__chatKeeperReaderV3) {
  state.__chatKeeperReaderV3 = true;
  let controller: AbortController | undefined;
  let job: ExportJob = { ok: true, state: 'idle' };
  let jobUrl = '';
  const cancelPreparation = (error: string): void => {
    if (!controller) return;
    controller.abort(); controller = undefined;
    job = { ok: true, state: 'error', error };
  };
  const request = (type: string): unknown => {
    if (type === 'CK_CANCEL') { cancelPreparation('导出已取消。'); return { ok: true }; }
    if (type === 'CK_STATUS') {
      if (jobUrl && jobUrl !== location.href) {
        cancelPreparation('对话已切换，请重新打开 ChatKeeper。');
        job = { ok: true, state: 'error', error: '对话已切换，请重新打开 ChatKeeper。' };
      }
      return job;
    }
    try {
      const info = pageInfo(document, location.href);
      if (type === 'CK_INFO') return { ok: true, data: info };
      if (info.generating) throw new Error('回答还在生成，请等待结束后重试。');
      if (type === 'CK_CHECK') {
        if (!job.data) throw new Error('文件尚未准备好，请重试。');
        validatePage(job.data, info); return { ok: true };
      }
      if (controller) throw new Error('正在准备文件，请稍候。');
      controller = new AbortController(); const active = controller; const signal = active.signal;
      job = { ok: true, state: 'running' }; jobUrl = info.url;
      void readConversation(info.url, info.visibleIds, signal).then(data => {
        if (controller !== active) return;
        if (signal.aborted) throw new Error('导出已取消。');
        validatePage(data, pageInfo(document, location.href));
        job = { ok: true, state: 'done', data };
      }).catch(error => {
        if (controller !== active) return;
        job = { ok: true, state: 'error', error: error instanceof Error ? error.message : '读取对话失败，请重试。' };
      }).finally(() => { if (controller === active) controller = undefined; });
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['CK_INFO', 'CK_PREPARE', 'CK_STATUS', 'CK_CANCEL', 'CK_CHECK'].includes(message?.type)) return false;
    respond(request(message.type)); return false;
  });
  if (chrome.storage?.local) mountFloating(request);
}
