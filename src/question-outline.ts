import { visible } from './collector';
import { markdownToHtml } from './markdown-renderer';
import type { Conversation } from './types';

export type OutlineEntry = { element: HTMLElement | null; target: HTMLElement | null; text: string; identity: string };
export type QuestionEntry = OutlineEntry & { element: HTMLElement; target: HTMLElement };
const USER = '[data-message-author-role="user"]';
const ASSISTANT = '[data-message-author-role="assistant"], [data-message-role="assistant"], [data-turn="assistant"]';
const TURN = '[data-testid^="conversation-turn-"], [data-turn]';
const USER_CONTENT = `${USER}, [data-testid="user-message"], .user-message-bubble-color, [data-message-role="user"]`;

function questionText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  const originals = [...element.querySelectorAll('*')]; const copies = [...clone.querySelectorAll('*')];
  originals.forEach((node, index) => {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden') copies[index].remove();
  });
  clone.querySelectorAll('script, style, nav, textarea, [hidden], [aria-hidden="true"], .sr-only').forEach(node => node.remove());
  clone.querySelectorAll('button, [role="button"]').forEach(node => {
    const label = (node.getAttribute('aria-label') || node.textContent || '').trim();
    if (/^(编辑(?:消息)?|复制(?:消息)?|edit(?: message)?|copy(?: message)?)$/i.test(label) || !label) node.remove();
  });
  clone.querySelectorAll('img').forEach(node => node.replaceWith(element.ownerDocument.createTextNode(node.alt || '图片')));
  const walker = element.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT); const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent || '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function collectQuestions(doc: Document): QuestionEntry[] {
  const scope = doc;
  const candidates = new Set<HTMLElement>(scope.querySelectorAll<HTMLElement>(USER_CONTENT));
  for (const turn of scope.querySelectorAll<HTMLElement>(TURN)) {
    if (turn.getAttribute('data-turn') === 'assistant') continue;
    const content = turn.querySelector<HTMLElement>(USER_CONTENT);
    if (!content && turn.querySelector(ASSISTANT)) continue;
    const heading = turn.querySelector('h2, h3, h4, h5, h6, [data-message-role]')?.textContent?.trim() || '';
    if (content || turn.getAttribute('data-turn') === 'user' || /^(you said|you|你说|您说|用户)\s*[:：]?$/i.test(heading)) {
      candidates.add(content || turn.querySelector<HTMLElement>('.whitespace-pre-wrap') || turn);
    }
  }
  const seen = new Set<HTMLElement>(); const entries: QuestionEntry[] = [];
  for (const element of [...candidates].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)) {
    if (element.closest(`nav, aside, form, footer, ${ASSISTANT}`) || element.parentElement?.closest(USER) || !visible(element)) continue;
    const target = element.closest<HTMLElement>(TURN) || element;
    if (seen.has(target)) continue;
    const text = questionText(element);
    if (!text) continue;
    const marker = element.closest('[data-message-id]') || element.querySelector('[data-message-id]') || target.querySelector('[data-message-id]');
    seen.add(target); entries.push({ element, target, text, identity: marker?.getAttribute('data-message-id') || '' });
  }
  return entries;
}

const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();
type SavedQuestion = { text: string; identity: string; aliases: Set<string>; raw: string };
const preparedQuestions = new WeakMap<Conversation, { questions: SavedQuestion[]; answerTexts: Set<string> }>();

export function savedQuestionOutline(data: Conversation, doc: Document): OutlineEntry[] {
  let prepared = preparedQuestions.get(data);
  if (!prepared) {
    const answerTexts = new Set<string>();
    const questions = data.messages.flatMap(message => {
      const template = doc.createElement('template');
      template.innerHTML = message.markdown !== undefined ? markdownToHtml(message.markdown) : message.html;
      template.content.querySelectorAll('img').forEach(img => img.replaceWith(doc.createTextNode(img.alt || '图片')));
      const text = normalized(template.content.textContent || '') || '图片或附件';
      if (message.role !== 'user') {
        answerTexts.add(text); answerTexts.add(normalized(message.markdown || text));
        const walker = doc.createTreeWalker(template.content, NodeFilter.SHOW_TEXT); const parts: string[] = [];
        while (walker.nextNode()) parts.push(walker.currentNode.textContent || '');
        answerTexts.add(normalized(parts.join(' '))); return [];
      }
      const aliases = data.sourceMessageIds?.find(ids => ids.includes(message.id)) || [];
      return [{ text, identity: message.id, aliases: new Set([message.id, ...aliases]), raw: normalized(message.markdown || text) }];
    });
    prepared = { questions, answerTexts }; preparedQuestions.set(data, prepared);
  }
  const saved = prepared.questions;
  const answerTexts = [...prepared.answerTexts];
  const desired = new Set(saved.flatMap(entry => [entry.text, entry.raw]));
  const scopes = [...doc.querySelectorAll<HTMLElement>('main, [role="main"]')].filter(visible);
  const knownQuestions = collectQuestions(doc);
  const candidates = new Set<HTMLElement>(knownQuestions.map(entry => entry.element));
  for (const scope of scopes) {
    scope.querySelectorAll<HTMLElement>('[data-message-id]').forEach(element => candidates.add(element));
    const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      let element = walker.currentNode.parentElement;
      if (!walker.currentNode.textContent?.trim() || element?.closest(`nav, aside, form, button, script, style, ${ASSISTANT}`)) continue;
      for (let depth = 0; element && element !== scope && depth < 4; depth++, element = element.parentElement) {
        if (desired.has(normalized(element.textContent || ''))) candidates.add(element);
      }
    }
  }
  const ordered = [...candidates].filter(element => visible(element) && !element.closest(`nav, aside, form, ${ASSISTANT}`))
    .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const used: HTMLElement[] = [];
  const outline: OutlineEntry[] = saved.map(entry => ({ text: entry.text, identity: entry.identity, element: null, target: null }));
  const targetOf = (element: HTMLElement) => element.closest<HTMLElement>(TURN) || element;
  const overlaps = (a: HTMLElement, b: HTMLElement) => a.contains(b) || b.contains(a);
  const available = () => ordered.filter(element => !used.some(target => overlaps(target, targetOf(element))));
  const bind = (index: number, element: HTMLElement) => {
    const target = targetOf(element);
    outline[index].element = element; outline[index].target = target; used.push(target);
  };
  // Reserve identified messages first, so an earlier repeated text cannot steal their targets.
  saved.forEach((entry, index) => {
    const element = available().find(element => entry.aliases.has(element.getAttribute('data-message-id') || ''));
    if (element) bind(index, element);
  });
  const groups = new Map<string, number[]>();
  saved.forEach((entry, index) => {
    if (outline[index].target) return;
    const group = groups.get(entry.text) || []; group.push(index); groups.set(entry.text, group);
  });
  for (const indices of groups.values()) {
    const texts = new Set(indices.flatMap(index => [saved[index].text, saved[index].raw]));
    const matches: HTMLElement[] = [];
    for (const element of available()) {
      const text = normalized(element.textContent || '');
      const knownUser = knownQuestions.some(question => question.element.contains(element));
      // Unmarked text also appearing in an answer could be a quoted paragraph, not a loaded prompt.
      if (texts.has(text) && (knownUser || !answerTexts.some(answer => answer.includes(text))) && !matches.some(match => overlaps(targetOf(match), targetOf(element)))) matches.push(element);
    }
    // Partial loading makes identical prompts ambiguous. Keep the directory but defer jumping.
    if (matches.length === indices.length) indices.forEach((index, offset) => bind(index, matches[offset]));
  }
  return outline;
}

export function jumpToQuestion(entry: OutlineEntry): boolean {
  if (!entry.target?.isConnected || !visible(entry.target)) return false;
  const oldMargin = entry.target.style.scrollMarginTop;
  entry.target.style.scrollMarginTop = '80px';
  try {
    entry.target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  } finally { entry.target.style.scrollMarginTop = oldMargin; }
  return true;
}
