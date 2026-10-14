import { uiData, uiEscape, uiLink, uiScalar, uiTable, type UiRecord } from './ui-data';
import { readUiLiteral } from './ui-literal';
import { svgDescription } from './ui-svg';

type Range = readonly [number, number];
export interface Tag { start: number; end: number; name: string; rawName: string; closing: boolean; selfClosing: boolean; props: UiRecord; svgSource?: string; }
const layouts = new Set(['box', 'row', 'column', 'stack', 'grid', 'card', 'text', 'title', 'heading', 'paragraph', 'badge', 'label', 'icon', 'divider', 'separator', 'spacer']);
const styled = (tag: Tag) => Object.keys(tag.props).some(key => /^(border|radius|padding|gap|background|align|justify|color|size|weight|tabularNums|variant)$/.test(key));
const useful = (tag: Tag) => Object.keys(tag.props).some(key => /^(content|data|items|rows|columns|label|title|description|caption|text|value|checked|href|src|alt|options)$/.test(key));
// Standard HTML without UI properties may be a literal example. Custom names
// are handled generically, so newly introduced component names are not omitted.
const html = new Set('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr svg path circle rect line polygon polyline g defs use'.split(' '));
const component = (tag: Tag) => tag.name === 'svg' || /^[A-Z]/.test(tag.rawName) || !html.has(tag.name) || layouts.has(tag.name) || styled(tag) || useful(tag);

// Read one quoted or balanced expression value without evaluating JavaScript.
function valueEnd(source: string, start: number): number | undefined {
  const first = source[start]; let quote = first === '{' ? '' : first; let braces = first === '{' ? 1 : 0;
  for (let pos = start + 1; pos < source.length; pos++) {
    const char = source[pos];
    if (quote) {
      if (char === '\\') pos++;
      else if (char === quote) { quote = ''; if (!braces) return pos + 1; }
    } else if ('"\'`'.includes(char)) quote = char;
    else if (char === '{') braces++;
    else if (char === '}' && --braces === 0) return pos + 1;
  }
}
export function readUiTag(source: string, start: number): Tag | undefined {
  const head = source.slice(start).match(/^<(\/?)([A-Za-z][\w:.-]*)(?=[\s/>])/);
  if (!head) return;
  const props: UiRecord = Object.create(null); let pos = start + head[0].length;
  while (pos < source.length) {
    while (/\s/.test(source[pos] || '') && pos < source.length) pos++;
    const ending = source.slice(pos).match(/^(\/?)>/);
    if (ending) return { start, end: pos + ending[0].length, name: head[2].toLowerCase(), rawName: head[2], closing: Boolean(head[1]), selfClosing: Boolean(ending[1]), props };
    if (head[1]) return;
    if (source[pos] === '{') { const end = valueEnd(source, pos); if (!end) return; pos = end; continue; }
    const attribute = source.slice(pos).match(/^[\w:.-]+/);
    if (!attribute) return;
    const key = attribute[0]; pos += key.length;
    while (/\s/.test(source[pos] || '') && pos < source.length) pos++;
    if (source[pos] !== '=') { props[key] = true; continue; }
    pos++; while (/\s/.test(source[pos] || '') && pos < source.length) pos++;
    const first = source[pos];
    if ('{"\'`'.includes(first)) {
      const end = valueEnd(source, pos); if (!end) return;
      const raw = source.slice(pos + 1, end - 1);
      if (first === '{') {
        props[key] = readUiLiteral(raw);
      } else props[key] = readUiLiteral(source.slice(pos, end)) ?? raw;
      pos = end;
    } else {
      const raw = source.slice(pos).match(/^[^\s<>]+?(?=\s|\/?$|\/?>)/)?.[0];
      if (!raw) return;
      props[key] = raw; pos += raw.length;
    }
  }
}
export const isUiTag = (tag: Tag): boolean => component(tag) || layouts.has(tag.name);

export function readableUiMarkup(source: string, code: Range[], indentedCode: Range[], warnings: Set<string>, decorate?: (tag: Tag, content: string, range: Range) => string): string {
  const contains = (ranges: Range[], offset: number) => ranges.some(([start, end]) => start <= offset && offset < end);
  const tags: Tag[] = [];
  for (let pos = source.indexOf('<'); pos >= 0; pos = source.indexOf('<', pos + 1)) {
    if (contains(code, pos)) continue;
    const tag = readUiTag(source, pos);
    if (tag) { tags.push(tag); pos = tag.end - 1; }
  }
  const pairs = new Map<number, number>(); const stack: number[] = [];
  tags.forEach((tag, index) => {
    if (tag.selfClosing) pairs.set(index, index);
    else if (!tag.closing) stack.push(index);
    else if (stack.length && tags[stack.at(-1)!].name === tag.name) pairs.set(stack.pop()!, index);
    else stack.length = 0;
  });
  function prose(start: number, end: number): string {
    let result = ''; let from = start;
    for (const [left, right] of code) {
      if (left < from || left >= end) continue;
      result += source.slice(from, left).replace(/^[\t ]+/gm, '') + source.slice(left, Math.min(right, end));
      from = Math.min(right, end);
    }
    return result + source.slice(from, end).replace(/^[\t ]+/gm, '');
  }
  const fallback = (name: string) => `【${name === 'chart' ? '图表' : '交互内容'}无法完整离线还原，请在原对话查看】`;
  function render(index: number, depth = 0): string {
    const value = renderContent(index, depth);
    const tag = tags[index]; const end = tags[pairs.get(index)!].end;
    return decorate ? decorate(tag.name === 'svg' ? {...tag,svgSource:source.slice(tag.start,end)} : tag, value, [tag.start,end]) : value;
  }
  function renderContent(index: number, depth = 0): string {
    const tag = tags[index]; const end = pairs.get(index)!; const props = tag.props;
    if (depth > 64) return fallback(tag.name);
    if (tag.name === 'svg') return `\n\n${uiEscape(svgDescription(source.slice(tag.start,tags[end].end)))}\n\n`;
    let body = ''; let cursor = tag.end;
    for (let child = index + 1; child < end; child++) {
      const closing = pairs.get(child);
      if (closing === undefined || closing >= end) continue;
      body += prose(cursor, tags[child].start) + render(child, depth + 1);
      cursor = tags[closing].end; child = closing;
    }
    if (!tag.selfClosing) body += prose(cursor, tags[end].start);
    if (tag.name === 'table') {
      const rows: string[][] = []; let hasHeader = false;
      const captions = [props.title, props.description, props.caption].map(uiEscape).filter(Boolean);
      for (let child = index + 1; child < end; child++) if (tags[child].name === 'caption' && !tags[child].closing && pairs.has(child)) {
        captions.push(render(child, depth + 1).trim()); child = pairs.get(child)!;
      }
      for (let row = index + 1; row < end; row++) if (tags[row].name === 'tr' && !tags[row].closing) {
        const rowEnd = pairs.get(row); if (rowEnd === undefined) continue;
        const cells: string[] = [];
        for (let cell = row + 1; cell < rowEnd; cell++) if (['th', 'td'].includes(tags[cell].name) && !tags[cell].closing && pairs.has(cell)) {
          if (!rows.length && tags[cell].name === 'th') hasHeader = true;
          cells.push(render(cell, depth + 1).trim().replace(/\s*\n\s*/g, ' ').replace(/(?<!\\)\|/g, '\\|'));
          cell = pairs.get(cell)!;
        }
        if (cells.length) rows.push(cells); row = rowEnd;
      }
      if (rows.length) {
        const width = Math.max(...rows.map(row => row.length));
        const padded = rows.map(row => Array.from({ length: width }, (_, cell) => row[cell] || ''));
        return `\n\n${[...captions, uiTable(hasHeader ? padded.shift()! : Array<string>(width).fill(''), padded)].join('\n\n')}\n\n`;
      }
    }
    const label = [props.label, props.title, props.alt].map(uiEscape).find(Boolean) || '';
    const description = [props.description, props.caption, props.text].map(uiEscape).filter(Boolean).join('\n\n');
    const structuredProps = Array.isArray(props.columns) || Array.isArray(props.series);
    const data = structuredProps ? uiData(props) : ['content', 'data', 'items', 'options', 'rows'].filter(key => Object.hasOwn(props, key)).map(key => uiData(props[key])).filter(Boolean).join('\n\n');
    const content = [label, description, data, body.trim()].filter(Boolean).join('\n\n');
    const block = (text: string) => text ? `\n\n${text}\n\n` : '';
    if (['script', 'style', 'iframe', 'object', 'embed'].includes(tag.name)) return block(fallback(tag.name));
    if (tag.name === 'icon') {
      if (['monitor','computer','desktop','pc','laptop'].includes(uiScalar(props.name))) return '电脑';
      const arrow = { 'arrow-down': '↓', 'arrow-up': '↑', 'arrow-left': '←', 'arrow-right': '→' }[String(props.name)];
      return arrow || ({check: '✓', x: '✕', 'check-circle': '✓', 'x-circle': '✕'}[String(props.name)]) || label || '';
    }
    if (['divider', 'separator', 'hr'].includes(tag.name)) return block('---');
    if (tag.name === 'spacer' || tag.name === 'br') return '\n';
    if (['link', 'a'].includes(tag.name)) return block([uiLink(body.trim() || label || '链接', props.href), description, data].filter(Boolean).join('\n\n'));
    if (['image', 'img', 'video', 'audio'].includes(tag.name)) return block([`${uiLink(label || '媒体文件', props.src || props.url)}（${['image','img'].includes(tag.name) ? '原图读取受限时请在原对话查看' : '文件未嵌入；无可用链接时请在原对话查看'}）`, description, data, body.trim()].filter(Boolean).join('\n\n'));
    if (['checkbox', 'switch', 'toggle', 'radio'].includes(tag.name)) return block(`${props.checked === true ? '☑' : props.checked === false ? '☐' : '（状态未提供）'} ${content}`);
    if (['button', 'action', 'submit'].includes(tag.name)) return block(`${uiLink(content || '按钮', props.href)}（按钮，交互请在原对话使用）`);
    if (['listitem', 'li'].includes(tag.name)) return `\n- ${content}\n`;
    if (['list', 'ul', 'ol'].includes(tag.name)) return block(content.replace(/\n{2,}/g, '\n'));
    const value = uiScalar(props.value);
    const limits = [props.min, props.max].map(uiScalar);
    const field = value ? `${label ? `${label}：` : ''}${uiEscape(props.valuePrefix)}${uiEscape(props.value)}${uiEscape(props.valueSuffix ?? props.unit)}${limits.some(Boolean) ? `（范围：${limits.map(uiEscape).join('–')}）` : ''}` : '';
    if (field) return block([field, description, data, body.trim()].filter(Boolean).join('\n\n'));
    if (content) return block(content);
    if (layouts.has(tag.name)) return '';
    return block(fallback(tag.name));
  }
  let result = ''; let from = 0;
  for (let index = 0; index < tags.length; index++) {
    const root = tags[index]; const end = pairs.get(index);
    if (root.closing || end === undefined || contains(indentedCode, root.start)) continue;
    if (!component(root) && !tags.slice(index + 1, end).some(tag => component(tag))) { index = end; continue; }
    result += source.slice(from, root.start) + render(index);
    from = tags[end].end; index = end;
    warnings.add('部分交互或特殊内容已转为文字说明；完整界面及交互请在原对话查看。');
  }
  return result + source.slice(from);
}
