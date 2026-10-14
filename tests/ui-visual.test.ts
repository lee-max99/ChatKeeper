import { expect, it } from 'vitest';
import { normalizeConversation } from '../src/conversation-api';
import { renderHtml, renderMarkdown } from '../src/exporters';

function data(source: string) {
  return normalizeConversation({ current_node: 'a', mapping: { a: { parent: null, message: { id: 'a', author: { role: 'assistant' }, content: { parts: [source] } } } } }, 'https://chatgpt.com/c/test');
}
it('keeps metric card styling in HTML and readable values in Markdown', () => {
  const source = '<grid columns={2} gap={3}><box border radius="lg" padding={3}><text color="secondary" size="sm">剩余授权</text><title color="success" size="xl">11小时52分11秒</title></box><box border><text>缺失率</text><title color="danger">0.00326%</title></box></grid>';
  const doc = new DOMParser().parseFromString(renderHtml(data(source)), 'text/html');
  expect(doc.querySelector('.body .ck-grid-2')).not.toBeNull();
  expect(doc.querySelector('.body .ck-success')?.textContent).toContain('11小时52分11秒');
  expect(doc.querySelector('.body .ck-danger')?.textContent).toContain('0.00326%');
  expect(renderMarkdown(data(source))).not.toMatch(/columns|gap/);
});
it('expands static each and conditional templates without executing code', () => {
  const source = '<row>{#each [88281,88282,88283,88284,88285,88286] as seq}<box border><text>{seq}</text>{#if seq === 88284}<text color="danger">✕</text>{:else}<text color="success">✓</text>{/if}</box>{/each}</row>';
  const value = data(source); const doc = new DOMParser().parseFromString(renderHtml(value), 'text/html');
  expect(doc.querySelectorAll('.body .ck-box')).toHaveLength(6);
  expect(doc.querySelector('.body .ck-danger')?.textContent).toBe('✕');
  expect(doc.querySelectorAll('.body .ck-success')).toHaveLength(5);
  expect(renderMarkdown(value)).not.toMatch(/#each|\/each|#if|\{seq\}/);
});
it('protects code examples and declines executable or unbounded templates', () => {
  const code = '```svelte\n<row>{#each [1] as seq}{seq}{/each}</row>\n```';
  expect(data(code).messages[0].markdown).toBe(code);
  const source = '<box>{#each fetch("https://evil.test") as seq}{seq}{/each}</box>';
  expect(renderHtml(data(source))).not.toContain('fetch(');
});
it('retains full loop attribute values and literal indented examples', () => {
  expect(renderMarkdown(data('<row>{#each ["Hello world"] as label}<text value={label}/>{/each}</row>'))).toContain('Hello world');
  const source = '<box>UI</box>\n\n    {#if true}Literal template example{/if}';
  expect(data(source).messages[0].markdown).toContain('    {#if true}Literal template example{/if}');
});
it('handles supported branch semantics and gives an honest fallback for unsupported branches', () => {
  expect(renderMarkdown(data('<box>{#if 1 == "1"}TRUE{:else}FALSE{/if}</box>'))).toContain('TRUE');
  expect(renderMarkdown(data('<box>{#each [] as seq}{seq}{:else}没有数据{/each}</box>'))).toContain('没有数据');
  const result = renderMarkdown(data('<box>{#if true}A{:else if false}B{:else}C{/if}</box>'));
  expect(result).toContain('无法静态还原'); expect(result).not.toContain('else if');
});
