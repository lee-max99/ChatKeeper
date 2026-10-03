import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete (window as any).__chatKeeperReaderV3; });
const payload = { title: '任务', current_node: 'one', mapping: { one: { id: 'one', parent: null, message: { id: 'one', author: { role: 'user' }, content: { parts: ['问题'] }, status: 'finished_successfully' } } } };

async function setup() {
  vi.resetModules();
  document.body.innerHTML = '<div data-message-author-role="user" data-message-id="one">问题</div>';
  let listener: any;
  vi.stubGlobal('chrome', { runtime: { id: 'test-extension', onMessage: { addListener(fn: any) { listener = fn; } } } });
  window.history.replaceState({}, '', '/c/one');
  await import('../src/content');
  return (type: string) => { let response: any; listener({ type }, { id: 'test-extension' }, (value: any) => { response = value; }); return response; };
}
it('keeps API preparation alive without a popup and reconnects without scrolling', async () => {
  const scroll = vi.spyOn(window, 'scrollTo');
  vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url.endsWith('/session') ? { accessToken: 'fixture-only' } : payload)));
  const request = await setup();
  expect(request('CK_PREPARE').ok).toBe(true);
  expect(request('CK_STATUS').state).toBe('running');
  await vi.waitFor(() => expect(request('CK_STATUS').state).toBe('done'));
  expect(request('CK_STATUS').data.messages[0].markdown).toBe('问题');
  expect(scroll).not.toHaveBeenCalled();
  expect(JSON.stringify(request('CK_STATUS'))).not.toContain('fixture-only');
  scroll.mockRestore();
});
it('cancels a pending request and never publishes a result after cancellation', async () => {
  vi.stubGlobal('fetch', (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const request = await setup();
  request('CK_PREPARE'); request('CK_CANCEL');
  await vi.waitFor(() => expect(request('CK_STATUS').state).toBe('error'));
  expect(request('CK_STATUS').error).toContain('取消');
  expect(request('CK_STATUS').data).toBeUndefined();
});
it('allows immediate preparation after cancellation without the old task overwriting or releasing the new task', async () => {
  let sessionCalls = 0;
  let finishSession!: (response: Response) => void;
  vi.stubGlobal('fetch', (url: string, options: RequestInit) => {
    if (!url.endsWith('/session')) return Promise.resolve(new Response(JSON.stringify(payload)));
    sessionCalls++;
    return new Promise<Response>((resolve, reject) => {
      if (sessionCalls === 1) options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      else finishSession = resolve;
    });
  });
  const request = await setup();
  expect(request('CK_PREPARE').ok).toBe(true);
  request('CK_CANCEL');
  window.history.replaceState({}, '', '/c/two');
  expect(request('CK_PREPARE').ok).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(request('CK_STATUS').state).toBe('running');
  expect(request('CK_PREPARE').ok).toBe(false);
  finishSession(new Response(JSON.stringify({ accessToken: 'fixture-only' })));
  await vi.waitFor(() => expect(request('CK_STATUS').state).toBe('done'));
  expect(request('CK_STATUS').data.url).toBe('https://chatgpt.com/c/two');
});
it('exports the current URL conversation even when the page has no recognizable message metadata', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(url.endsWith('/session') ? { accessToken: 'fixture-only' } : payload));
  });
  const request = await setup();
  document.body.innerHTML = '<main><p>问题</p><pre>回答代码</pre></main>';
  const response = request('CK_PREPARE');
  expect(response.ok).toBe(true);
  await vi.waitFor(() => expect(request('CK_STATUS').state).toBe('done'));
  expect(request('CK_STATUS').data.messages[0].markdown).toBe('问题');
  expect(request('CK_CHECK').ok).toBe(true);
  expect(calls).toEqual(['https://chatgpt.com/api/auth/session', 'https://chatgpt.com/backend-api/conversation/one']);
});
