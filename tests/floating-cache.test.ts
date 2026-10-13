import { afterEach, expect, it, vi } from 'vitest';
import { mountFloating } from '../src/floating';
import type { Conversation, ExportJob } from '../src/types';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it.each([false, true])('does not cache an older response as current after page changes (joining=%s)', async joining => {
  vi.useFakeTimers();
  document.body.innerHTML = '<main><div data-message-author-role="user">Original</div></main>';
  const data: Conversation = { title: 'Test', url: location.href, exportedAt: '', warnings: [], messages: [{ id: 'u', stable: true, role: 'user', html: '', markdown: 'Original' }] };
  let job: ExportJob = { ok: true, state: joining ? 'running' : 'idle' }; let preparations = 0;
  vi.stubGlobal('chrome', { runtime: { sendMessage: async (message: { type: string }) => message.type === 'DOWNLOAD' ? { ok: true, id: 7 } : { ok: true, state: 'complete' } }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } } });
  const bridge = (type: string) => {
    if (type === 'CK_STATUS') return job;
    if (type === 'CK_INFO') return { ok: true, data: { generating: false } };
    if (type === 'CK_PREPARE') { preparations++; job = { ok: true, state: 'running' }; }
    return { ok: true };
  };
  mountFloating(bridge);
  const root = document.querySelector('#chatkeeper-widget')!.shadowRoot!;
  root.getElementById('launcher')!.click();
  if (joining) document.querySelector('main')!.insertAdjacentHTML('beforeend', '<div data-message-author-role="user">New question</div>');
  root.getElementById('download')!.click();
  if (!joining) document.querySelector('main')!.insertAdjacentHTML('beforeend', '<div data-message-author-role="user">New question</div>');
  job = { ok: true, state: 'done', data };
  await vi.advanceTimersByTimeAsync(200);
  root.getElementById('download')!.click();
  expect(preparations).toBe(joining ? 1 : 2);
});
