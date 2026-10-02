import { beforeEach, describe, expect, it } from 'vitest';
import { collectSnapshot } from '../src/collector';
import { renderHtml, renderMarkdown, safeFilename } from '../src/exporters';
import type { Conversation } from '../src/types';

const url = 'https://chatgpt.com/c/example';
function conversation(html: string): Conversation {
  return { title: '中文 <导出>', url, exportedAt: '2026-09-22T08:00:00.000Z', warnings: ['完整性未验证'], messages: [
    { id: 'u', stable: true, role: 'user', html: '<p>解释代码</p>' },
    { id: 'a', stable: true, role: 'assistant', html },
  ] };
}
beforeEach(() => { document.body.innerHTML = ''; document.title = '导出测试 - ChatGPT'; });

describe('page extraction', () => {
  it('keeps message order, repeated prompts and visible branch; excludes action UI', () => {
    document.body.innerHTML = `<main>
      <div data-message-author-role="user" data-message-id="1"><div class="whitespace-pre-wrap">你好</div></div>
      <div data-message-author-role="assistant" data-message-id="2"><div class="markdown"><p>回答</p><pre><button>复制代码</button><code>  x = 1</code></pre></div><button>点赞</button></div>
      <div hidden><div data-message-author-role="assistant" data-message-id="old">旧分支</div></div>
      <div data-message-author-role="user" data-message-id="3">你好</div></main>`;
    const result = collectSnapshot(document, url);
    expect(result.messages.map(m => m.id)).toEqual(['1', '2', '3']);
    expect(result.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(result.messages[1].html).toContain('  x = 1');
    expect(result.messages[1].html).not.toContain('复制代码');
    expect(result.messages[1].html).not.toContain('点赞');
    expect(result.title).toBe('导出测试');
    expect(result.warnings.join('')).toContain('完整性未验证');
  });
  it('does not silently return an empty export', () => {
    expect(() => collectSnapshot(document, url)).toThrow(/未识别/);
  });
  it('refuses unsupported hosts and unfinished generations', () => {
    expect(() => collectSnapshot(document, 'https://chatgpt.com.evil.test/c/a')).toThrow(/ChatGPT/);
    document.body.innerHTML = '<button data-testid="stop-button">停止</button><div data-message-author-role="assistant">正在写</div>';
    expect(() => collectSnapshot(document, url)).toThrow(/生成/);
  });
  it('keeps attachment-only messages rather than losing the turn', () => {
    document.body.innerHTML = '<div data-message-author-role="user"><img alt="用户图片" src="https://example.org/a.png"></div>';
    expect(collectSnapshot(document, url).messages[0].html).toContain('用户图片');
  });
});

describe('exports', () => {
  it('preserves nested fences, indentation and language in Markdown', () => {
    const output = renderMarkdown(conversation('<pre><code class="language-python">  print("```内容```")\n    pass\n</code></pre>'));
    expect(output).toContain('````python\n  print("```内容```")\n    pass\n````');
    expect(output).toContain('## 用户');
    expect(output).toContain('## ChatGPT');
    expect(output).toContain(url);
  });
  it('preserves table cells including pipes and line breaks', () => {
    const output = renderMarkdown(conversation('<table><thead><tr><th>键</th><th>值</th></tr></thead><tbody><tr><td>a|b</td><td>一<br>二</td></tr></tbody></table>'));
    expect(output).toContain('| 键 | 值 |');
    expect(output).toContain('| a\\|b | 一<br>二 |');
  });
  it('extracts math source once and preserves multi-line user text', () => {
    const output = renderMarkdown(conversation('<span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html">duplicate</span></span><div class="whitespace-pre-wrap">第一行\n第二行</div>'));
    expect(output).toContain('$x^2$');
    expect(output).not.toContain('duplicate');
    expect(output).toMatch(/第一行\s*\n第二行/);
  });
  it('sanitizes HTML, escapes metadata and keeps assets as non-loading links', () => {
    const output = renderHtml(conversation('<p onclick="alert(1)">正文</p><script>alert(2)</script><a href="javascript:alert(3)">危险</a><img src="https://example.org/a.png" alt="图片"><iframe src="https://evil.test"></iframe><pre><code>&lt;script&gt;literal&lt;/script&gt;</code></pre>'));
    const doc = new DOMParser().parseFromString(output, 'text/html');
    expect(doc.querySelectorAll('iframe,img,[onclick],.body script')).toHaveLength(0);
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelector('script')?.getAttribute('nonce')).toBeTruthy();
    expect(doc.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(doc.title).toBe('中文 <导出>');
    expect(doc.querySelector('code')?.textContent).toBe('<script>literal</script>');
    expect(doc.querySelector('a[href="https://example.org/a.png"]')).not.toBeNull();
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
  });
  it('does not expose session-only blob links as permanent images', () => {
    const output = renderMarkdown(conversation('<img src="blob:https://chatgpt.com/123" alt="临时图片">'));
    expect(output).not.toContain('blob:');
    expect(output).toContain('未嵌入');
  });
  it('normalizes Windows reserved names, path characters and empty titles', () => {
    expect(safeFilename('CON', 'md')).toBe('_CON.md');
    expect(safeFilename('../报告:测试? ', 'html')).toBe('_报告_测试_.html');
    expect(safeFilename('   ', 'md')).toBe('ChatGPT 对话.md');
  });
  it('rejects empty conversations instead of exporting a misleading document', () => {
    const empty = { ...conversation(''), messages: [] };
    expect(() => renderMarkdown(empty)).toThrow(/没有/);
    expect(() => renderHtml(empty)).toThrow(/没有/);
  });
});
