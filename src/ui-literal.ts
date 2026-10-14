// A data-only subset of JSX literals: objects, arrays, quoted strings, finite
// numbers, booleans and null. No identifiers as values, calls or operators.
export function readUiLiteral(source: string): unknown {
  let pos = 0;
  const space = () => { while (pos < source.length && /\s/.test(source[pos])) pos++; };
  const fail = (): never => { throw new Error('Not a static data literal'); };
  function string(): string {
    const quote = source[pos++]; let text = '';
    while (pos < source.length) {
      let char = source[pos++];
      if (char === quote) return text;
      if (char === '\n' || char === '\r') fail();
      if (char !== '\\') { text += char; continue; }
      char = source[pos++];
      const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '/': '/' };
      if (Object.hasOwn(escapes, char)) text += escapes[char];
      else if (char === 'u') {
        const hex = source.slice(pos, pos + 4);
        if (!/^[\da-f]{4}$/i.test(hex)) fail();
        text += String.fromCharCode(parseInt(hex, 16)); pos += 4;
      } else fail();
    }
    return fail();
  }
  function value(depth = 0): unknown {
    if (depth > 64) fail();
    space(); const first = source[pos];
    if (first === '"' || first === "'") return string();
    if (first === '{' || first === '[') {
      const object = first === '{'; const close = object ? '}' : ']'; pos++;
      const entries: Record<string, unknown> = Object.create(null); const items: unknown[] = [];
      space();
      while (source[pos] !== close) {
        if (object) {
          space(); let key: string;
          if (source[pos] === '"' || source[pos] === "'") key = string();
          else {
            const match = source.slice(pos).match(/^[A-Za-z_$][\w$]*/);
            if (!match) return fail();
            key = match[0]; pos += key.length;
          }
          space(); if (source[pos++] !== ':') fail();
          entries[key] = value(depth + 1);
        } else items.push(value(depth + 1));
        space();
        if (source[pos] === close) break;
        if (source[pos++] !== ',') fail();
        space();
      }
      pos++; return object ? entries : items;
    }
    const scalar = source.slice(pos).match(/^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!scalar) return fail();
    pos += scalar.length;
    const parsed: unknown = JSON.parse(scalar);
    if (typeof parsed === 'number' && !Number.isFinite(parsed)) fail();
    return parsed;
  }
  try { const result = value(); space(); return pos === source.length ? result : undefined; }
  catch { return undefined; }
}
