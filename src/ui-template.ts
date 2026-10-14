import { readUiLiteral } from './ui-literal';
import { uiEscape } from './ui-data';
import { readUiTag } from './ui-markup';

type Range = readonly [number, number];
// A static template reader. No eval, function calls, property access or scripts.
export function expandUiTemplates(source: string, protectedRanges: (text: string) => Range[], warnings: Set<string>, depth = 0): string {
  if (depth > 12) return '【模板层级过深，请在原对话查看】';
  const ranges = protectedRanges(source);
  const protectedAt = (pos: number) => ranges.some(([a, b]) => a <= pos && pos < b);
  const re = /\{#(each|if)\s+([^\n]*?)\}|\{:(else)\}|\{\/(each|if)\}/g;
  let result = ''; let from = 0;
  for (const opening of source.matchAll(re)) {
    if (opening.index! < from || !opening[1] || protectedAt(opening.index!)) continue;
    const kind = opening[1]; let level = 1; let close: RegExpMatchArray | undefined; let alternate: number | undefined;
    for (const token of source.slice(opening.index! + opening[0].length).matchAll(re)) {
      const pos = opening.index! + opening[0].length + token.index!;
      if (protectedAt(pos)) continue;
      if (token[1]) level++;
      if (token[4] && --level === 0) { if (token[4] === kind) { close = token; close.index = pos; } break; }
      if (token[3] && level === 1) alternate = pos;
    }
    if (!close) continue; // Unknown boundaries must never consume later prose.
    const bodyStart = opening.index! + opening[0].length; const end = close.index!;
    let replacement = '【动态模板无法静态还原，请在原对话查看】';
    if (/\{:else\s+[^}]+\}/.test(source.slice(bodyStart, end))) {
      // Unsupported branch forms must not be guessed or printed as source.
    } else if (kind === 'each') {
      const spec = opening[2].match(/^([\s\S]+)\s+as\s+([A-Za-z_$][\w$]*)$/);
      const items = spec ? readUiLiteral(spec[1]) : undefined;
      if (spec && Array.isArray(items) && items.length <= 256 && items.every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
        const body = source.slice(bodyStart, alternate ?? end); const bodyCode = protectedRanges(body);
        const attributes: Range[] = [];
        for (let pos = body.indexOf('<'); pos >= 0; pos = body.indexOf('<',pos + 1)) {
          const tag = readUiTag(body,pos); if (tag) {attributes.push([pos,tag.end]);pos = tag.end - 1;}
        }
        replacement = items.map(value => {
          const expanded = body.replace(/\{([^{}]+)\}/g, (whole, expression: string, offset: number) => {
            if (bodyCode.some(([a, b]) => a <= offset && offset < b)) return whole;
            if (expression.trim() === spec[2]) return attributes.some(([a,b]) => a <= offset && offset < b) ? `{${JSON.stringify(value)}}` : uiEscape(value);
            // Substitute only the loop variable, as an inert literal. Remaining
            // conditionals are handled below; event expressions are never run.
            const escapedName = spec[2].replace(/[$]/g, '\\$&');
            return whole.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^"']+/g, segment => /^["']/.test(segment) ? segment : segment.replace(new RegExp(`(?<![\\w$])${escapedName}(?![\\w$])`, 'g'), JSON.stringify(value)));
          });
          return expandUiTemplates(expanded, protectedRanges, warnings, depth + 1);
        }).join('\n');
        if (!items.length && alternate !== undefined) replacement = expandUiTemplates(source.slice(alternate + '{:else}'.length, end), protectedRanges, warnings, depth + 1);
      }
    } else {
      const condition = opening[2].match(/^\s*(.*?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.*?)\s*$/);
      let value: boolean | undefined;
      if (condition) {
        const a = readUiLiteral(condition[1]); const b = readUiLiteral(condition[3]);
        if (a !== undefined && b !== undefined && !Array.isArray(a) && !Array.isArray(b) && typeof a !== 'object' && typeof b !== 'object') {
          if (condition[2] === '===') value = a === b;
          else if (condition[2] === '!==') value = a !== b;
          else if (condition[2] === '==') value = a == b;
          else if (condition[2] === '!=') value = a != b;
          else if (typeof a === 'number' && typeof b === 'number') value = condition[2] === '>' ? a > b : condition[2] === '<' ? a < b : condition[2] === '>=' ? a >= b : a <= b;
        }
      } else if (typeof readUiLiteral(opening[2]) === 'boolean') value = readUiLiteral(opening[2]) as boolean;
      if (value !== undefined) replacement = expandUiTemplates(value ? source.slice(bodyStart, alternate ?? end) : alternate !== undefined ? source.slice(alternate + '{:else}'.length, end) : '', protectedRanges, warnings, depth + 1);
    }
    warnings.add('交互组件已保存为静态内容；动态行为请在原对话使用。');
    result += source.slice(from, opening.index) + replacement; from = end + close[0].length;
    if (result.length > 2_000_000) return '【模板展开内容过大，请在原对话查看】';
  }
  return result + source.slice(from);
}
