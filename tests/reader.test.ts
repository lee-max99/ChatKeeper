import { afterEach, expect, it, vi } from 'vitest';
import { renderHtml } from '../src/exporters';
import readerScript from '../src/reader.js?raw';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('keeps SVG labels intact during search and reveals matching chart data', async () => {
  vi.useFakeTimers();vi.stubGlobal('matchMedia',() => ({matches:false,addEventListener(){}}));
  const output = renderHtml({title:'图表搜索',url:'https://chatgpt.com/c/one',exportedAt:'2026-10-17',warnings:[],messages:[{id:'a',role:'assistant',stable:true,html:'<svg viewBox="0 0 100 100"><text x="0" y="20">泵组故障</text></svg><details><summary>查看数据</summary><p>泵组故障 26</p></details>'}]});
  document.body.innerHTML = new DOMParser().parseFromString(output,'text/html').body.innerHTML;
  document.querySelectorAll<HTMLElement>('article').forEach(node => {node.scrollIntoView = () => {};});new Function(readerScript)();
  const input = document.querySelector<HTMLInputElement>('#reader-search')!;input.value = '泵组故障';input.dispatchEvent(new Event('input'));await vi.advanceTimersByTimeAsync(130);
  expect(document.querySelector('svg mark')).toBeNull();expect(document.querySelector('details')?.open).toBe(true);
  document.getElementById('clear-search')!.click();expect(document.querySelector('details')?.open).toBe(false);
});

it('provides safe, distinct outline anchors for repeated questions', () => {
  const output = renderHtml({ title: '阅读测试', url: 'https://chatgpt.com/c/one', exportedAt: '2026-09-22', warnings: [], messages: [
    { id: '1', stable: true, role: 'user', html: '<p>重复问题 &lt;script&gt;</p>' },
    { id: '2', stable: true, role: 'assistant', html: '<h2 id="collision">第一节</h2><p>答案</p>' },
    { id: '3', stable: true, role: 'user', html: '<p>重复问题 &lt;script&gt;</p>' },
  ] });
  const doc = new DOMParser().parseFromString(output, 'text/html');
  const links = [...doc.querySelectorAll('#outline a')];
  expect(links.length).toBeGreaterThanOrEqual(2);
  const targets = links.map(link => doc.getElementById(link.getAttribute('href')!.slice(1)));
  expect(targets.every(Boolean)).toBe(true);
  expect(new Set(targets).size).toBe(targets.length);
  expect(doc.querySelector('input[type="search"]')).not.toBeNull();
  expect(doc.querySelector('#outline script')).toBeNull();
});

it('applies a changed query when Enter is pressed before the search debounce', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  const output = renderHtml({ title: '搜索', url: 'https://chatgpt.com/c/one', exportedAt: '2026-09-22', warnings: [], messages: [
    { id: 'a', stable: true, role: 'user', html: '<p>apple</p>' },
    { id: 'b', stable: true, role: 'assistant', html: '<p>banana</p>' },
  ] });
  document.body.innerHTML = new DOMParser().parseFromString(output, 'text/html').body.innerHTML;
  document.querySelectorAll<HTMLElement>('article').forEach(node => { node.scrollIntoView = () => {}; });
  // Execute only our trusted reader, never conversation or reference scripts.
  new Function(readerScript)();
  const search = document.getElementById('reader-search') as HTMLInputElement;
  search.value = 'apple'; search.dispatchEvent(new Event('input'));
  await vi.advanceTimersByTimeAsync(130);
  expect(document.querySelector('#messages > article:not([hidden])')?.id).toBe('message-1');
  search.value = 'banana'; search.dispatchEvent(new Event('input'));
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  expect(document.querySelector('.search-current')?.id).toBe('message-2');
});

it('shows the question with a matching answer and highlights text without losing code', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  const output = renderHtml({ title: '上下文', url: 'https://chatgpt.com/c/one', exportedAt: '2026-09-23', warnings: [], messages: [
    { id: 'q', role: 'user', stable: true, html: '<p>怎么读取文件？</p>' },
    { id: 'a', role: 'assistant', stable: true, html: '<p>使用 Python</p><pre><code>print("Python")</code></pre>' },
    { id: 'q2', role: 'user', stable: true, html: '<p>无关问题</p>' },
    { id: 'a2', role: 'assistant', stable: true, html: '<p>无关回答</p>' },
  ] });
  document.body.innerHTML = new DOMParser().parseFromString(output, 'text/html').body.innerHTML;
  document.querySelectorAll<HTMLElement>('article').forEach(node => { node.scrollIntoView = () => {}; });
  new Function(readerScript)();
  const input = document.querySelector<HTMLInputElement>('#reader-search')!;
  input.value = 'Python'; input.dispatchEvent(new Event('input'));
  await vi.advanceTimersByTimeAsync(130);
  expect([...document.querySelectorAll('#messages > article:not([hidden])')].map(node => node.id)).toEqual(['message-1', 'message-2']);
  expect(document.querySelectorAll('.body mark[data-search-hit]')).toHaveLength(2);
  expect(document.querySelector('pre code')?.textContent).toBe('print("Python")');
  document.getElementById('clear-search')!.click();
  expect(document.querySelectorAll('.body mark[data-search-hit]')).toHaveLength(0);
  expect(document.querySelectorAll('#messages > article:not([hidden])')).toHaveLength(4);
});
