import { uiData, uiEscape, uiScalar } from './ui-data';
import { readUiTag } from './ui-markup';
import { uiExpression, type UiBindings } from './ui-expression';

type Range = readonly [number, number];
interface Control {start:number;end:number;kind:string;expression:string;}
const fallback = '【动态模板无法静态还原，请在原对话查看】';

// Template boundaries are balanced; newlines and quoted braces remain data.
function braced(source: string, start: number): number | undefined {
  let depth = 0;let quote = '';
  for (let pos = start;pos < source.length;pos++) {
    const char = source[pos];
    if (quote) {if (char === '\\') pos++;else if (char === quote) quote = '';continue;}
    if ('"\'`'.includes(char)) quote = char;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return pos + 1;
  }
}
export function expandUiTemplates(source: string, protectedRanges: (text: string) => Range[], warnings: Set<string>): string {
  const ranges = protectedRanges(source);const codeAt = (pos:number) => ranges.some(([a,b]) => a <= pos && pos < b);
  const controls: Control[] = [];const attributes: Range[] = [];
  for (let pos = 0;pos < source.length;pos++) {
    if (codeAt(pos)) continue;
    if (source[pos] === '<') {const tag = readUiTag(source,pos);if (tag) attributes.push([pos,tag.end]);}
    if (source[pos] !== '{') continue;
    const end = braced(source,pos);if (!end) continue;
    const token = source.slice(pos + 1,end - 1).trim();const match = token.match(/^(#each|#if|:else|\/each|\/if)(?:\s+([\s\S]*))?$/);
    if (match) controls.push({start:pos,end,kind:match[1],expression:match[2] || ''});
    pos = end - 1;
  }
  const pairs = new Map<Control,{close:Control;alternate?:Control;unsupported:boolean}>();
  const stack: {open:Control;alternate?:Control;unsupported:boolean}[] = [];
  for (const token of controls) {
    if (token.kind.startsWith('#')) stack.push({open:token,unsupported:false});
    else if (token.kind === ':else') {const top = stack.at(-1);if (top) {if (top.alternate || token.expression) top.unsupported = true;top.alternate = token;}}
    else {const top = stack.at(-1);if (top?.open.kind.slice(1) === token.kind.slice(1)) {stack.pop();pairs.set(top.open,{close:token,alternate:top.alternate,unsupported:top.unsupported});}else stack.length = 0;}
  }
  const inAttribute = (pos:number) => attributes.some(([a,b]) => a <= pos && pos < b);
  let work = 50_000;
  let remaining = 2_000_000;
  const exhausted = Symbol('template expansion budget');
  // Charge each generated fragment once, including nested/sibling blocks.
  // A failed block rolls back its own budget so surrounding prose survives.
  const take = (text:string,generated:boolean) => {
    if (generated) {if (text.length > remaining) throw exhausted;remaining -= text.length;}
    return text;
  };
  const interpolate = (start:number,end:number,bindings:UiBindings,generated:boolean) => {
    if (!bindings.size) return take(source.slice(start,end),generated);
    let result = '';let from = start;
    for (let pos = start;pos < end;pos++) {
      if (source[pos] !== '{' || codeAt(pos)) continue;
      const close = braced(source,pos);if (!close || close > end) continue;
      const value = uiExpression(source.slice(pos + 1,close - 1),bindings);
      if (value.ok) {
        const text = inAttribute(pos) ? `{${JSON.stringify(value.value)}}` : uiScalar(value.value) ? uiEscape(value.value) : value.value === null ? '' : uiData(value.value);
        result += take(source.slice(from,pos),generated) + take(text,generated);from = close;
      }
      pos = close - 1;
    }
    return result + take(source.slice(from,end),generated);
  };
  function render(start:number,end:number,bindings:UiBindings,depth:number): string {
    if (depth > 12 || --work < 0) return take(fallback,depth > 0);
    let result = '';let from = start;
    for (const token of controls) {
      if (token.start < from || token.start >= end || !token.kind.startsWith('#')) continue;
      const pair = pairs.get(token);if (!pair || pair.close.end > end) continue;
      result += interpolate(from,token.start,bindings,depth > 0);
      const before = remaining;
      let output: string | undefined;const bodyEnd = pair.alternate?.start ?? pair.close.start;
      try {
        if (!pair.unsupported && token.kind === '#each') {
          const spec = token.expression.match(/^([\s\S]+)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?$/);
          const input = spec ? uiExpression(spec[1],bindings) : {ok:false as const};
          const items = input.ok ? input.value : undefined;
          if (spec && spec[2] !== spec[3] && !['__proto__','prototype','constructor'].includes(spec[2]) && Array.isArray(items) && items.length <= 256) {
            output = '';
            for (let i = 0;i < items.length;i++) {
              if (--work < 0) throw exhausted;
              const scope = new Map(bindings);scope.set(spec[2],items[i]);if (spec[3]) scope.set(spec[3],i);
              output += render(token.end,bodyEnd,scope,depth + 1) + take('\n',true);
            }
            if (!items.length && pair.alternate) output = render(pair.alternate.end,pair.close.start,bindings,depth + 1);
          }
        } else if (!pair.unsupported && token.kind === '#if') {
          const condition = uiExpression(token.expression,bindings);
          if (condition.ok) output = condition.value ? render(token.end,bodyEnd,bindings,depth + 1) : pair.alternate ? render(pair.alternate.end,pair.close.start,bindings,depth + 1) : '';
        }
        output ??= take(fallback,depth > 0);
      } catch (error) {
        if (error !== exhausted) throw error;
        remaining = before;output = take(fallback,depth > 0);
      }
      warnings.add('交互组件已保存为静态内容；动态行为请在原对话使用。');
      result += output;from = pair.close.end;
    }
    return result + interpolate(from,end,bindings,depth > 0);
  }
  return render(0,source.length,new Map(),0);
}
