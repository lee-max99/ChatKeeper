import { assertNotGenerating, visible } from './collector';
import { conversationId } from './conversation-api';
import type { Conversation, PageInfo } from './types';
import { uniqueMessageIds } from './message-identity';

const ROLE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';
function displayedMessageIds(doc: Document): string[] {
  const roles = [...doc.querySelectorAll(ROLE_SELECTOR)].filter(visible);
  const markers = [...doc.querySelectorAll('[data-message-id]')].filter(node => {
    if (!node.getAttribute('data-message-id') || !visible(node)) return false;
    // The exact saved ID can live inside or outside the element carrying the
    // role. Only borrow an ancestor marker if it wraps one logical message.
    if (node.closest(ROLE_SELECTOR)) return true;
    const children = [...node.querySelectorAll(ROLE_SELECTOR)].filter(visible);
    if (children.length) return children.every(child =>
      children[0].contains(child) && child.getAttribute('data-message-author-role') === children[0].getAttribute('data-message-author-role'));
    // Explicit conversation turns supply message context when role attributes
    // are missing. Arbitrary IDs in navigation or unrelated page UI are ignored.
    return Boolean(node.closest(TURN_SELECTOR));
  });
  // Incomplete page metadata is not a reason to block API export. Treat the
  // whole set as unavailable rather than selecting a reply from partial hints.
  if (roles.some(role => !markers.some(marker => role.contains(marker) || marker.contains(role)))) return [];
  return uniqueMessageIds(markers.map(node => node.getAttribute('data-message-id')!));
}

export function pageInfo(doc: Document, url: string): PageInfo {
  conversationId(url);
  let generating = false;
  try { assertNotGenerating(doc); } catch { generating = true; }
  return { url, title: doc.title.replace(/\s*[-–—|]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT 对话', generating,
    visibleIds: displayedMessageIds(doc),
  };
}

export function validatePage(data: Conversation, info: PageInfo): void {
  if (info.generating) throw new Error('回答还在生成，请等待结束后重试。');
  if (data.url !== info.url) throw new Error('对话已切换，请重新打开 ChatKeeper。');
}
