export type UiRecord = Record<string, unknown>;
export const uiObject = (value: unknown): UiRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UiRecord : undefined;
export const uiScalar = (value: unknown): string => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? String(value) : '';
// Parentheses stay literal: backslash-parentheses are formula delimiters in the
// export renderer. Escaping brackets already prevents injected Markdown links.
export const uiEscape = (value: unknown): string => uiScalar(value).replace(/[\r\n\t]+/g, ' ').replace(/[\\`*_{}\[\]<>!#|~$]/g, '\\$&');
export function uiUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\x00-\x20\x7f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return url.href.replace(/</g, '%3C').replace(/>/g, '%3E');
  } catch { /* Not a public link. */ }
}
export function uiLink(label: string, url: unknown): string {
  const href = uiUrl(url);
  return href ? `[${label}](<${href}>)` : label;
}
const publicField = (key: string) => !/^(_|on[A-Z]|(?:private|internal)[_-]|asset_pointer$|accessToken$|token$|script$|code$|html$|srcDoc$|style$|className$)/.test(key);
export function uiTable(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

// Project structured component data without evaluating its source or depending
// on the component's name. Recognized chart/table schemas retain their meaning.
export function uiData(value: unknown, depth = 0): string {
  if (depth > 32) return '【内容层级过深，请在原对话查看】';
  if (value === null || value === undefined) return '';
  if (!Array.isArray(value) && !uiObject(value)) return uiEscape(value);
  if (Array.isArray(value)) {
    if (!value.length) return '';
    const records = value.map(uiObject);
    if (records.every((item): item is UiRecord => Boolean(item))) {
      const keys = [...new Set(records.flatMap(item => Object.keys(item).filter(publicField)))];
      if (keys.length && records.every(item => keys.every(key => item[key] == null || !Array.isArray(item[key]) && !uiObject(item[key])))) {
        return uiTable(keys.map(uiEscape), records.map(item => keys.map(key => uiEscape(item[key]))));
      }
    }
    return value.map(item => uiData(item, depth + 1)).filter(Boolean).map(text => `- ${text.replace(/\n/g, '\n  ')}`).join('\n');
  }
  const data = value as UiRecord; const meta = uiObject(data.meta);
  const notes = [...new Set([data.title, data.description, data.caption, meta?.title, meta?.subtitle].map(uiEscape).filter(Boolean))];
  const footer = [data.footer, meta?.footer].map(uiEscape).filter(Boolean).join('\n\n');
  const series = Array.isArray(data.series) ? data.series.map(uiObject) : [];
  if (typeof data.xKey === 'string' && series.length && series.every((item): item is UiRecord => typeof item?.dataKey === 'string') &&
      Array.isArray(data.data) && data.data.every(item => Boolean(uiObject(item)))) {
    const xKey = data.xKey;
    const rows = (data.data as UiRecord[]).map(item => [uiEscape(item[xKey]), ...series.map(column => {
      const cell = item[String(column.dataKey)];
      return cell == null ? '—' : uiEscape(column.valuePrefix) + uiEscape(cell) + uiEscape(column.valueSuffix);
    })]);
    const table = uiTable([uiEscape(data.xLabel || xKey), ...series.map(column => uiEscape(column.label || column.dataKey))], rows);
    return [...notes, table, footer].filter(Boolean).join('\n\n');
  }
  const columns = Array.isArray(data.columns) ? data.columns.map(column => typeof column === 'string' ? { key: column, label: column } : uiObject(column)) : [];
  const rows = Array.isArray(data.rows) ? data.rows : data.data;
  if (columns.length && columns.every((column): column is UiRecord => typeof (column?.key ?? column?.dataKey ?? column?.accessorKey) === 'string') && Array.isArray(rows)) {
    const cells = rows.map(row => columns.map((column, index) => uiEscape(Array.isArray(row) ? row[index] : uiObject(row)?.[String(column.key ?? column.dataKey ?? column.accessorKey)])));
    return [...notes, uiTable(columns.map(column => uiEscape(column.label ?? column.header ?? column.key ?? column.dataKey ?? column.accessorKey)), cells), footer].filter(Boolean).join('\n\n');
  }
  return Object.entries(data).filter(([key]) => publicField(key)).map(([key, item]) => {
    const body = uiData(item, depth + 1);
    if (!body) return '';
    if (['title', 'label', 'name', 'description', 'caption', 'text', 'footer', 'subtitle'].includes(key)) return body;
    return `**${uiEscape(key)}**${body.includes('\n') ? '\n\n' : '：'}${body}`;
  }).filter(Boolean).join('\n\n');
}
