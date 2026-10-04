import { expect, it } from 'vitest';
import { selectQuestionGroups } from '../src/conversation-selection';
import { renderHtml, renderMarkdown } from '../src/exporters';
import type { ChatMessage, Conversation } from '../src/types';

const message = (id: string, role: ChatMessage['role'], markdown = id): ChatMessage => ({ id, role, markdown, html: '', stable: true });
const data = (): Conversation => ({ title: '聊天', url: 'https://chatgpt.com/c/test', exportedAt: '2026-10-04', source: 'api', warnings: ['保存版本'],
  messages: [message('orphan', 'assistant'), message('u1', 'user'), message('a1', 'assistant'), message('a1-final', 'assistant'), message('u2', 'user'), message('a2', 'assistant'), message('u3', 'user'), message('a3', 'assistant'), message('u4', 'user')],
  sourceMessageIds: [['hidden-system'], ['orphan'], ['u1', 'node1'], ['a1'], ['a1-final'], ['u2'], ['a2'], ['u3'], ['a3'], ['u4']],
});

it('exports noncontiguous Q&A groups in original order with all associated answers, without mutating the full conversation', () => {
  const full = data(); const original = structuredClone(full);
  const result = selectQuestionGroups(full, [full.messages[6], full.messages[1]]);
  expect(result.messages.map(item => item.id)).toEqual(['u1', 'a1', 'a1-final', 'u3', 'a3']);
  expect(result.sourceMessageIds).toEqual([['u1', 'node1'], ['a1'], ['a1-final'], ['u3'], ['a3']]);
  expect(result.warnings).toContain('部分导出：已选择 2 / 4 组问答。');
  expect(result.warnings).toContain('保存版本'); expect(result.title).toBe(full.title); expect(result.url).toBe(full.url);
  expect(full).toEqual(original);
});

it('can export the last question before it has any saved assistant answer', () => {
  const full = data(); expect(selectQuestionGroups(full, [full.messages[8]]).messages.map(item => item.id)).toEqual(['u4']);
});

it('keeps identical question text separate by message ID and deduplicates repeated selection IDs', () => {
  const full = data(); full.messages[1].markdown = full.messages[4].markdown = '重复提问';
  expect(selectQuestionGroups(full, [full.messages[4], full.messages[4]]).messages.map(item => item.id)).toEqual(['u2', 'a2']);
});

it.each(['empty', 'missing', 'edited', 'assistant'])('rejects %s selection instead of exporting the whole path or a different group', kind => {
  const full = data();
  const choices = kind === 'empty' ? [] : kind === 'missing' ? [full.messages[1], message('removed', 'user')] :
    kind === 'edited' ? [{ ...full.messages[1], markdown: '旧提问' }] : [full.messages[2]];
  expect(() => selectQuestionGroups(full, choices)).toThrow(kind === 'empty' ? /请选择/ : /已变化/);
});

it('renders only the selected content and its notice in both export formats', () => {
  const full = data(); const selected = selectQuestionGroups(full, [full.messages[6]]);
  expect(renderMarkdown(selected)).toContain('\n\nu3\n'); expect(renderMarkdown(selected)).not.toContain('\n\nu1\n');
  const doc = new DOMParser().parseFromString(renderHtml(selected), 'text/html');
  expect([...doc.querySelectorAll('article .body')].map(node => node.textContent?.trim())).toEqual(['u3', 'a3']);
  expect(doc.querySelectorAll('.sidebar li:not(.subheading)')).toHaveLength(1);
  expect(doc.body.textContent).toContain('部分导出：已选择 1 / 4 组问答。');
});
