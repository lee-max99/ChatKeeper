import MarkdownIt from 'markdown-it';
import katex from 'katex';

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
markdown.inline.ruler.before('escape', 'chatkeeper_math', (state, silent) => {
  const source = state.src; const start = state.pos;
  const opening = source.startsWith('\\(', start) ? '\\(' : source.startsWith('\\[', start) ? '\\[' : source.startsWith('$$', start) ? '$$' : source[start] === '$' ? '$' : '';
  if (!opening) return false;
  const closing = opening === '\\(' ? '\\)' : opening === '\\[' ? '\\]' : opening;
  if (opening === '$' && /\s/.test(source[start + 1] || ' ')) return false;
  let end = source.indexOf(closing, start + opening.length);
  while (end > 0 && source[end - 1] === '\\') end = source.indexOf(closing, end + closing.length);
  if (end < 0 || (opening === '$' && /\s/.test(source[end - 1]))) return false;
  if (!silent) {
    const token = state.push('chatkeeper_math', '', 0);
    token.content = source.slice(start + opening.length, end);
    token.meta = { display: opening === '$$' || opening === '\\[' };
  }
  state.pos = end + closing.length;
  return true;
});
markdown.renderer.rules.chatkeeper_math = (tokens, index) => katex.renderToString(tokens[index].content, {
  output: 'mathml', displayMode: Boolean(tokens[index].meta?.display), throwOnError: false,
  trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20,
});

export function markdownToHtml(source: string): string { return markdown.render(source); }
