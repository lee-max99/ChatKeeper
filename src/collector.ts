import type { Conversation, ChatMessage } from './types';

export const SCOPE_WARNING = '完整性未验证：仅保存实际采集到的当前分支消息，不包含其他分支或未加载内容。';
const nodeIds = new WeakMap<Element, string>();
let nextId = 0;

export function assertChatGPT(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'chatgpt.com') {
    throw new Error('请先打开 https://chatgpt.com 中的 ChatGPT 对话。');
  }
}

export function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}

export function assertNotGenerating(doc: Document): void {
  const indicators = doc.querySelectorAll('[data-testid="stop-button"], [data-testid="stop-generating-button"], button[aria-label="Stop generating"], button[aria-label="停止生成"], [data-is-streaming="true"]');
  if ([...indicators].some(visible)) throw new Error('回答还在生成，请等待结束后重试。');
}

function extractMessage(element: Element): ChatMessage {
  const clone = element.cloneNode(true) as Element;
  const originals = [...element.querySelectorAll('*')];
  const copies = [...clone.querySelectorAll('*')];
  originals.forEach((original, index) => {
    // MathML annotations are intentionally display:none but carry the TeX source.
    if (original.closest('math')) return;
    const style = original.ownerDocument.defaultView?.getComputedStyle(original);
    if (style?.display === 'none' || style?.visibility === 'hidden') copies[index].remove();
  });
  clone.querySelectorAll('script, style, nav, textarea, [hidden], [aria-hidden="true"], [data-testid="copy-turn-action-button"]').forEach(node => node.remove());
  clone.querySelectorAll('button, [role="button"]').forEach(node => {
    const label = (node.getAttribute('aria-label') || node.textContent || '').trim();
    const action = /^(复制(?:代码|回答)?|点赞|点踩|编辑(?:消息)?|重新生成|朗读|分享|copy(?: code| response)?|good response|bad response|edit(?: message)?|read aloud|share|regenerate)$/i.test(label);
    if (node.closest('pre') || action || (!label && !node.querySelector('img,video,audio,a'))) { node.remove(); return; }
    // Attachment cards and citations can themselves be buttons; retain their
    // contents as inert text/links rather than silently deleting the turn.
    const replacement = element.ownerDocument.createElement('span');
    replacement.append(...node.childNodes); node.replaceWith(replacement);
  });
  const turn = element.closest('[data-testid^="conversation-turn-"]');
  const stableId = element.getAttribute('data-message-id') || (turn ? `${turn.getAttribute('data-testid')}:${element.getAttribute('data-message-author-role')}` : '');
  if (!nodeIds.has(element)) nodeIds.set(element, `node-${++nextId}`);
  return {
    id: stableId || nodeIds.get(element)!, stable: Boolean(stableId),
    role: element.getAttribute('data-message-author-role') as ChatMessage['role'], html: clone.innerHTML,
  };
}

export function collectSnapshot(doc: Document, url: string): Conversation {
  assertChatGPT(url);
  assertNotGenerating(doc);
  const messages = [...doc.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')]
    .filter(visible).map(extractMessage).filter(message => message.html.trim());
  if (!messages.length) throw new Error('未识别到对话内容。请打开具体对话并等待加载，再重试。');
  const warnings = [SCOPE_WARNING, '图片与附件仅保留可用链接和说明，未嵌入文件。'];
  if (messages.some(message => !message.stable)) warnings.push('部分消息没有稳定标识；滚动补采时可能无法可靠识别虚拟列表中的重复消息。');
  return {
    title: doc.title.replace(/\s*[-–—|]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT 对话',
    url, exportedAt: new Date().toISOString(), messages, warnings,
  };
}
