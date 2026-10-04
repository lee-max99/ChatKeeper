import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('artifacts/downloads', { recursive: true });
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, acceptDownloads: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
});
const errors = []; const requests = []; const results = [];
let delay = 0; let strict = false;
let apiPrompts = ['保存的提问'];
const prompts = ['怎样把这段聊天整理成笔记？', '长对话如何完整导出？', '怎样把这段聊天整理成笔记？', '我想保留代码、表格和公式，同时让界面尽可能简洁。请帮我整理一个容易阅读的版本，并且说明每一步的处理方式。'];
const turns = prompts.map((text, index) => `<article data-testid="conversation-turn-${index * 2}"><div data-message-author-role="user">${text}<button>编辑</button></div></article><article data-testid="conversation-turn-${index * 2 + 1}"><div data-message-author-role="assistant"><p>这是第 ${index + 1} 个问题的回答。</p><pre>ChatKeeper · 保留每一次思考</pre></div></article>`).join('');
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('https://chatgpt.com/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/auth/session') {
    requests.push(path);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-only' }) }); return;
  }
  if (path.startsWith('/backend-api/conversation/')) {
    requests.push(path);
    const responsePrompts = [...apiPrompts];
    if (delay) await new Promise(resolveWait => setTimeout(resolveWait, delay));
    const mapping = {};
    responsePrompts.forEach((text, index) => {
      mapping[`u${index}`] = { id: `u${index}`, parent: index ? `a${index - 1}` : null, message: { id: `u${index}`, author: { role: 'user' }, content: { parts: [text] } } };
      mapping[`a${index}`] = { id: `a${index}`, parent: `u${index}`, message: { id: `a${index}`, author: { role: 'assistant' }, status: 'finished_successfully', content: { parts: [`回答 ${index}`] } } };
    });
    mapping.old = { id: 'old', parent: 'u0', message: { id: 'old', author: { role: 'assistant' }, content: { parts: ['不应进入目录的旧分支'] } } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: '保存记录', current_node: `a${responsePrompts.length - 1}`, mapping }) }).catch(() => {}); return;
  }
  await route.fulfill({ contentType: 'text/html', headers: strict ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'" } : {}, body: `<!doctype html><meta charset="UTF-8"><title>整理聊天记录 - ChatGPT</title><style>body{margin:0;background:#f9fafb;color:#292931;font:15px/1.7 sans-serif}header{position:fixed;top:0;left:0;right:0;height:56px;background:white;border-bottom:1px solid #eee;padding:12px 28px;z-index:2}main{height:100vh;overflow:auto;max-width:760px;margin:0 auto;padding:85px 40px 300px;box-sizing:border-box}article{padding:20px 0}article:has([data-message-author-role=assistant]){min-height:300px}article:has([data-message-author-role=user]){scroll-margin-top:24px}[data-message-author-role=user]{padding:14px 20px;background:#eeeef4;border-radius:18px;width:80%;margin-left:auto}button{margin-left:10px}pre{background:#f0f0f3;padding:20px;border-radius:12px}</style><header>ChatGPT</header><aside hidden><div data-message-author-role="user">侧栏文字</div></aside><main>${turns}<article hidden><div data-message-author-role="user">旧分支不应出现</div></article></main>` });
});
const extensionCdp = await context.browser().newBrowserCDPSession();
await extensionCdp.send('Extensions.loadUnpacked', { path: resolve('dist') });
let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const page = context.pages()[0] || await context.newPage();
const pageCdp = await context.newCDPSession(page); let contentContext;
const extensionId = worker.url().split('/')[2];
pageCdp.on('Runtime.executionContextCreated', ({ context }) => {
  if (context.origin === `chrome-extension://${extensionId}` || context.name === extensionId) contentContext = context.id;
});
await pageCdp.send('Runtime.enable');
async function scanCount(reset = false) {
  assert.ok(contentContext, 'Real extension isolated world is available');
  const result = await pageCdp.send('Runtime.evaluate', { contextId: contentContext, returnByValue: true, expression: `(${reset => {
    if (!window.__ckScanObserver) {
      window.__ckScanObserver = true; window.__ckScans = 0;
      for (const prototype of [Document.prototype, Element.prototype]) {
        const query = prototype.querySelectorAll;
        prototype.querySelectorAll = function(selector) {
          if (/data-message|data-is-streaming|stop-button/.test(selector)) window.__ckScans++;
          return query.call(this, selector);
        };
      }
    }
    if (reset) window.__ckScans = 0;
    return window.__ckScans;
  }})(${reset})` });
  return result.result.value;
}
async function request(type) {
  return worker.evaluate(async type => {
    const [tab] = await chrome.tabs.query({ active: true });
    return chrome.tabs.sendMessage(tab.id, { type });
  }, type);
}
const pause = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
async function download(format) {
  await page.locator('#chatkeeper-widget #download-format').selectOption(format);
  const before = await worker.evaluate(async () => (await chrome.downloads.search({})).map(item => item.id));
  await page.locator('#chatkeeper-widget #download').click();
  for (let attempt = 0; attempt < 125; attempt++) {
    const item = await worker.evaluate(async ids => (await chrome.downloads.search({})).find(item => !ids.includes(item.id)), before);
    if (item?.state === 'complete') return readFile(item.filename, 'utf8');
    await pause(80);
  }
  throw new Error(`No floating download: ${await page.locator('#chatkeeper-widget #download-status').textContent()}`);
}
try {
  const browserCdp = await context.browser().newBrowserCDPSession();
  await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve('artifacts/downloads'), eventsEnabled: true });
  await page.goto('https://chatgpt.com/c/first');
  const widget = page.locator('#chatkeeper-widget'); const items = widget.locator('#questions button');
  await widget.waitFor({ timeout: 4000 });
  assert.equal(await widget.locator('#launcher').isVisible(), true);
  assert.equal(await widget.locator('#panel').isVisible(), false);
  await scanCount(true); await pause(1150);
  assert.equal(await scanCount(), 0, 'Collapsed widget must not scan conversation messages');
  assert.equal(requests.length, 0);
  await page.screenshot({ path: 'artifacts/floating-button.png' });
  results.push('Automatic collapsed launcher performs no message scans or API requests.');

  await widget.locator('#launcher').click();
  assert.equal(await widget.locator('#panel').getAttribute('aria-label'), 'ChatKeeper 提问目录');
  assert.equal(await items.count(), 4);
  assert.equal(await widget.locator('#title').textContent(), '整理聊天记录');
  assert.match(await widget.locator('#count').textContent(), /4/);
  assert.deepEqual(await items.locator('.question-text').allTextContents(), prompts);
  assert.equal(await widget.locator('#export, input[name="format"]').count(), 0);
  assert.equal(await widget.locator('#download').isVisible(), true);
  await page.locator('body > header').click();
  assert.equal(await widget.locator('#panel').isVisible(), true);
  await page.screenshot({ path: 'artifacts/floating-panel.png' });
  await widget.screenshot({ path: 'artifacts/floating-panel-detail.png' });
  results.push('Floating panel retains the question outline and provides a compact download footer.');

  await items.nth(2).click();
  await page.waitForFunction(() => {
    const top = document.querySelector('[data-testid="conversation-turn-4"]').getBoundingClientRect().top;
    return top >= 70 && top < 100;
  });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button')[2].getAttribute('aria-current') === 'location');
  assert.equal(await page.locator('main').evaluate(node => node.scrollTop > 300), true);
  assert.equal(await page.locator('[data-testid="conversation-turn-4"]').evaluate(node => node.style.scrollMarginTop), '');
  await page.locator('main').evaluate(node => { node.scrollTop = 0; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#questions button').getAttribute('aria-current') === 'location');
  results.push('Clicking a question scrolls the nested chat container to that turn; reading highlight follows manual scrolling.');

  await items.nth(1).focus();
  await page.evaluate(() => {
    const article = document.createElement('article'); article.dataset.testid = 'conversation-turn-8';
    article.innerHTML = '<div data-message-author-role="user">新增的提问</div>'; document.querySelector('main').append(article);
  });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 5);
  assert.equal(await items.nth(1).evaluate(node => node.getRootNode().activeElement === node), true, 'Adding a prompt must preserve keyboard focus on the same question');
  await items.nth(4).focus();
  await page.evaluate(() => { document.querySelector('[data-testid="conversation-turn-8"] [data-message-author-role]').firstChild.textContent = '编辑后的提问'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#questions li:last-child button').textContent.includes('编辑后的提问'));
  assert.equal(await items.nth(4).evaluate(node => node.getRootNode().activeElement === node), true, 'Editing a prompt must preserve its keyboard focus');
  results.push('New questions and edited prompt text update automatically.');

  await page.evaluate(() => {
    history.pushState({}, '', '/c/second'); document.title = '第二条会话 - ChatGPT';
  });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#title').textContent === '第二条会话');
  assert.equal(await items.count(), 0, 'Do not relabel old question nodes as the new conversation while its DOM is loading');
  await page.evaluate(() => { const status = document.createElement('div'); status.textContent = '输入框正在加载'; document.querySelector('main').append(status); });
  await pause(250);
  assert.equal(await items.count(), 0, 'Unrelated composer changes must not expose old conversation questions');
  await page.evaluate(() => {
    document.querySelector('main').innerHTML = '<article data-testid="conversation-turn-0" data-turn="user"><h5 class="sr-only">You said:</h5><div class="whitespace-pre-wrap">新会话的提问</div></article><article data-testid="conversation-turn-1" data-turn="assistant">回答</article>';
  });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 1);
  assert.deepEqual(await items.locator('.question-text').allTextContents(), ['新会话的提问']);
  assert.equal(await widget.locator('#panel').isVisible(), true);
  await items.first().focus(); await pause(1200);
  assert.equal(await items.first().evaluate(node => node.getRootNode().activeElement === node), true);
  results.push('SPA switching replaces the outline, recognizes ID-less explicit turns, and preserves focus while unchanged.');

  await page.evaluate(() => {
    document.querySelector('[data-turn="user"]').removeAttribute('data-turn');
    document.querySelector('.whitespace-pre-wrap').setAttribute('data-message-id', 'second-question');
  });
  await pause(250);
  await page.evaluate(() => { history.pushState({}, '', '/c/reused'); document.title = '复用节点的会话 - ChatGPT'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#title').textContent === '复用节点的会话');
  assert.equal(await items.count(), 0);
  await page.evaluate(() => { document.querySelector('.whitespace-pre-wrap').setAttribute('data-message-id', 'new-question'); });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 1);
  assert.deepEqual(await items.locator('.question-text').allTextContents(), ['新会话的提问']);
  results.push('Reused DOM nodes with identical prompt text are recognized as new when their available message identity changes.');
  await page.evaluate(() => { document.querySelector('.whitespace-pre-wrap').removeAttribute('data-message-id'); });
  await pause(250);
  await page.evaluate(() => { history.pushState({}, '', '/c/idless'); document.title = '无标识会话 - ChatGPT'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#title').textContent === '无标识会话');
  assert.equal(await items.count(), 0);
  await page.evaluate(() => { document.querySelector('.whitespace-pre-wrap').firstChild.textContent = '不需要 ID 的新提问'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#questions button')?.textContent.includes('不需要 ID 的新提问'));
  results.push('ID-less accessibility-heading turns recover after in-place prompt text changes during navigation.');
  await page.evaluate(() => { history.pushState({}, '', '/c/second'); document.title = '返回之前的会话 - ChatGPT'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#title').textContent === '返回之前的会话');
  await page.evaluate(() => { document.querySelector('.whitespace-pre-wrap').firstChild.textContent = '新会话的提问'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#questions button')?.textContent.includes('新会话的提问'), undefined, { timeout: 3000 });
  results.push('Returning to an earlier conversation using the same DOM node restores its prompt instead of excluding an old snapshot forever.');

  const header = await widget.locator('#drag-handle').boundingBox(); const beforeDrag = await widget.boundingBox();
  await page.mouse.move(header.x + 25, header.y + 12); await page.mouse.down();
  await page.mouse.move(header.x - 145, header.y + 62, { steps: 8 }); await page.mouse.up();
  const afterDrag = await widget.boundingBox(); assert.equal(afterDrag.x < beforeDrag.x - 100, true);
  await widget.locator('#minimize').click(); await widget.locator('#launcher').focus(); await page.keyboard.press('Enter');
  assert.equal(await widget.locator('#panel').isVisible(), true);
  await widget.locator('#minimize').click(); await page.reload();
  await widget.locator('#launcher').waitFor({ state: 'visible' });
  assert.equal(await widget.locator('#panel').isVisible(), false);
  await widget.locator('#launcher').click();
  const restored = await widget.boundingBox();
  assert.equal(Math.abs(restored.x - afterDrag.x) < 3 && Math.abs(restored.y - afterDrag.y) < 3, true);
  results.push('Dragging, keyboard reopening, and persisted position work; reload starts collapsed.');

  await worker.evaluate(() => chrome.storage.local.set({ floatingEnabled: false })); await widget.waitFor({ state: 'hidden' });
  await scanCount(true); await pause(1150); assert.equal(await scanCount(), 0);
  await worker.evaluate(() => chrome.storage.local.set({ floatingEnabled: true })); await widget.locator('#launcher').waitFor({ state: 'visible' });
  await page.setViewportSize({ width: 360, height: 640 }); await widget.locator('#launcher').click();
  const mobile = await widget.boundingBox();
  assert.equal(mobile.x >= 0 && mobile.x + mobile.width <= 360 && mobile.y >= 0 && mobile.y + mobile.height <= 640, true);
  await page.screenshot({ path: 'artifacts/floating-mobile.png' });
  assert.equal(requests.length, 0, 'Opening, navigating and updating the outline must not request authentication or saved records');
  const stored = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(Object.keys(stored).every(key => ['floatingEnabled', 'floatingPosition', 'floatingFormat'].includes(key)), true);
  results.push('Disabled outline does no scans; narrow viewport remains accessible; only UI preferences are stored and no API is requested.');

  await page.evaluate(() => { document.querySelector('main').innerHTML = '<p>尚未加载的会话</p>'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 0);
  assert.equal(await widget.locator('#empty').isVisible(), true);
  await page.evaluate(() => { document.querySelector('main').innerHTML = '<article data-testid="conversation-turn-0"><div data-message-author-role="user">&lt;img src=x onerror=alert(1)&gt;</div></article>'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 1);
  assert.equal(await items.locator('img').count(), 0);
  assert.match(await items.first().textContent(), /<img src=x/);
  results.push('Unloaded-page empty state recovers automatically and question text cannot inject markup.');

  delay = 3000;
  assert.equal((await request('CK_PREPARE')).ok, true);
  await page.evaluate(() => { history.pushState({}, '', '/c/third'); document.title = '切换后的会话 - ChatGPT'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#title').textContent === '切换后的会话');
  assert.equal((await request('CK_STATUS')).state, 'error');
  await page.evaluate(() => { history.pushState({}, '', '/c/fourth'); document.title = '新任务 - ChatGPT'; });
  assert.equal((await request('CK_PREPARE')).ok, true);
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#title').textContent === '新任务');
  assert.equal((await request('CK_STATUS')).state, 'running');
  await request('CK_CANCEL');
  results.push('Outline navigation cancels only old toolbar preparation and preserves preparation already targeting the new URL.');

  delay = 0; strict = true; await page.reload();
  await widget.locator('#launcher').waitFor({ state: 'visible' });
  assert.equal(Math.round((await widget.locator('#launcher').boundingBox()).width), 36);
  await widget.locator('#launcher').click();
  assert.equal(Math.round((await widget.locator('#panel').boundingBox()).width), 300);
  assert.equal(await items.count(), 4);
  results.push('Question outline renders under a restrictive page CSP.');

  strict = false;
  await page.reload(); await widget.locator('#launcher').waitFor({ state: 'visible' }); await widget.locator('#launcher').click();
  apiPrompts = ['页面中的问题', '重复提问', '重复提问', '尚未加载的历史问题'];
  await page.evaluate(() => {
    history.pushState({}, '', '/g/g-p-project/c/project-thread'); document.title = '分支 · 项目会话 - ChatGPT';
    document.querySelector('main').innerHTML = '<p id="plain-q1">页面中的问题</p><div style="height:500px">回答内容</div><p id="plain-q2">重复提问</p><div style="height:500px">第二个回答</div><p id="plain-q3">重复提问</p><div style="height:600px">第三个回答</div>';
  });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 4 && document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#questions button')?.textContent.includes('页面中的问题'), undefined, { timeout: 3000 });
  assert.deepEqual(await items.locator('.question-text').allTextContents(), apiPrompts);
  await items.nth(2).click();
  await page.waitForFunction(() => { const top = document.querySelector('#plain-q3').getBoundingClientRect().top; return top >= 70 && top < 100; });
  await items.nth(3).click();
  assert.match(await widget.locator('#download-status').textContent(), /尚未加载/);
  await items.nth(1).focus();
  await page.evaluate(() => document.querySelector('#plain-q3').insertAdjacentHTML('afterend', '<div>页面状态更新</div>'));
  await pause(250);
  assert.equal(await items.nth(1).evaluate(node => node.getRootNode().activeElement === node), true);
  results.push('Saved current-path records recover an unmarked page outline, locate duplicate plain prompts in order, and report unloaded history without jumping elsewhere.');
  await widget.screenshot({ path: 'artifacts/floating-fallback-detail.png' });
  const beforeOutlineUpdate = requests.length;
  apiPrompts.push('后来新增的问题');
  await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p id="plain-q4">后来新增的问题</p>'));
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 5, undefined, { timeout: 6000 });
  assert.deepEqual(await items.locator('.question-text').allTextContents(), apiPrompts);
  assert.ok(requests.length > beforeOutlineUpdate, 'Changed unmarked content must refresh saved records');
  apiPrompts[0] = '编辑后的保存提问';
  await page.evaluate(() => { document.querySelector('#plain-q1').textContent = '编辑后的保存提问'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('.question-text').textContent === '编辑后的保存提问', undefined, { timeout: 6000 });
  await items.nth(1).focus();
  await page.evaluate(() => document.querySelector('#plain-q1').setAttribute('data-message-role', 'user'));
  await pause(400);
  assert.deepEqual(await items.locator('.question-text').allTextContents(), apiPrompts, 'Recognizing only part of the page must not discard saved history');
  assert.equal(await items.nth(1).evaluate(node => node.getRootNode().activeElement === node), true);
  const stableRequests = requests.length;
  await pause(4000);
  assert.equal(requests.length, stableRequests, 'An unchanged fallback directory must not poll the service repeatedly');
  results.push('Saved outline refreshes after new and edited unmarked prompts, retains history when only part of the page is recognized, and preserves focus without continuous API polling.');
  await pageCdp.send('Runtime.evaluate', { contextId: contentContext, expression: "document.querySelector('#plain-q4').scrollIntoView = () => { document.documentElement.dataset.outlineJumped = 'yes'; }; document.documentElement.dataset.outlineJumped = 'no';" });
  await page.evaluate(() => {
    document.querySelector('#plain-q4').setAttribute('data-message-role', 'assistant');
    document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button')[4].click();
  });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.outlineJumped), 'no', 'Changed assistant roles must immediately invalidate old question targets');
  await pause(300);
  await page.evaluate(() => {
    document.querySelector('#plain-q4').setAttribute('data-message-role', 'user');
    document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button')[4].click();
  });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.outlineJumped), 'yes');
  results.push('Role marker changes refresh saved-directory targets without replacing its full history.');

  const beforeStreaming = requests.length;
  apiPrompts.push('生成结束后才更新的提问');
  await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<button data-testid="stop-button">停止</button><p>生成结束后才更新的提问</p>'));
  await pause(1800);
  assert.equal(requests.length, beforeStreaming, 'Saved outline refresh must wait until generation ends');
  await page.evaluate(() => document.querySelector('[data-testid="stop-button"]').remove());
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 6, undefined, { timeout: 6000 });
  results.push('Saved outline waits during generation and refreshes once the response finishes.');

  const backendReads = () => requests.filter(path => path.startsWith('/backend-api/conversation/')).length;
  async function waitForBackendRead(previous) {
    for (let attempt = 0; attempt < 120; attempt++) { if (backendReads() > previous) return; await pause(50); }
    throw new Error('Expected saved-directory refresh did not start');
  }
  const beforeLaggedSave = backendReads();
  await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>延迟保存的提问</p>'));
  await waitForBackendRead(beforeLaggedSave);
  apiPrompts.push('延迟保存的提问');
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 7, undefined, { timeout: 6000 });
  assert.equal(backendReads() - beforeLaggedSave, 2, 'An unchanged saved snapshot permits one bounded follow-up read');
  results.push('One bounded follow-up read recovers a question that reaches saved records after the initial refresh.');

  delay = 700;
  const beforeInFlightChange = backendReads();
  apiPrompts.push('读取开始前的新提问');
  await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>读取开始前的新提问</p>'));
  await waitForBackendRead(beforeInFlightChange);
  apiPrompts.push('读取过程中的新提问');
  await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>读取过程中的新提问</p>'));
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 9, undefined, { timeout: 7000 });
  assert.deepEqual(await items.locator('.question-text').allTextContents(), apiPrompts);
  delay = 0;
  results.push('Changes arriving while saved records are being read remain queued and update the complete directory afterward.');
  delay = 700;
  const beforeGenerationRace = backendReads();
  apiPrompts.push('生成开始前的问题');
  await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>生成开始前的问题</p>'));
  await waitForBackendRead(beforeGenerationRace);
  apiPrompts.push('读取期间生成的新问题');
  await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<button data-testid="stop-button">停止</button><p>读取期间生成的新问题</p>'));
  await pause(1100);
  await page.evaluate(() => document.querySelector('[data-testid="stop-button"]').remove());
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 11, undefined, { timeout: 6000 });
  delay = 0;
  results.push('Generation starting during a read defers the rejected refresh and resumes it after generation ends without losing new questions.');
  delay = 1000;
  const beforeJoin = backendReads();
  await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>回答内容更新</p>'));
  await waitForBackendRead(beforeJoin);
  assert.equal(await widget.locator('#download').isEnabled(), true, 'Automatic directory reading must allow joining it to download');
  const joinedMarkdown = await download('md');
  assert.match(joinedMarkdown, /读取过程中的新提问/);
  assert.equal(backendReads() - beforeJoin, 1, 'Download joins the active read rather than preparing the records a second time');
  delay = 0;
  results.push('Download can join an automatic outline refresh and saves the complete path without a second preparation.');
  const markdown = await download('md');
  assert.match(markdown, /编辑后的保存提问/); assert.match(markdown, /后来新增的问题/); assert.match(markdown, /尚未加载的历史问题/); assert.doesNotMatch(markdown, /不应进入目录的旧分支/);
  const html = await download('html'); assert.match(html, /尚未加载的历史问题/); assert.match(html, /<!doctype html>/i);
  results.push('Floating Markdown and HTML downloads include the complete current path even when the directory could not parse any messages.');
  apiPrompts.push('新会话的追加提问');
  await page.evaluate(() => {
    history.pushState({}, '', '/c/shared-history'); document.title = '共同历史的新会话 - ChatGPT';
  });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#title').textContent === '共同历史的新会话');
  assert.equal(await items.count(), 0, 'Old recognized user nodes must remain hidden while the new conversation loads');
  const sharedHistoryMarkdown = await download('md');
  assert.match(sharedHistoryMarkdown, /新会话的追加提问/);
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 12, undefined, { timeout: 6000 });
  assert.deepEqual(await items.locator('.question-text').allTextContents(), apiPrompts, 'API-confirmed history shared with the previous page must stay in the new directory');
  results.push('A new conversation retaining common historical questions displays its entire confirmed saved path without dropping shared entries.');
  apiPrompts = ['切换回答后保留的问题', '新的后续问题'];
  await page.evaluate(() => { document.querySelector('main').innerHTML = '<p>切换回答后保留的问题</p><p>新的后续问题</p>'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelectorAll('#questions button').length === 2, undefined, { timeout: 6000 });
  assert.deepEqual(await items.locator('.question-text').allTextContents(), apiPrompts);
  results.push('A refreshed saved path replaces obsolete questions after editing or changing the current branch instead of accumulating old paths.');
  delay = 1200;
  await widget.locator('#download').click(); await widget.locator('#download-cancel').waitFor({ state: 'visible' }); await widget.locator('#download-cancel').click();
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#download-status').textContent.includes('取消') && document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#download-cancel').hidden);
  const beforeNavigation = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  await widget.locator('#download').click();
  await page.evaluate(() => { history.pushState({}, '', '/c/new-download'); document.title = '下载时切换 - ChatGPT'; });
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#title').textContent === '下载时切换');
  await pause(1400);
  assert.equal(await worker.evaluate(async () => (await chrome.downloads.search({})).length), beforeNavigation);
  results.push('Floating download remains cancellable and navigating before preparation finishes does not download the previous conversation.');
  delay = 0;
  const beforeInvalidatedDownload = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  const replacementWorker = context.waitForEvent('serviceworker');
  // Replace only this isolated profile's test extension, leaving its existing chat tab open.
  await extensionCdp.send('Extensions.uninstall', { id: extensionId });
  await extensionCdp.send('Extensions.loadUnpacked', { path: resolve('dist') });
  worker = await replacementWorker;
  await widget.locator('#download').click();
  await page.waitForFunction(() => document.querySelector('#chatkeeper-widget').shadowRoot.querySelector('#download-status').textContent.includes('扩展连接已失效'), undefined, { timeout: 6000 });
  assert.match(await widget.locator('#download-status').textContent(), /刷新 ChatGPT 页面/);
  assert.equal(await worker.evaluate(async () => (await chrome.downloads.search({})).length), beforeInvalidatedDownload);
  await page.reload(); await widget.locator('#launcher').waitFor({ state: 'visible' }); await widget.locator('#launcher').click();
  const recoveredMarkdown = await download('md');
  assert.match(recoveredMarkdown, /切换回答后保留的问题/);
  results.push('Replacing the extension invalidates the old page context, shows a Chinese recovery hint without downloading a partial file, and refreshing ChatGPT restores actual download.');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/floating-report.json', JSON.stringify({ status: 'passed', fixtureOnly: true, results, errors }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  await writeFile('artifacts/floating-report.json', JSON.stringify({ status: 'failed', fixtureOnly: true, results, errors: [...errors, String(error)] }, null, 2));
  throw error;
} finally { await context.close(); }
