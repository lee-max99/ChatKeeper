import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import type { Conversation } from './types';
import { documentStyle } from './document-style';
import readerScript from './reader.js?raw';
import { markdownToHtml } from './markdown-renderer';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
function safeUrl(value: string, base: string): string | null {
  try { const url = new URL(value, base); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

// Parse in an inert document; sanitize again after all transformations.
function prepare(html: string, base: string, mode: 'md' | 'html'): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,button,textarea,select,input,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
  doc.querySelectorAll('pre br').forEach(node => node.replaceWith(doc.createTextNode('\n')));
  doc.querySelectorAll('.katex').forEach(node => {
    const math = node.querySelector('math');
    const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    const display = Boolean(node.closest('.katex-display')) || math?.getAttribute('display') === 'block';
    if (mode === 'html' && math) { node.replaceWith(math.cloneNode(true)); return; }
    const replacement = doc.createElement('span');
    replacement.setAttribute('data-math', display ? 'display' : 'inline');
    replacement.textContent = tex || node.textContent || '';
    node.replaceWith(replacement);
  });
  if (mode === 'md') doc.querySelectorAll('math').forEach(node => {
    const replacement = doc.createElement('span');
    replacement.setAttribute('data-math', node.getAttribute('display') === 'block' ? 'display' : 'inline');
    replacement.textContent = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent || node.textContent || '';
    node.replaceWith(replacement);
  });
  doc.querySelectorAll('[class*="whitespace-pre-wrap"]').forEach(node => {
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('pre,code')) texts.push(walker.currentNode as Text);
    for (const text of texts) {
      const lines = text.data.split('\n');
      if (lines.length < 2) continue;
      const fragment = doc.createDocumentFragment();
      lines.forEach((line, index) => { if (index) fragment.append(doc.createElement('br')); fragment.append(line); });
      text.replaceWith(fragment);
    }
  });
  doc.querySelectorAll('img,video,audio').forEach(node => {
    const href = safeUrl(node.getAttribute('src') || '', base);
    const label = node.getAttribute('alt') || node.getAttribute('title') || '媒体文件';
    const replacement = doc.createElement('span');
    replacement.className = 'asset';
    if (href && node.getAttribute('src')) {
      const link = doc.createElement('a'); link.href = href; link.textContent = label; replacement.append(link);
    } else replacement.append(label);
    replacement.append('（资源未嵌入）');
    node.replaceWith(replacement);
  });
  doc.querySelectorAll('a').forEach(node => {
    const href = safeUrl(node.getAttribute('href') || '', base);
    if (href && node.hasAttribute('href')) { node.href = href; node.rel = 'noopener noreferrer'; }
    else node.removeAttribute('href');
    node.removeAttribute('target');
  });
  return DOMPurify.sanitize(doc.body.innerHTML, {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'style', 'link', 'meta', 'base', 'img', 'video', 'audio', 'source'],
    FORBID_ATTR: ['style', 'id', 'name', 'src', 'srcset', 'background', 'autofocus', 'contenteditable'],
  });
}

function markdownService(): TurndownService {
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
  service.addRule('code-block', {
    filter: 'pre',
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const code = element.querySelector('code') || element;
      const source = code.textContent || '';
      const longest = Math.max(2, ...(source.match(/`+/g) || []).map(run => run.length));
      const fence = '`'.repeat(longest + 1);
      const language = (code.className.match(/(?:language|lang)-([\w+-]+)/)?.[1] || element.getAttribute('data-language') || '').replace(/[^\w+-]/g, '');
      return `\n\n${fence}${language}\n${source.replace(/\n$/, '')}\n${fence}\n\n`;
    },
  });
  service.addRule('math', {
    filter: node => node.nodeType === 1 && (node as Element).hasAttribute('data-math'),
    replacement: (_content, node) => (node as Element).getAttribute('data-math') === 'display'
      ? `\n\n$$\n${node.textContent}\n$$\n\n` : `$${node.textContent}$`,
  });
  service.addRule('table', {
    filter: 'table', replacement: (_content, node) => {
      const table = node as HTMLTableElement;
      if (table.querySelector('table,[colspan]:not([colspan="1"]),[rowspan]:not([rowspan="1"])')) return `\n\n${table.outerHTML}\n\n`;
      const rows = [...table.rows].map(row => [...row.cells].map(cell => service.turndown(cell.innerHTML)
        .replace(/\|/g, '\\|').replace(/\s*\n\s*/g, '<br>').trim()));
      if (!rows.length) return '';
      const width = Math.max(...rows.map(row => row.length));
      const hasHeader = Boolean(table.rows[0]?.querySelector('th'));
      const header = hasHeader ? rows.shift()! : Array<string>(width).fill('');
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] || '').join(' | ')} |`;
      return `\n\n${table.caption ? service.turndown(table.caption.innerHTML) + '\n\n' : ''}${[line(header), line(Array<string>(width).fill('---')), ...rows.map(line)].join('\n')}\n\n`;
    },
  });
  service.addRule('strikethrough', { filter: ['del', 's'], replacement: content => `~~${content}~~` });
  return service;
}

function validate(conversation: Conversation): void {
  if (!conversation.messages.length) throw new Error('没有可导出的消息，请刷新对话后重试。');
}

export function renderMarkdown(conversation: Conversation): string {
  validate(conversation);
  const service = markdownService();
  const text = (value: string) => service.escape(value.replace(/\s*\n\s*/g, ' '));
  const source = safeUrl(conversation.url, 'https://chatgpt.com');
  return [`# ${text(conversation.title)}`, `来源：${source ? `<${source}>` : '未知'}`, `导出时间：${text(conversation.exportedAt)}`,
    ...conversation.warnings.map(warning => `> ${text(warning)}`),
    ...conversation.messages.map(message => `## ${message.role === 'user' ? '用户' : 'ChatGPT'}\n\n${message.markdown ?? service.turndown(prepare(message.html, conversation.url, 'md'))}`),
  ].join('\n\n') + '\n';
}

export function renderHtml(conversation: Conversation): string {
  validate(conversation);
  const source = safeUrl(conversation.url, 'https://chatgpt.com');
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const outline: string[] = [];
  let question = 0;
  const messages = conversation.messages.map((message, index) => {
    const doc = new DOMParser().parseFromString(prepare(message.markdown !== undefined ? markdownToHtml(message.markdown) : message.html, conversation.url, 'html'), 'text/html');
    const anchor = `message-${index + 1}`;
    if (message.role === 'user') {
      question++;
      const text = (doc.body.textContent || '附件消息').replace(/\s+/g, ' ').trim();
      outline.push(`<li><a href="#${anchor}" title="${escapeHtml(text.slice(0, 400))}"><span class="ordinal">${String(question).padStart(2, '0')}</span>${escapeHtml(text.slice(0, 80))}${text.length > 80 ? '…' : ''}</a></li>`);
    }
    doc.querySelectorAll('h1,h2,h3').forEach((heading, headingIndex) => {
      heading.id = `${anchor}-heading-${headingIndex + 1}`;
      outline.push(`<li class="subheading"><a href="#${heading.id}">${escapeHtml((heading.textContent || '').slice(0, 100))}</a></li>`);
    });
    return `<article id="${anchor}" class="message ${message.role}"><div class="role">${message.role === 'user' ? '你' : 'ChatGPT'}</div><div class="body">${doc.body.innerHTML}</div></article>`;
  });
  const date = new Date(conversation.exportedAt);
  const exportedAt = Number.isNaN(date.getTime()) ? conversation.exportedAt : date.toLocaleString('zh-CN', { hour12: false });
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(conversation.title)}</title><style>${documentStyle}</style></head><body class="outline-open">
<button id="menu-toggle" class="menu-toggle" type="button" aria-label="切换目录" aria-expanded="true" aria-controls="outline-panel">☰</button>
<button id="backdrop" class="backdrop" type="button" aria-label="关闭目录"></button>
<aside id="outline-panel" class="sidebar"><a class="sidebar-brand" href="#top"><svg class="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4.5h14v11H10l-5 4v-15Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 8h6M9 11.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>ChatKeeper</a>
<div class="sidebar-title">${escapeHtml(conversation.title)}</div>
<div class="search-tools"><label class="sr-only" for="reader-search">搜索对话</label><div class="search-field"><span aria-hidden="true">⌕</span><input id="reader-search" type="search" placeholder="搜索对话…" autocomplete="off"><button id="clear-search" type="button" aria-label="清除搜索">×</button></div>
<div class="search-meta"><span id="search-count" role="status">${conversation.messages.length} 条消息</span><div><button id="previous-match" type="button" aria-label="上一个匹配" disabled>↑</button> <button id="next-match" type="button" aria-label="下一个匹配" disabled>↓</button></div></div></div>
<div class="outline-label">目录 · ${question} 个问题</div><nav id="outline" class="outline" aria-label="对话目录"><ol>${outline.join('')}</ol></nav><div class="sidebar-footer">离线阅读 · Ctrl / ⌘ K 搜索</div></aside>
<main id="top" class="content"><div class="content-inner"><header class="content-header"><div class="eyebrow">CHATGPT CONVERSATION</div><h1>${escapeHtml(conversation.title)}</h1>
<div class="meta"><span>导出于 ${escapeHtml(exportedAt)}</span><span>${conversation.messages.length} 条消息</span>${source ? `<a href="${escapeHtml(source)}" rel="noopener noreferrer">原始对话 ↗</a>` : ''}</div>
${conversation.warnings.length ? `<div class="notice">${conversation.warnings.map(warning => `<p>${escapeHtml(warning)}</p>`).join('')}</div>` : ''}</header>
<p id="empty" class="empty" hidden>没有匹配的消息</p><div id="messages">${messages.join('\n')}</div>
<footer class="document-footer"><span>由 ChatKeeper 导出</span><a href="#top">回到顶部 ↑</a></footer></div></main>
<script nonce="${nonce}">${readerScript}</script></body></html>`;
}

export function safeFilename(title: string, extension: 'md' | 'html'): string {
  let name = title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '');
  name = [...name].slice(0, 100).join('') || 'ChatGPT 对话';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name}.${extension}`;
}
