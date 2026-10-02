import { expect, it } from 'vitest';
import { renderHtml, renderMarkdown } from '../src/exporters';
import type { Conversation } from '../src/types';
function sample(markdown: string): Conversation {
  return { title: '原文', url: 'https://chatgpt.com/c/one', exportedAt: '2026-09-23', warnings: [], source: 'api', messages: [{ id: 'a', role: 'assistant', stable: true, html: '', markdown }] };
}
it('preserves original Markdown including fences and math', () => {
  const text = '## 标题\n\n```python\n  print("hi")\n```\n\n公式 \\(x^2\\)';
  expect(renderMarkdown(sample(text))).toContain(text);
});
it('renders API Markdown as an offline reader with safe math, code and tables', () => {
  const output = renderHtml(sample('## 标题\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\n<script>example</script>\n```\n\n公式 $x^2$ 与 \\(a+b\\)\n\n$$\ny = x^2\n$$'));
  const doc = new DOMParser().parseFromString(output, 'text/html');
  expect(doc.querySelector('.body h2')?.textContent).toBe('标题');
  expect(doc.querySelectorAll('.body table')).toHaveLength(1);
  expect(doc.querySelector('.body code')?.textContent).toBe('<script>example</script>\n');
  expect(doc.querySelectorAll('math')).toHaveLength(3);
  expect(doc.querySelectorAll('script[src],link[rel="stylesheet"],.body script')).toHaveLength(0);
});
it('shows dangerous raw HTML as inert text and excludes export-process wording', () => {
  const output = renderHtml(sample('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))'));
  const doc = new DOMParser().parseFromString(output, 'text/html');
  expect(doc.querySelector('.body')?.textContent).toContain('<img');
  expect(doc.querySelectorAll('.body img,[onerror],a[href^="javascript:"]')).toHaveLength(0);
  expect(doc.body.textContent).not.toMatch(/采集|导出范围/);
});
