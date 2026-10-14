import MarkdownIt from 'markdown-it';
import { isUiTag, readUiTag, readableUiMarkup } from './ui-markup';
import type { Tag } from './ui-markup';
import { expandUiTemplates } from './ui-template';

type Item = Record<string, unknown>;
const object = (value: unknown): Item | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Item : undefined;
const plain = (value: unknown): string => typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim() : '';
// Metadata is text, never Markdown supplied by a component.
const escape = (value: string) => value.replace(/[\\`*_{}\[\]()<>!#|~$]/g, '\\$&');
export function resourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\x00-\x20\x7f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.username || url.password) return;
    return url.href.replace(/</g, '%3C').replace(/>/g, '%3E');
  } catch { return; }
}

const resourceTitle = (item: Item) => plain(item.title) || plain(item.caption) || plain(item.alt) || plain(item.name) || plain(item.filename);
const resourceHref = (item: Item) => resourceUrl(item.url) || resourceUrl(item.image_url) || resourceUrl(object(item.image_url)?.url);
function resourceLabel(item: Item, fallback: string): string {
  const title = resourceTitle(item) || fallback;
  const href = resourceHref(item);
  return href ? `[${escape(title)}](<${href}>)` : escape(title);
}

export function describeResource(item: Item | undefined, warnings: Set<string>): string {
  const type = String(item?.content_type || '');
  const media = /image/.test(type) ? '图片' : /audio/.test(type) ? '音频' : /video/.test(type) ? '视频' : '';
  if (media) {
    warnings.add('图片、音频与附件保留名称或可用链接，文件本身未嵌入。');
    return `> ${media}：${resourceLabel(item || {}, media)}（${media === '图片' ? '原图读取受限时请在原对话查看' : '文件未嵌入；无可用链接时请在原对话查看'}）`;
  }
  warnings.add('部分交互或特殊内容已转为文字说明；完整界面及交互请在原对话查看。');
  const description = plain(item?.description) || plain(item?.caption);
  return `> ${resourceLabel(item || {}, '非文本内容')}（原对话包含特殊内容）${description ? `：${escape(description)}` : ''}`;
}

const parser = new MarkdownIt({ html: false });
const codeParser = new MarkdownIt('zero');
codeParser.inline.ruler.enableOnly(['backticks']);
const backticks = codeParser.inline.ruler.getRules('')[0];
const inlineParser = new MarkdownIt({ html: false });
// Let the Markdown parser determine actual code spans, including escaped ticks.
// Without the bulk text rule, a complete rich frame can be consumed atomically
// before any Markdown punctuation inside its payload is interpreted.
inlineParser.inline.ruler.disable(['text']);
inlineParser.inline.ruler.before('backticks', 'rich_frame', (state, silent) => {
  if (state.src[state.pos] !== '\ue200') return false;
  const frame = state.src.slice(state.pos).match(/^\ue200[a-zA-Z_][\w-]*(?:\ue202[^\ue200\ue201]*)?\ue201/);
  if (!frame) return false;
  if (!silent) state.pending += frame[0];
  state.pos += frame[0].length; return true;
});
inlineParser.inline.ruler.at('backticks', (state, silent) => {
  const start = state.pos; const count = state.tokens.length;
  const result = backticks(state, silent);
  if (!silent && state.src === state.env.source && Array.isArray(state.env.ranges) && state.tokens.length > count && state.tokens.at(-1)?.type === 'code_inline') {
    state.env.ranges.push([start, state.pos]);
  }
  return result;
});
inlineParser.inline.ruler.before('backticks', 'ui_tag', (state, silent) => {
  if (state.src[state.pos] !== '<') return false;
  const tag = readUiTag(state.src, state.pos);
  if (!tag || !isUiTag(tag)) return false;
  if (!silent) state.pending += state.src.slice(state.pos, tag.end);
  state.pos = tag.end; return true;
});
function inlineCodeRanges(text: string): [number, number][] {
  const env = { source: text, ranges: [] as [number, number][] };
  // Parse unchanged input so CRLF normalization cannot shift offsets.
  inlineParser.inline.parse(text, inlineParser, env, []);
  return env.ranges.sort((a, b) => a[0] - b[0]);
}
function tableCodeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []; let from = 0;
  const cell = (end: number) => ranges.push(...inlineCodeRanges(text.slice(from, end)).map(([left, right]): [number, number] => [from + left, from + right]));
  for (let pos = 0; pos < text.length; pos++) {
    if (text[pos] === '<') {
      const tag = readUiTag(text, pos); if (tag) { pos = tag.end - 1; continue; }
    }
    if (text[pos] === '\ue200') {
      const frame = text.slice(pos).match(/^\ue200[a-zA-Z_][\w-]*(?:\ue202[^\ue200\ue201]*)?\ue201/);
      if (frame) { pos += frame[0].length - 1; continue; }
    }
    if (text[pos] !== '|' && text[pos] !== '\n') continue;
    let escapes = 0;
    for (let before = pos - 1; before >= 0 && text[before] === '\\'; before--) escapes++;
    if (text[pos] === '|' && escapes % 2) continue;
    cell(pos); from = pos + 1;
  }
  cell(text.length); return ranges;
}
function uiCodeRanges(source: string): { code: [number, number][]; indented: [number, number][] } {
  const offsets = [0];
  for (const match of source.matchAll(/\n/g)) offsets.push(match.index! + 1);
  const code: [number, number][] = []; const indented: [number, number][] = [];
  let tableEnd = 0;
  for (const token of parser.parse(source, {})) {
    if (!token.map) continue;
    const start = offsets[token.map[0]]; const end = offsets[token.map[1]] ?? source.length;
    if (token.type === 'table_open') {
      tableEnd = end;
      code.push(...tableCodeRanges(source.slice(start, end)).map(([left, right]): [number, number] => [start + left, start + right]));
    }
    else if (token.type === 'fence') code.push([start, end]);
    else if (token.type === 'code_block') {
      indented.push([start, end]);
      // A confirmed layout will lose its layout indentation. Protect explicit
      // inline examples in that text before its tags are scanned, too.
      let offset = start;
      for (const paragraph of source.slice(start, end).split(/(\r?\n[\t ]*\r?\n)/)) {
        code.push(...inlineCodeRanges(paragraph).map(([left, right]): [number, number] => [offset + left, offset + right]));
        offset += paragraph.length;
      }
    }
    else if (token.type === 'inline' && start >= tableEnd) code.push(...inlineCodeRanges(source.slice(start, end)).map(([left, right]): [number, number] => [start + left, start + right]));
  }
  return { code: code.sort((a, b) => a[0] - b[0]), indented };
}
export function convertUiMarkup(source: string, warnings: Set<string>, decorate?: (tag: Tag, content: string) => string): string {
  source = expandUiTemplates(source, text => {
    const {code,indented} = uiCodeRanges(text); const components: (readonly [number,number])[] = [];
    readableUiMarkup(text,code,indented,new Set(), (_tag,content,range) => {components.push(range);return content;});
    return [...code,...indented.filter(([start,end]) => !components.some(([left,right]) => left <= start && end <= right))];
  }, warnings);
  const { code, indented } = uiCodeRanges(source);
  return readableUiMarkup(source, code, indented, warnings, decorate);
}
function outsideCode(source: string, transform: (value: string) => string): string {
  const offsets = [0];
  for (const match of source.matchAll(/\n/g)) offsets.push(match.index! + 1);
  const blocks = parser.parse(source, {}).filter(token => ['fence', 'code_block', 'inline', 'table_open'].includes(token.type) && token.map)
    .map(token => ({ start: offsets[token.map![0]], end: offsets[token.map![1]] ?? source.length, type: token.type }));
  function inline(text: string): string {
    let result = ''; let from = 0;
    for (const [start, end] of inlineCodeRanges(text)) {
      if (start < from) continue;
      result += transform(text.slice(from, start)) + text.slice(start, end); from = end;
    }
    return result + transform(text.slice(from));
  }
  function table(text: string): string {
    let result = ''; let from = 0;
    // Table cells have independent inline-code scopes. Keep separators and
    // escaped pipes untouched, and never split inside a complete rich frame.
    for (const match of text.matchAll(/\ue200[a-zA-Z_][\w-]*(?:\ue202[^\ue200\ue201]*)?\ue201|(?<!\\)\||\r?\n/g)) {
      if (match[0][0] === '\ue200') continue;
      result += inline(text.slice(from, match.index)) + match[0]; from = match.index! + match[0].length;
    }
    return result + inline(text.slice(from));
  }
  const gap = (text: string) => text.split(/(\r?\n[ \t]*\r?\n)/).map(inline).join('');
  let result = ''; let from = 0;
  for (const { start, end, type } of blocks) {
    if (start < from) continue;
    const body = source.slice(start, end);
    result += gap(source.slice(from, start)) + (type === 'inline' ? inline(body) : type === 'table_open' ? table(body) : body); from = end;
  }
  return result + gap(source.slice(from));
}

export function readableRichText(source: string, metadata: Item | undefined, warnings: Set<string>, convertUi = true): string {
  if (convertUi && /<[A-Za-z][\w:.-]*(?=[\s/>])/.test(source)) source = convertUiMarkup(source, warnings);
  if (!source.includes('\ue200') && !Array.isArray(metadata?.content_references) && !/!\[[^\n]*\]\(<?(?:attachment|file-service|sediment|sandbox):/i.test(source)) return source;
  const references = new Map<string, string>();
  if (Array.isArray(metadata?.content_references)) for (const raw of metadata.content_references) {
    const ref = object(raw); const matched = plain(ref?.matched_text);
    if (!ref || !matched) continue;
    const values = [ref, ...(Array.isArray(ref.items) ? ref.items.map(object).filter((item): item is Item => Boolean(item)) : [])];
    const links = values.filter(item => resourceHref(item) || resourceTitle(item))
      .map(item => resourceLabel(item, /image/.test(String(ref.type)) ? '图片' : '参考来源') + (resourceHref(item) ? '' : '（请在原对话查看）'));
    if (links.length) references.set(String(ref.matched_text), [...new Set(links)].join(' · '));
  }
  return outsideCode(source, text => {
    for (const [matched, replacement] of references) {
      if (!matched.startsWith('\ue200')) text = text.split(matched).join(replacement);
    }
    // Only recognized framing is interpreted; arbitrary private-use characters stay intact.
    const converted = text.replace(/\ue200([a-zA-Z_][\w-]*)(?:\ue202([^\ue200\ue201]*))?\ue201/g, (whole: string, kind: string, payload = '') => {
      const linked = references.get(whole);
      if (linked) return linked;
      let data: unknown;
      try { data = JSON.parse(payload); } catch { /* Opaque IDs are not display text. */ }
      if (kind === 'entity' && Array.isArray(data) && typeof data[1] === 'string') return escape(plain(data[1]));
      warnings.add('部分交互或特殊内容已转为文字说明；完整界面及交互请在原对话查看。');
      const item = object(data);
      if (kind === 'image_group') {
        const queries = Array.isArray(item?.query) ? item.query.filter((query): query is string => typeof query === 'string').map(plain).filter(Boolean) : [];
        return `【图片组${queries.length ? `；检索词：${escape(queries.join('、'))}` : ''}，请在原对话查看】`;
      }
      const label = ['i', 'image', 'imagegen'].includes(kind) ? '图片' : ['cite', 'citation', 'navlist', 'filenavlist'].includes(kind) ? '参考内容' : '交互内容';
      return `【${label}${item && plain(item.title) ? `：${escape(plain(item.title))}` : ''}，请在原对话查看】`;
    });
    // Non-widget citation references may also provide display text and a public link.
    return converted.replace(/\ue200[a-zA-Z_][\w-]*\ue202/g, () => {
      warnings.add('部分特殊内容标记不完整，已保留后续原文。');
      return '【特殊内容标记不完整，后续为原文】';
    }).replace(/!\[([^\]\n]*)\]\(<?(?:attachment|file-service|sediment|sandbox):[^)\n]*\)/gi, (_whole, caption: string) => {
      warnings.add('图片、音频与附件保留名称或可用链接，文件本身未嵌入。');
      return `【图片${caption ? `：${escape(caption)}` : ''}，请在原对话查看】`;
    });
  });
}
