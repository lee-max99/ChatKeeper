import { beforeEach, expect, it } from 'vitest';
import { collectSnapshot } from '../src/collector';
import { renderHtml, renderMarkdown } from '../src/exporters';

beforeEach(() => { document.body.innerHTML = ''; document.title = '边界测试'; });
const capture = () => collectSnapshot(document, 'https://chatgpt.com/c/boundary');

it('keeps image-only and file-card-only user turns inside clickable controls', () => {
  document.body.innerHTML = '<div data-message-author-role="user" data-message-id="a"><button><img src="https://example.org/photo.png" alt="上传照片"></button><div role="button">研究资料.pdf</div></div>';
  const markdown = renderMarkdown(capture());
  expect(markdown).toContain('上传照片');
  expect(markdown).toContain('研究资料.pdf');
  expect(markdown).toContain('未嵌入');
});
it('does not reveal CSS-hidden nested content when export strips site styles', () => {
  document.body.innerHTML = '<style>.old-branch{display:none}</style><div data-message-author-role="assistant" data-message-id="a"><p>当前正文</p><div class="old-branch">旧内容</div><div style="display:none">隐藏内容</div></div>';
  const html = renderHtml(capture());
  expect(html).toContain('当前正文');
  expect(html).not.toContain('旧内容');
  expect(html).not.toContain('隐藏内容');
});
it('preserves code line breaks expressed as HTML br nodes', () => {
  document.body.innerHTML = '<div data-message-author-role="assistant" data-message-id="a"><pre><code>one<br>  two</code></pre></div>';
  expect(renderMarkdown(capture())).toContain('one\n  two');
});
it('preserves actual table content matching the previous line-break sentinel', () => {
  document.body.innerHTML = '<div data-message-author-role="assistant" data-message-id="a"><table><tr><th>Token</th></tr><tr><td>CHATEXPORTLINEBREAK</td></tr></table></div>';
  expect(renderMarkdown(capture())).toContain('CHATEXPORTLINEBREAK');
});
it('retains intentionally non-rendered math annotations as LaTeX source', () => {
  document.body.innerHTML = '<style>annotation { display:none }</style><div data-message-author-role="assistant" data-message-id="math"><span class="katex"><math><semantics><msup><mi>x</mi><mn>2</mn></msup><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span></div>';
  expect(renderMarkdown(capture())).toContain('$x^2$');
});
