import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { shortConversation, longConversation } from './api-fixture.mjs';

await mkdir('artifacts/downloads', { recursive: true });
const fixture = await readFile('tests/fixture.html', 'utf8');
const extensionPath = resolve('dist');
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, acceptDownloads: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--enable-unsafe-extension-debugging'],
});
const report = [];
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
let payload = shortConversation();
let responseStatus = 200;
let responseDelay = 0;
let sessionStatus = 200;
const apiCalls = [];
await context.route('https://chatgpt.com/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/auth/session') { apiCalls.push(path); await route.fulfill({ status: sessionStatus, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-token-not-a-real-secret' }) }); return; }
  if (path.startsWith('/backend-api/conversation/')) {
    apiCalls.push(path);
    assert.equal(route.request().headers().authorization, 'Bearer fixture-token-not-a-real-secret');
    if (responseDelay) await new Promise(resolveWait => setTimeout(resolveWait, responseDelay));
    await route.fulfill({ status: responseStatus, contentType: 'application/json', body: JSON.stringify(payload) }).catch(() => {}); return;
  }
  await route.fulfill({ contentType: 'text/html', body: fixture });
});
await context.addInitScript(() => {
  window.__scrollCalls = 0;
  const scroll = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function(...args) { window.__scrollCalls++; return scroll.apply(this, args); };
  const windowScroll = window.scrollTo;
  window.scrollTo = (...args) => { window.__scrollCalls++; return windowScroll.apply(window, args); };
});
await context.route('https://assets.example.test/**', route => route.abort());
await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Other site</h1>' }));
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
const source = context.pages()[0] || await context.newPage();
const browserCdp = await context.browser().newBrowserCDPSession();
await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve('artifacts/downloads'), eventsEnabled: true });
await browserCdp.send('Target.setDiscoverTargets', { discover: true });
// Toolbar popups are real CDP targets but are not exposed by Playwright as pages.
// Attach explicitly; no production APIs or permissions are mocked/modified.
async function attachPopup(targetId) {
  const { sessionId } = await browserCdp.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0; let closed = false; const pending = new Map();
  browserCdp.on('Target.targetDestroyed', event => { if (event.targetId === targetId) closed = true; });
  browserCdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(message.params.exceptionDetails));
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((resolveMessage, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve: resolveMessage, reject, timer });
    browserCdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  });
  await send('Runtime.enable');
  const evaluate = async (fn, arg) => {
    const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg) ?? ''})`, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitForFunction = async (fn, options = {}) => {
    const deadline = Date.now() + (options.timeout || 10000);
    while (!await evaluate(fn)) { if (Date.now() > deadline) throw new Error(`Popup condition timed out: ${await evaluate(() => document.body.innerText)}`); await new Promise(resolveWait => setTimeout(resolveWait, 80)); }
  };
  const locator = selector => ({
    textContent: () => evaluate(s => document.querySelector(s).textContent, selector),
    inputValue: () => evaluate(s => document.querySelector(s).value, selector),
    isEnabled: () => evaluate(s => !document.querySelector(s).disabled, selector),
    isDisabled: () => evaluate(s => document.querySelector(s).disabled, selector),
    check: () => evaluate(s => document.querySelector(s).click(), selector),
    click: () => evaluate(s => document.querySelector(s).click(), selector),
    innerText: () => evaluate(s => document.querySelector(s).innerText, selector),
  });
  return { locator, waitForFunction, evaluate, isClosed: () => closed,
    screenshot: async ({ path }) => {
      await new Promise(resolveWait => setTimeout(resolveWait, 800));
      const { cssContentSize } = await send('Page.getLayoutMetrics');
      const screenshot = await send('Page.captureScreenshot', { captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
      await writeFile(path, Buffer.from(screenshot.data, 'base64'));
    },
    close: async () => {
      await browserCdp.send('Target.closeTarget', { targetId }); closed = true;
      const deadline = Date.now() + 2000;
      while ((await browserCdp.send('Target.getTargets', {filter:[{}]})).targetInfos.some(target => target.targetId === targetId) && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 50));
    },
  };
}
async function openPopup() {
  await source.bringToFront();
  const oldPopupIds = (await browserCdp.send('Target.getTargets', {filter:[{}]})).targetInfos.filter(target => target.url === `chrome-extension://${extensionId}/popup.html`).map(target => target.targetId);
  const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const targetInfo = targetInfos.find(target => target.url === source.url());
  if (!targetInfo) throw new Error(`No tab target: ${JSON.stringify(targetInfos)}`);
  await browserCdp.send('Extensions.triggerAction', { id: extensionId, targetId: targetInfo.targetId });
  const deadline = Date.now() + 10000;
  let popupTarget;
  while (!popupTarget && Date.now() < deadline) {
    popupTarget = (await browserCdp.send('Target.getTargets', {filter:[{}]})).targetInfos.find(target => target.type === 'page' && target.url === `chrome-extension://${extensionId}/popup.html` && !oldPopupIds.includes(target.targetId));
    if (!popupTarget) await new Promise(resolveWait => setTimeout(resolveWait, 80));
  }
  if (!popupTarget) throw new Error('No toolbar popup target');
  const popup = await attachPopup(popupTarget.targetId);
  await popup.waitForFunction(() => document.querySelector('#refresh') && (!document.querySelector('#refresh').disabled || !document.querySelector('#cancel').hidden));
  await popup.waitForFunction(() => document.querySelector('#status')?.textContent !== '正在读取…' && document.querySelector('#status')?.textContent !== '正在读取对话信息…');
  return popup;
}
async function download(popup, format) {
  await popup.locator(`input[value="${format}"]`).check();
  const previousIds = await worker.evaluate(async () => (await chrome.downloads.search({})).map(item => item.id));
  await popup.locator('#export').click();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const item = await worker.evaluate(async ids => {
      const item = (await chrome.downloads.search({})).find(item => !ids.includes(item.id));
      return item ? { state: item.state, filename: item.filename, error: item.error } : null;
    }, previousIds);
    if (item?.state === 'complete') return { path: item.filename, content: await readFile(item.filename, 'utf8') };
    if (item?.state === 'interrupted') throw new Error(`Download interrupted: ${item.error}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(`Download did not finish: ${await popup.locator('#status').textContent()}`);
}
try {
  await source.goto('https://chatgpt.com/c/export-fixture');
  let popup = await openPopup();
  assert.equal(await popup.evaluate(() => document.querySelector('#floating-enabled')?.checked), true, 'Popup provides an enabled-by-default floating control');
  await popup.locator('#floating-enabled').click();
  await source.waitForFunction(() => document.querySelector('#chatkeeper-widget')?.hidden === true);
  await popup.locator('#floating-enabled').click();
  await source.waitForFunction(() => document.querySelector('#chatkeeper-widget')?.hidden === false);
  assert.equal(await popup.locator('#title').inputValue(), '用 Python 整理阅读笔记');
  assert.equal(await popup.locator('#export').isEnabled(), true);
  assert.doesNotMatch(await popup.locator('body').innerText(), /采集|补采|导出范围/);
  assert.equal(apiCalls.length, 0, 'Opening the popup must not start history requests');
  await popup.screenshot({ path: 'artifacts/popup.png' });
  const markdown = await download(popup, 'md');
  assert.match(markdown.content, /````python/);
  assert.match(markdown.content, /阅读\\\|技术/);
  assert.match(markdown.content, /\$x\^2\$/);
  assert.doesNotMatch(markdown.content, /fixture-token|采集|完整性未验证/);
  assert.equal(await source.evaluate(() => window.__scrollCalls), 0);
  report.push('One-click Markdown export through real extension/API requests and download; source page never scrolls.');
  if (popup.isClosed()) popup = await openPopup();
  const html = await download(popup, 'html');
  assert.doesNotMatch(html.content, /fixture-token|导出范围|采集/);
  const preview = await context.newPage();
  const outgoing = [];
  preview.on('request', request => { if (request.url().startsWith('http')) outgoing.push(request.url()); });
  await context.setOffline(true);
  await preview.goto(`file:///${html.path.replaceAll('\\', '/')}`);
  assert.equal(await preview.locator('.message').count(), 4);
  assert.equal(await preview.locator('math').count(), 1);
  assert.equal(await preview.locator('img,iframe,.body script').count(), 0);
  assert.equal(await preview.locator('script[nonce]').count(), 1);
  assert.equal(outgoing.length, 0);
  await preview.screenshot({ path: 'artifacts/export-html.png', fullPage: true });
  await preview.locator('#reader-search').fill('Path');
  await preview.waitForFunction(() => document.querySelector('#search-count').textContent.includes('匹配'));
  assert.equal(await preview.locator('#messages > article:not([hidden])').count(), 2, 'Search keeps the matching answer with its question');
  assert.equal(await preview.locator('mark[data-search-hit]').count() > 0, true);
  await preview.locator('#reader-search').fill('definitely-no-match-573');
  await preview.waitForFunction(() => !document.querySelector('#empty').hidden);
  assert.equal(await preview.locator('#messages > article:not([hidden])').count(), 0);
  await preview.locator('#clear-search').click();
  assert.equal(await preview.locator('#messages > article:not([hidden])').count(), 4);
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview.screenshot({ path: 'artifacts/export-mobile.png', fullPage: true, animations: 'disabled' });
  assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await preview.locator('#menu-toggle').click();
  await preview.locator('#outline a').first().click();
  assert.equal(await preview.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
  await preview.close(); await context.setOffline(false);
  report.push('HTML opened offline: native math, safe content, outline, search highlighting with Q&A context, mobile navigation, no remote resources.');
  if (!popup.isClosed()) await popup.close();

  // The saved default points at an old answer; the page displays a different
  // answer whose DOM ID is the mapping key. Duplicate wrappers and recap-only
  // leaves must not make that same visible conversation look ambiguous.
  payload = shortConversation();
  payload.mapping.old = { id: 'old', parent: 'user-1', message: { id: 'old', author: { role: 'assistant' }, status: 'finished_successfully', content: { content_type: 'text', parts: ['OLD-ANSWER-MUST-NOT-EXPORT'] } } };
  payload.current_node = 'old';
  payload.mapping['assistant-2'].message.id = 'saved-answer-2';
  payload.mapping.recap2 = { ...payload.mapping.recap, id: 'recap2', message: { ...payload.mapping.recap.message, id: 'recap2' } };
  await source.evaluate(() => {
    const answer = document.querySelector('[data-message-id="assistant-2"]');
    answer.insertAdjacentHTML('beforeend', '<div data-message-author-role="assistant" data-message-id="assistant-2">同一回答的包装节点</div>');
  });
  popup = await openPopup();
  const selected = await download(popup, 'md');
  assert.doesNotMatch(selected.content, /OLD-ANSWER-MUST-NOT-EXPORT|reasoning_recap|同一回答的包装节点/);
  assert.match(selected.content, /好的笔记/);
  assert.equal((selected.content.match(/^## (用户|ChatGPT)$/gm) || []).length, 4);
  report.push('Only the displayed conversation exported: old default answer excluded, duplicate DOM IDs and node/message aliases accepted, auxiliary-only leaves collapsed.');
  await popup.close();

  // Preserve exact IDs while varying their position relative to role markers.
  payload = shortConversation();
  await source.evaluate(() => {
    document.body.innerHTML = '<main>' + [
      '<article data-message-id="user-1"><div data-message-author-role="user">问题一</div></article>',
      '<article data-message-author-role="assistant"><div data-message-id="assistant-1">回答一</div></article>',
      '<article data-testid="conversation-turn-2"><div data-message-id="user-2">问题二</div></article>',
      '<article data-testid="conversation-turn-3"><div data-message-id="assistant-2">回答二</div></article>',
    ].join('') + '</main>';
  });
  popup = await openPopup();
  const nested = await download(popup, 'md');
  assert.equal((nested.content.match(/^## (用户|ChatGPT)$/gm) || []).length, 4);
  assert.match(nested.content, /好的笔记/);
  report.push('Message identification accepts parent/child ID markers and explicit role-less turns; actual download preserves all four saved messages.');
  await popup.close();

  payload = longConversation();
  await source.evaluate(() => {
    document.body.innerHTML = '<main style="height:3000px;padding-top:1000px">' + [996, 997, 998, 999].map(i => `<div data-message-author-role="${i % 2 ? 'assistant' : 'user'}" data-message-id="m${i}">消息 ${i}</div>`).join('') + '</main>';
    window.scrollTo(0, 1000); window.__scrollCalls = 0;
  });
  const initialTop = await source.evaluate(() => scrollY);
  popup = await openPopup();
  const began = Date.now();
  const full = await download(popup, 'md');
  assert.deepEqual([...full.content.matchAll(/消息 (\d+)/g)].map(match => Number(match[1])), Array.from({ length: 1000 }, (_, i) => i));
  assert.equal(await source.evaluate(() => window.__scrollCalls), 0);
  assert.equal(await source.evaluate(() => scrollY), initialTop);
  report.push(`1000-message API fixture exported with only 4 DOM messages, zero scroll calls and unchanged position (${Date.now() - began}ms; local fixture timing only).`);
  await popup.close();

  // Reproduce the user's blocker: visible text/code, no role or ID metadata.
  await source.evaluate(() => { document.body.innerHTML = '<main><p>问题已经显示</p><pre><code>回答代码已经显示</code></pre></main>'; });
  popup = await openPopup();
  const unmarked = await download(popup, 'md');
  assert.deepEqual([...unmarked.content.matchAll(/消息 (\d+)/g)].map(match => Number(match[1])), Array.from({ length: 1000 }, (_, i) => i));
  if (popup.isClosed()) popup = await openPopup();
  const unmarkedHtml = await download(popup, 'html');
  assert.match(unmarkedHtml.content, /消息 0/);
  assert.match(unmarkedHtml.content, /消息 999/);
  report.push('Visible page with no message metadata still exports all 1000 saved messages in Markdown and HTML.');
  await popup.close();

  await source.evaluate(() => { document.body.innerHTML = '<main><div data-message-author-role="assistant" data-message-id="new-page-id-not-in-record">页面 ID 无法对应</div></main>'; });
  popup = await openPopup();
  const unknownIds = await download(popup, 'md');
  assert.deepEqual([...unknownIds.content.matchAll(/消息 (\d+)/g)].map(match => Number(match[1])), Array.from({ length: 1000 }, (_, i) => i));
  report.push('Unmapped page IDs trigger bounded retries then export the saved current version without blocking.');
  await popup.close();
  await source.evaluate(() => { document.body.innerHTML = '<main><p>已显示的对话，没有页面 ID</p></main>'; });

  responseDelay = 1200;
  popup = await openPopup();
  await popup.locator('#export').click();
  await popup.waitForFunction(() => !document.querySelector('#cancel').hidden);
  await popup.close();
  await new Promise(resolveWait => setTimeout(resolveWait, 1500));
  popup = await openPopup();
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('已准备好'));
  assert.equal(await popup.locator('#count').textContent(), '1000 条消息');
  report.push('Preparation survives popup closure and exposes its completed result after reopening.');
  await popup.locator('#export').click();
  await popup.locator('#cancel').click();
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('取消') && document.querySelector('#cancel').hidden);
  report.push('Cancellation aborts preparation without exporting a partial document.');
  await popup.close(); responseDelay = 0;

  const downloadCount = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  sessionStatus = 401;
  popup = await openPopup();
  await popup.locator('#export').click();
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('登录'));
  assert.equal(await worker.evaluate(async () => (await chrome.downloads.search({})).length), downloadCount);
  report.push('401 login failure produces an actionable error and no incomplete file.');
  await popup.close(); sessionStatus = 200;

  responseStatus = 503;
  popup = await openPopup(); await popup.locator('#export').click();
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('503'));
  assert.equal(await worker.evaluate(async () => (await chrome.downloads.search({})).length), downloadCount);
  await popup.close(); responseStatus = 200;
  report.push('Upstream API failures never fall back to scrolling or a misleading DOM-only export.');

  payload = shortConversation(); payload.mapping['assistant-1'].message.status = 'in_progress'; payload.mapping['assistant-2'].message.status = 'pending';
  popup = await openPopup();
  assert.equal(await popup.locator('#export').isDisabled(), false);
  const staleStatusMarkdown = await download(popup, 'md');
  assert.match(staleStatusMarkdown.content, /未完成标记/); assert.match(staleStatusMarkdown.content, /每周回顾一次/);
  const staleStatusHtml = await download(popup, 'html');
  assert.match(staleStatusHtml.content, /未完成标记/); assert.match(staleStatusHtml.content, /每周回顾一次/);
  await popup.close();
  report.push('A finished page with stale API in-progress/pending markers downloads all saved content in Markdown and HTML with an explicit saved-status notice.');

  await source.evaluate(() => { const button = document.createElement('button'); button.dataset.testid = 'stop-button'; document.body.append(button); });
  popup = await openPopup();
  assert.equal(await popup.locator('#export').isDisabled(), true);
  assert.match(await popup.locator('#status').textContent(), /生成/);
  await popup.close();
  await source.goto('https://example.com/');
  popup = await openPopup();
  assert.equal(await popup.locator('#export').isDisabled(), true);
  assert.match(await popup.locator('#status').textContent(), /ChatGPT/);
  report.push('Streaming responses and unsupported websites are blocked.');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/browser-report.json', JSON.stringify({ browser: context.browser()?.version(), fixtureOnly: true, status: 'passed', results: report, errors }, null, 2));
  console.log(report.join('\n'));
} catch (error) {
  await writeFile('artifacts/browser-report.json', JSON.stringify({ browser: context.browser()?.version(), fixtureOnly: true, status: 'failed', results: report, errors: [...errors, String(error)] }, null, 2));
  console.error('Completed:', report);
  throw error;
} finally { await context.close(); }
