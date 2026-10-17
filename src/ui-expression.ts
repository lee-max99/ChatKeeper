import { readUiLiteral } from './ui-literal';

export type UiBindings = ReadonlyMap<string, unknown>;
const forbidden = new Set(['__proto__','prototype','constructor']);
const primitive = (value: unknown) => value === null || ['string','boolean','number'].includes(typeof value);

// Data-only expressions: no calls, globals, prototype traversal or assignments.
export function uiExpression(source: string, bindings: UiBindings): {ok:true;value:unknown} | {ok:false} {
  try {
    if (source.length > 4096) throw new Error();
    const literal = readUiLiteral(source);if (literal !== undefined) return {ok:true,value:literal};
    const tokens: string[] = [];
    const lexer = /\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*|===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|[.\[\]()!+\-*/%<>?:])/y;
    let offset = 0;
    while (source.slice(offset).trim()) {
      lexer.lastIndex = offset;const token = lexer.exec(source);if (!token || tokens.length > 256) throw new Error();
      tokens.push(token[1]);offset = lexer.lastIndex;
    }
    let pos = 0;
    const precedence: Record<string,number> = {'||':1,'&&':2,'==':3,'!=':3,'===':3,'!==':3,'<':4,'>':4,'<=':4,'>=':4,'+':5,'-':5,'*':6,'/':6,'%':6};
    const expect = (value: string) => {if (tokens[pos++] !== value) throw new Error();};
    function atom(depth: number): unknown {
      if (depth > 32) throw new Error();
      const token = tokens[pos++];let value: unknown;
      if (['!','-','+'].includes(token)) {
        const next = atom(depth + 1);
        if (token === '!') value = !next;
        else if (typeof next === 'number') value = token === '-' ? -next : next;
        else throw new Error();
      } else if (token === '(') {value = expression(0,depth + 1);expect(')');}
      else if (bindings.has(token) && !forbidden.has(token)) value = bindings.get(token);
      else {value = readUiLiteral(token || '');if (value === undefined) throw new Error();}
      while (tokens[pos] === '.' || tokens[pos] === '[') {
        let key: unknown;
        if (tokens[pos++] === '.') key = tokens[pos++];
        else {key = expression(0,depth + 1);expect(']');}
        if (!['string','number'].includes(typeof key) || forbidden.has(String(key)) || value === null || value === undefined) throw new Error();
        if (typeof value === 'string' && key === 'length') value = value.length;
        else if (typeof value === 'object' && Object.hasOwn(value,String(key))) value = (value as Record<string,unknown>)[String(key)];
        else throw new Error();
      }
      return value;
    }
    function expression(min: number, depth: number): unknown {
      if (depth > 32) throw new Error();
      let left = atom(depth + 1);
      while ((precedence[tokens[pos]] || 0) > min) {
        const op = tokens[pos++];const right = expression(precedence[op],depth + 1);
        if (!primitive(left) || !primitive(right)) throw new Error();
        if (op === '===' || op === '==') left = op === '===' ? left === right : left == right;
        else if (op === '!==' || op === '!=') left = op === '!==' ? left !== right : left != right;
        else if (op === '&&') left = left && right;
        else if (op === '||') left = left || right;
        else if (typeof left === 'number' && typeof right === 'number') left = op === '+' ? left + right : op === '-' ? left - right : op === '*' ? left * right : op === '/' ? left / right : op === '%' ? left % right : op === '<' ? left < right : op === '>' ? left > right : op === '<=' ? left <= right : left >= right;
        else if (op === '+' && (typeof left === 'string' || typeof right === 'string')) left = String(left) + String(right);
        else throw new Error();
        if (typeof left === 'number' && !Number.isFinite(left)) throw new Error();
      }
      if (min === 0 && tokens[pos] === '?') {pos++;const yes = expression(0,depth + 1);expect(':');const no = expression(0,depth + 1);left = left ? yes : no;}
      return left;
    }
    const value = expression(0,0);if (pos !== tokens.length) throw new Error();
    return {ok:true,value};
  } catch {return {ok:false};}
}
