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
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
});
const report = [];
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
let payload = shortConversation();
let responseStatus = 200;
let responseDelay = 0;
let sessionStatus = 200;
const apiCalls = [];
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==', 'base64');
await context.route('https://images.oaiusercontent.com/original.png', async route => {
  assert.equal(route.request().headers().authorization, undefined);
  await route.fulfill({contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:pngBytes});
});
await context.route(/https:\/\/(?:assets\.example\.test|example\.test)\/.*\.png/, route => route.fulfill({status:404,headers:{'Access-Control-Allow-Origin':'*'},body:'missing'}));
await context.route('https://chatgpt.com/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/auth/session') { apiCalls.push(path); await route.fulfill({ status: sessionStatus, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-token-not-a-real-secret' }) }); return; }
  if (path.startsWith('/backend-api/conversation/')) {
    apiCalls.push(path);
    assert.equal(route.request().headers().authorization, 'Bearer fixture-token-not-a-real-secret');
    if (responseDelay) await new Promise(resolveWait => setTimeout(resolveWait, responseDelay));
    await route.fulfill({ status: responseStatus, contentType: 'application/json', body: JSON.stringify(payload) }).catch(() => {}); return;
  }
  if (path === '/backend-api/files/file-abc/download') {
    assert.equal(route.request().headers().authorization, 'Bearer fixture-token-not-a-real-secret');
    await route.fulfill({contentType:'application/json',body:JSON.stringify({download_url:'https://images.oaiusercontent.com/original.png'})}); return;
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
const browserCdp = await context.browser().newBrowserCDPSession();
await browserCdp.send('Extensions.loadUnpacked', { path: extensionPath });
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
const source = context.pages()[0] || await context.newPage();
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
    if (item?.state === 'complete') {
      await popup.waitForFunction(() => document.querySelector('#status').textContent.startsWith('已保存：') && !document.querySelector('#export').disabled);
      return { path: item.filename, content: await readFile(item.filename, 'utf8') };
    }
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
  assert.equal(await popup.locator('#export').textContent(), '导出全部');
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
  assert.equal(await popup.locator('#export').textContent(), '读取记录…');
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

  await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  popup = await openPopup(); await popup.locator('#export').click();
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('文件未保存') && !document.querySelector('#export').disabled);
  assert.doesNotMatch(await popup.locator('#status').textContent(), /已保存：|下载已开始/);
  await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve('artifacts/downloads'), eventsEnabled: true });
  const retriedSave = await download(popup, 'md'); assert.match(retriedSave.content, /每周回顾一次/);
  await popup.close();
  report.push('A browser-denied save that returns a download ID is reported as unsaved in the popup, and a manual retry confirms an actual completed file.');

  payload = shortConversation();
  const imageMarker = '\ue200i\ue202turn0image0\ue201';
  payload.mapping['assistant-2'].message.content.parts = [
    `正文在前。${imageMarker}\n\n\ue200image_group\ue202{"query":["电路结构"],"layout":"carousel"}\ue201\n\n\ue200widget\ue202{"private_id":"opaque-component-id"}\ue201\n\n正文在后。`,
    { content_type: 'image_asset_pointer', caption: '电路示意图', url: 'https://assets.example.test/circuit.png', asset_pointer: 'file-service://opaque-file' },
  ];
  payload.mapping['assistant-2'].message.metadata = { content_references: [{ matched_text: imageMarker, title: '插图来源', image_url: 'https://assets.example.test/picture.png' }] };
  popup = await openPopup();
  const richMarkdown = await download(popup, 'md'); const richHtml = await download(popup, 'html');
  for (const result of [richMarkdown, richHtml]) {
    assert.match(result.content, /正文在前/); assert.match(result.content, /正文在后/);
    assert.match(result.content, /电路示意图/); assert.match(result.content, /原对话/);
    assert.doesNotMatch(result.content, /[\ue200\ue201\ue202]|opaque-component-id|opaque-file|turn0image0/);
  }
  await popup.close();
  const richPreview = await context.newPage(); const richOutgoing = [];
  richPreview.on('request', request => { if (/^https?:/.test(request.url())) richOutgoing.push(request.url()); });
  await context.setOffline(true);
  await richPreview.goto(`file:///${richHtml.path.replaceAll('\\', '/')}`);
  assert.equal(await richPreview.locator('.body img,.body iframe,.body script').count(), 0);
  assert.equal(await richPreview.locator('a[href="https://assets.example.test/circuit.png"]').count(), 1);
  assert.deepEqual(richOutgoing, []);
  await richPreview.screenshot({ path: 'artifacts/rich-content-export.png', fullPage: true });
  await richPreview.close(); await context.setOffline(false);
  report.push('Image references and rich-content markers export as readable links/fallbacks in Markdown and offline HTML, without protocol IDs, remote loads, or executable components.');

  // Transcribed screenshot regression: XML-like layout tags and indentation.
  payload = shortConversation();
  payload.mapping['assistant-2'].message.content.parts = [await readFile('tests/fixtures/ui-markup.txt', 'utf8')];
  popup = await openPopup();
  const uiMarkdown = await download(popup, 'md'); const uiHtml = await download(popup, 'html');
  await popup.close();
  assert.doesNotMatch(uiMarkdown.content, /<\/?(?:box|text|row|icon|divider)\b|padding=|color=/);
  assert.match(uiMarkdown.content, /MeasurementSource: FIFO 128[\s\S]*↓[\s\S]*Batcher: 3 Records \/ Batch[\s\S]*↓[\s\S]*UploadManager: PIPE4 \/ RETX/);
  await writeFile('artifacts/ui-markup-export.md', uiMarkdown.content);
  await writeFile('artifacts/ui-markup-export.html', uiHtml.content);
  const uiPreview = await context.newPage(); const uiOutgoing = [];
  uiPreview.on('request', request => { if (/^https?:/.test(request.url())) uiOutgoing.push(request.url()); });
  await context.setOffline(true);
  await uiPreview.goto(`file:///${resolve('artifacts/ui-markup-export.html').replaceAll('\\', '/')}`);
  const uiBody = uiPreview.locator('.message.assistant .body').last();
  assert.doesNotMatch(await uiBody.textContent(), /<\/?(?:box|text|row|icon|divider)\b|padding=|color=/);
  assert.match(await uiBody.textContent(), /C2：达到阈值后/);
  assert.match(await uiBody.textContent(), /C3：跨 Host\/BLE 的完整恢复/);
  assert.equal(await uiBody.locator('pre,script,img,iframe,box,text').count(), 0);
  assert.equal(await uiBody.locator('strong').count(), 4);
  assert.deepEqual(uiOutgoing, []);
  await uiBody.screenshot({ path: 'artifacts/ui-markup-export.png' });
  await uiPreview.close(); await context.setOffline(false);
  report.push('The reported box/text layout exports readable flow labels, arrows and C1/C2/C3 notes in Markdown and offline HTML, without escaped layout tags or accidental code blocks.');

  for (const example of [
    { fixture: 'intelligent-ui', tables: 1, labels: ['计算方式', '8.42%', '8.86%', '9.23%', '仅表示序号非递增占比，不等于永久丢包率。', 'CRC错误帧', '3帧', '0.0002245%', '1,336,285', '周期停流'] },
    { fixture: 'ui-components', tables: 2, labels: ['设备汇总', '23°C', '保留这段说明', '方案一', '方案二', '设备A', '设备B', '第一项', '第二项', '重新计算', '人数：5', '☑', '☐', '进度：25', '原对话'] },
  ]) {
    payload = shortConversation();
    payload.mapping['assistant-2'].message.content.parts = [await readFile(`tests/fixtures/${example.fixture}.txt`, 'utf8')];
    popup = await openPopup();
    const md = await download(popup, 'md'); const html = await download(popup, 'html');
    await popup.close();
    for (const label of example.labels) assert.ok(md.content.includes(label), `Markdown retains ${label}`);
    await writeFile(`artifacts/${example.fixture}-0.7.md`, md.content);
    await writeFile(`artifacts/${example.fixture}-0.7.html`, html.content);
    const preview = await context.newPage(); const outgoing = [];
    preview.on('request', request => { if (/^https?:/.test(request.url())) outgoing.push(request.url()); });
    await context.setOffline(true);
    await preview.goto(`file:///${resolve(`artifacts/${example.fixture}-0.7.html`).replaceAll('\\', '/')}`);
    const body = preview.locator('.message.assistant .body').last();
    for (const label of example.labels) assert.ok((await body.textContent()).includes(label), `HTML retains ${label}`);
    assert.equal(await body.locator('table').count(), example.tables);
    assert.equal(await body.locator('script,iframe,img,input,button:not(.code-copy),box').count(), 0);
    assert.equal(await body.locator('text,title').evaluateAll(nodes => nodes.filter(node => node.namespaceURI !== 'http://www.w3.org/2000/svg').length),0);
    assert.equal(await body.locator('pre > button.code-copy').count(), await body.locator('pre').count());
    const prose = await body.evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll('pre,code').forEach(code => code.remove()); return copy.textContent; });
    assert.doesNotMatch(prose, /<\/?[A-Za-z][\w-]*\b|chartType|dataKey|tabularNums|content=|private-hidden|secret-widget/);
    if (example.fixture === 'ui-components') {
      assert.equal(await body.locator('a[href="https://example.test/docs"]').count(), 1);
      assert.equal(await body.locator('a[href="https://example.test/plot.png"]').count(), 1);
      assert.match(await body.locator('pre').textContent(), /<Chart content=/);
    }
    assert.deepEqual(outgoing, []);
    await body.screenshot({ path: `artifacts/${example.fixture}-0.7.png` });
    await preview.close(); await context.setOffline(false);
    report.push(`v0.7 ${example.fixture}: static UI data, tables, labels and surrounding prose survive both downloads, with code examples protected and no remote requests.`);
  }

  payload = shortConversation();
  payload.mapping['assistant-2'].message.content.parts = [
    '<grid columns={2} gap={3}><box border padding={3}><text color="secondary">剩余授权</text><title color="success" size="xl">11小时52分11秒</title></box><box border><text>缺失率</text><title color="danger">0.00326%</title></box></grid>\n\n<row>{#each [88281,88282,88283,88284,88285,88286] as seq}<box border><text>{seq}</text>{#if seq === 88284}<text color="danger">✕</text>{:else}<text color="success">✓</text>{/if}</box>{/each}</row>',
    {content_type:'image_asset_pointer',asset_pointer:'file-service://file-abc',caption:'原图测试'},
  ];
  popup = await openPopup();
  const visualMd = await download(popup,'md'); const visualHtml = await download(popup,'html'); await popup.close();
  assert.match(visualMd.content,/data:image\/png;base64/); assert.doesNotMatch(visualMd.content,/#each|\{seq\}|columns/);
  const visual = await context.newPage(); const visualOutgoing = [];
  visual.on('request', request => {if (/^https?:/.test(request.url())) visualOutgoing.push(request.url());});
  await context.setOffline(true); await visual.goto(`file:///${visualHtml.path.replaceAll('\\','/')}`);
  const visualBody = visual.locator('.message.assistant .body').last();
  assert.equal(await visualBody.locator('.ck-row .ck-box').count(),6);
  assert.equal(await visualBody.locator('.ck-grid-2').evaluate(node => getComputedStyle(node).display),'grid');
  assert.equal(await visualBody.locator('.ck-title.ck-success').evaluate(node => getComputedStyle(node).color),'rgb(0, 164, 70)');
  assert.equal(await visualBody.locator('img').evaluate(img => img.complete && img.naturalWidth > 0),true);
  assert.equal(await visualBody.locator('script,iframe').count(),0); assert.deepEqual(visualOutgoing,[]);
  await visualBody.screenshot({path:'artifacts/ui-images-0.7.1.png'});
  const pictureDownload = visual.waitForEvent('download'); await visualBody.locator('a[download]').click();
  const picture = await pictureDownload;
  const deadline = Date.now() + 10_000; let savedPicture;
  while (Date.now() < deadline) {
    savedPicture = await worker.evaluate(async () => (await chrome.downloads.search({orderBy:['-startTime'],limit:1}))[0]);
    if (savedPicture?.state === 'complete' && savedPicture.filename.endsWith('.png')) break;
    await new Promise(resolveWait => setTimeout(resolveWait,100));
  }
  assert.equal(savedPicture?.state,'complete'); assert.equal(await picture.failure(),null);
  assert.deepEqual(await readFile(savedPicture.filename),pngBytes);
  await visual.close(); await context.setOffline(false);
  report.push('Static card styling and literal each/if templates render correctly; original PNG embeds in both formats, displays offline and saves individually with identical bytes.');

  payload = shortConversation(); payload.mapping['assistant-2'].message.content.parts = [await readFile('tests/fixtures/connection-diagram.txt','utf8')];
  popup = await openPopup(); const diagramMd = await download(popup,'md'); const diagramHtml = await download(popup,'html'); await popup.close();
  assert.match(diagramMd.content,/H723 HUB/); assert.match(diagramMd.content,/BLE \/ UWB/); assert.doesNotMatch(diagramMd.content,/无法完整离线还原|<rect|<path/);
  const diagramPreview = await context.newPage(); const diagramOutgoing = [];
  diagramPreview.on('request', request => {if (/^https?:/.test(request.url())) diagramOutgoing.push(request.url());});
  await context.setOffline(true); await diagramPreview.goto(`file:///${diagramHtml.path.replaceAll('\\','/')}`);
  const diagramBody = diagramPreview.locator('.message.assistant .body').last();
  assert.equal(await diagramBody.locator('.ck-monitor').count(),2);
  assert.equal(await diagramBody.locator('.ck-static-svg rect').count(),2);
  assert.equal(await diagramBody.locator('.ck-static-svg line').count(),1);
  assert.equal(await diagramBody.locator('.ck-static-svg marker').count(),1);
  assert.equal(await diagramBody.locator('line').evaluate(node => getComputedStyle(node).markerEnd.includes(document.querySelector('.body marker').id)),true);
  assert.doesNotMatch(await diagramBody.textContent(),/无法完整离线还原/); assert.deepEqual(diagramOutgoing,[]);
  await diagramBody.screenshot({path:'artifacts/connection-diagram-0.7.2.png'});
  await diagramPreview.close(); await context.setOffline(false);
  report.push('Static SVG diagram retains monitor icons, device boxes, dashed line and local arrow markers offline; Markdown retains diagram labels without repeated fallbacks.');

  payload = shortConversation();payload.mapping['assistant-2'].message.content.parts = [await readFile('tests/fixtures/ui-fidelity.txt','utf8')];
  popup = await openPopup();const fidelityMd = await download(popup,'md');const fidelityHtml = await download(popup,'html');await popup.close();
  assert.doesNotMatch(fidelityMd.content,/#each|\/each|\{item\[|动态模板/);assert.match(fidelityMd.content,/后处理与终端供水/);
  await writeFile('artifacts/ui-fidelity-0.7.3.html',fidelityHtml.content);await writeFile('artifacts/ui-fidelity-0.7.3.md',fidelityMd.content);
  const fidelity = await context.newPage();const fidelityOutgoing = [];
  fidelity.on('request',request => {if (/^https?:/.test(request.url())) fidelityOutgoing.push(request.url());});
  await context.setOffline(true);await fidelity.goto(`file:///${resolve('artifacts/ui-fidelity-0.7.3.html').replaceAll('\\','/')}`);
  const fidelityBody = fidelity.locator('.message.assistant .body').last();
  const badge = await fidelityBody.locator('.ck-badge').first().boundingBox();const explanation = await fidelityBody.locator('.ck-badge + .ck-column').first().boundingBox();
  assert.ok(badge.width < 64 && explanation.x - badge.x < 90 && explanation.width > 500,'Badge stays compact and explanation uses the row');
  const flowBody = fidelityBody.locator('.ck-column.ck-center').first();
  assert.equal(await flowBody.locator('.ck-title').count(),6);assert.equal(await flowBody.locator('.ck-icon').count(),5);
  const positions = await flowBody.locator('.ck-title').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y));
  assert.ok(positions.every((value,index) => index === 0 || value > positions[index-1]));
  const chartBars = fidelityBody.locator('.ck-chart-bar');assert.equal(await chartBars.count(),7);
  const heights = await chartBars.evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('height'))));assert.ok(Math.abs(heights[0]/heights[5]-13) < .001);assert.equal(heights[0],heights[6]);
  assert.equal(await fidelityBody.locator('.ck-chart-data').evaluate(node => node.open),false);
  assert.doesNotMatch(await fidelityBody.textContent(),/#each|\/each|\{item\[/);
  await fidelityBody.screenshot({path:'artifacts/ui-fidelity-0.7.3-desktop.png'});
  await fidelity.locator('#reader-search').fill('泵组故障');await fidelity.waitForFunction(() => document.querySelector('.ck-chart-data').open);
  assert.equal(await fidelity.locator('svg mark').count(),0);await fidelity.locator('#clear-search').click();
  await fidelity.setViewportSize({width:390,height:844});
  assert.ok(await fidelity.evaluate(() => document.documentElement.scrollWidth <= innerWidth),'No page overflow on narrow screens');
  assert.ok(await fidelityBody.locator('.ck-chart-scroll').evaluate(node => node.scrollWidth > node.clientWidth),'Chart can scroll locally instead of shrinking labels');
  await fidelityBody.screenshot({path:'artifacts/ui-fidelity-0.7.3-mobile.png'});assert.deepEqual(fidelityOutgoing,[]);
  await fidelity.close();await context.setOffline(false);
  report.push('Reported layout cases: compact severity badges, six tuple/index flow stages with five arrows, and seven proportional bars render offline on desktop/mobile; chart data remains searchable without altering SVG.');

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
