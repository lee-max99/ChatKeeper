import { afterEach, expect, it, vi } from 'vitest';
import { normalizeConversation, readConversation } from '../src/conversation-api';
import { renderHtml, renderMarkdown } from '../src/exporters';
import { pageInfo, validatePage } from '../src/page-info';
const url = 'https://chatgpt.com/c/test-conversation';
function node(id: string, parent: string | null, role: string, text: string, extra = {}) {
  return { id, parent, message: { id, author: { role }, status: 'finished_successfully', content: { content_type: 'text', parts: [text] }, ...extra } };
}
function data() {
  return { title: '完整对话', current_node: 'a2', mapping: {
    a2: node('a2', 'u2', 'assistant', '**新回答**'),
    old: node('old', 'u1', 'assistant', '旧分支'),
    u2: node('u2', 'a1', 'user', '重复问题'),
    root: { id: 'root', parent: null, message: null },
    a1: node('a1', 'u1', 'assistant', '第一条回答'),
    u1: node('u1', 'root', 'user', '重复问题'),
  } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
it('recognizes message IDs on a parent or child of the role element', () => {
  document.body.innerHTML = '<main><article data-message-id="u2"><div data-message-author-role="user">问题</div></article><div data-message-author-role="assistant"><div data-message-id="a2">回答</div></div></main>';
  const info = pageInfo(document, url);
  expect(info.visibleIds).toEqual(['u2', 'a2']);
  const result = normalizeConversation(data(), url, info.visibleIds);
  expect(result.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  expect(() => validatePage(result, info)).not.toThrow();
});
it('recognizes IDs inside explicit conversation turns when role attributes are absent', () => {
  document.body.innerHTML = '<nav data-message-id="unrelated">导航</nav><main><article data-testid="conversation-turn-2"><div data-message-id="u2">问题</div></article><article data-testid="conversation-turn-3"><div data-message-id="a2">回答</div></article></main>';
  expect(pageInfo(document, url).visibleIds).toEqual(['u2', 'a2']);
});
it('does not borrow a common container ID for different messages', () => {
  document.body.innerHTML = '<main data-message-id="u2"><div data-message-author-role="user">问题</div><div data-message-author-role="assistant">回答</div></main>';
  expect(pageInfo(document, url).visibleIds).toEqual([]);
});
it('treats partial page identity as optional instead of blocking export', () => {
  document.body.innerHTML = '<main><div data-message-author-role="user" data-message-id="u2">问题</div><div data-message-author-role="assistant">回答</div></main>';
  const info = pageInfo(document, url);
  expect(info.visibleIds).toEqual([]);
  const result = normalizeConversation(data(), url, info.visibleIds);
  expect(result.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  expect(() => validatePage(result, info)).not.toThrow();
});
it('keeps the generation guard when an unfinished answer has no ID yet', () => {
  document.body.innerHTML = '<div data-message-author-role="user" data-message-id="u2">问题</div><div data-message-author-role="assistant" data-is-streaming="true">正在生成</div>';
  expect(pageInfo(document, url).generating).toBe(true);
});
it('ignores hidden IDs and arbitrary IDs outside recognizable messages', () => {
  document.body.innerHTML = '<main><div data-message-id="unrelated">别的内容</div><article hidden data-testid="conversation-turn-0"><div data-message-id="old">旧回答</div></article><article data-testid="conversation-turn-3"><div data-message-author-role="assistant"><span data-message-id="a2">回答</span></div></article></main>';
  expect(pageInfo(document, url).visibleIds).toEqual(['a2']);
});
it('exports the displayed conversation when the same message has duplicate DOM wrappers', () => {
  document.body.innerHTML = '<main><div data-message-author-role="user" data-message-id="u2">问题</div><div data-message-author-role="assistant" data-message-id="a2"><div data-message-author-role="assistant" data-message-id="a2">回答</div></div></main>';
  const info = pageInfo(document, url);
  const result = normalizeConversation(data(), url, info.visibleIds);
  expect(result.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  expect(() => validatePage(result, info)).not.toThrow();
});
it('recognizes mapping node IDs and message IDs as aliases throughout export validation', () => {
  const raw = data(); raw.mapping.a2.message.id = 'saved-answer-id';
  const result = normalizeConversation(raw, url, ['u2', 'a2']);
  expect(result.messages.at(-1)?.id).toBe('saved-answer-id');
  expect(() => validatePage(result, { title: '标题', url, generating: false, visibleIds: ['u2', 'a2', 'saved-answer-id'] })).not.toThrow();
});
it('does not treat auxiliary-only continuations as different exportable conversations', () => {
  const raw = { ...data(), mapping: { ...data().mapping,
    recap1: node('recap1', 'old', 'assistant', '', { content: { content_type: 'reasoning_recap' } }),
    recap2: node('recap2', 'old', 'assistant', '', { content: { content_type: 'reasoning_recap' } }),
  } };
  expect(normalizeConversation(raw, url, ['u1', 'old']).messages.map(m => m.id)).toEqual(['u1', 'old']);
});
it('validates visible auxiliary records without putting their text in the exported document', () => {
  const raw = { title: '测试', current_node: 'a', mapping: {
    u: node('u', null, 'user', '问题'),
    recap: node('recap', 'u', 'assistant', '', { content: { content_type: 'reasoning_recap', text: 'do-not-export' } }),
    a: node('a', 'recap', 'assistant', '回答'),
  } };
  const result = normalizeConversation(raw, url, ['u', 'recap', 'a']);
  expect(result.messages.map(m => m.id)).toEqual(['u', 'a']);
  expect(() => validatePage(result, { title: '测试', url, generating: false, visibleIds: ['u', 'recap', 'a'] })).not.toThrow();
  expect(renderMarkdown(result)).not.toContain('do-not-export');
});
it('uses an identified displayed conversation even when an unrelated current pointer is broken', () => {
  expect(normalizeConversation({ ...data(), current_node: 'unrelated-missing' }, url, ['u1', 'old']).messages.map(m => m.id)).toEqual(['u1', 'old']);
});
it('uses the saved current version when page hints are ambiguous or inconsistent', () => {
  const raw = { ...data(), mapping: { ...data().mapping,
    followup1: node('followup1', 'old', 'user', '不应猜选一'),
    followup2: node('followup2', 'old', 'user', '不应猜选二'),
  } };
  for (const result of [normalizeConversation(raw, url, ['u1', 'old']), normalizeConversation(data(), url, ['a2', 'old'])]) {
    expect(result.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(result.warnings.join('')).toContain('保存的当前版本');
  }
});
it('retries a briefly stale saved record without exporting another conversation', async () => {
  vi.useFakeTimers();
  let reads = 0;
  vi.stubGlobal('fetch', async (input: string) => {
    if (input.endsWith('/session')) return new Response(JSON.stringify({ accessToken: 'fixture-only' }));
    reads++;
    const raw = data();
    return new Response(JSON.stringify(reads === 1 ? { ...raw, current_node: 'old', mapping: { root: raw.mapping.root, u1: raw.mapping.u1, old: raw.mapping.old } } : raw));
  });
  const pending = readConversation(url, ['u2', 'a2'], new AbortController().signal);
  const result = pending.then(data => ({ data, error: undefined }), error => ({ data: undefined, error }));
  await vi.advanceTimersByTimeAsync(5000);
  expect((await result).error).toBeUndefined();
  expect((await result).data?.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
});
it('exports the saved current version after bounded retries for unknown page IDs', async () => {
  vi.useFakeTimers(); let reads = 0;
  vi.stubGlobal('fetch', async (input: string) => {
    if (input.endsWith('/session')) return new Response(JSON.stringify({ accessToken: 'fixture-only' }));
    reads++; return new Response(JSON.stringify(data()));
  });
  const result = readConversation(url, ['unknown-message'], new AbortController().signal).then(data => ({ data, error: undefined }), error => ({ data: undefined, error }));
  await vi.advanceTimersByTimeAsync(5000);
  expect((await result).error).toBeUndefined();
  expect((await result).data?.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  expect((await result).data?.warnings.join('')).toContain('保存的当前版本');
  expect(reads).toBe(3);
});
it('cancels while waiting to retry and does not send another conversation request', async () => {
  vi.useFakeTimers(); let reads = 0;
  vi.stubGlobal('fetch', async (input: string) => {
    if (input.endsWith('/session')) return new Response(JSON.stringify({ accessToken: 'fixture-only' }));
    reads++; return new Response(JSON.stringify(data()));
  });
  const controller = new AbortController();
  const result = readConversation(url, ['unknown-message'], controller.signal).then(data => ({ data, error: undefined }), error => ({ data: undefined, error }));
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await vi.advanceTimersByTimeAsync(5000);
  expect((await result).data).toBeUndefined();
  expect((await result).error?.message).toContain('取消');
  expect(reads).toBe(1);
});
it('omits thoughts and reasoning recaps without losing surrounding replies or following another branch', () => {
  const raw = { title: '正文筛选', current_node: 'recap', mapping: {
    u: node('u', null, 'user', '解释 thoughts 和 reasoning_recap 的意思'),
    progress: node('progress', 'u', 'assistant', '我会先对比代码。', { channel: 'commentary' }),
    thought: node('thought', 'progress', 'assistant', '', { content: { content_type: 'thoughts', thoughts: [] } }),
    thoughtText: node('thoughtText', 'thought', 'assistant', '', { content: { content_type: 'thoughts', text: 'internal-only-fixture' } }),
    answer: node('answer', 'thoughtText', 'assistant', '最终结论。', { channel: 'final' }),
    recap: node('recap', 'answer', 'assistant', '', { content: { content_type: 'reasoning_recap', content: 'internal-recap-fixture' } }),
    other: node('other', 'u', 'assistant', 'unselected-branch-fixture'),
  } };
  const result = normalizeConversation(raw, url, ['u', 'progress', 'answer']);
  expect(result.messages.map(message => message.id)).toEqual(['u', 'progress', 'answer']);
  expect(result.warnings).toEqual([]);
  for (const output of [renderMarkdown(result), renderHtml(result)]) {
    expect(output).toContain('解释 thoughts 和 reasoning_recap 的意思');
    expect(output).toContain('我会先对比代码。');
    expect(output).toContain('最终结论。');
    expect(output).not.toMatch(/非文本消息|internal-only-fixture|internal-recap-fixture|unselected-branch-fixture/);
  }
});
it('preserves indentation and whitespace in original Markdown', () => {
  const raw = data();
  raw.mapping.a2.message.content.parts = ['    indented code\n    second line\n'];
  expect(normalizeConversation(raw, url).messages.at(-1)?.markdown).toBe('    indented code\n    second line\n');
});
it('uses parent order, preserves repeated questions and excludes unselected branches', () => {
  const result = normalizeConversation(data(), url, ['u2', 'a2']);
  expect(result.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  expect(result.messages[3].markdown).toBe('**新回答**');
  expect(result.source).toBe('api');
  expect(result.warnings).toEqual([]);
});
it('exports 1000 messages while only the final two are present on the page', () => {
  const mapping: Record<string, unknown> = { root: { id: 'root', parent: null, message: null } };
  for (let i = 0; i < 1000; i++) mapping[`m${i}`] = node(`m${i}`, i ? `m${i - 1}` : 'root', i % 2 ? 'assistant' : 'user', `消息 ${i}`);
  const result = normalizeConversation({ title: '长对话', current_node: 'm999', mapping }, url, ['m998', 'm999']);
  expect(result.messages).toHaveLength(1000);
  expect(result.messages[0].markdown).toBe('消息 0');
  expect(result.messages[999].markdown).toBe('消息 999');
});
it('selects an unambiguous displayed branch when it differs from current_node', () => {
  expect(normalizeConversation(data(), url, ['u1', 'old']).messages.map(m => m.id)).toEqual(['u1', 'old']);
});
it('exports only the saved current path when page IDs cannot be mapped', () => {
  const result = normalizeConversation(data(), url, ['not-in-response']);
  expect(result.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  expect(renderMarkdown(result)).not.toContain('旧分支');
});
it('allows metadata changes within a conversation but still detects navigation and generation', () => {
  const result = normalizeConversation(data(), url);
  expect(() => validatePage(result, { title: '', url, generating: false, visibleIds: ['different-dom-id'] })).not.toThrow();
  expect(() => validatePage(result, { title: '', url: 'https://chatgpt.com/c/another', generating: false, visibleIds: [] })).toThrow(/切换/);
  expect(() => validatePage(result, { title: '', url, generating: true, visibleIds: [] })).toThrow(/生成/);
});
it('rejects broken parent chains, cycles and missing current nodes', () => {
  const broken = data(); broken.mapping.a1.parent = 'missing';
  expect(() => normalizeConversation(broken, url)).toThrow(/完整/);
  const cycle = data(); cycle.mapping.u1.parent = 'a2';
  expect(() => normalizeConversation(cycle, url)).toThrow(/结构/);
  expect(() => normalizeConversation({ ...data(), current_node: 'missing' }, url)).toThrow(/完整/);
});
it('omits hidden system, tool and analysis messages without exposing them', () => {
  const raw = { title: '过滤', current_node: 'a', mapping: {
    s: node('s', null, 'system', 'secret'), u: node('u', 's', 'user', '问题'),
    thought: node('thought', 'u', 'assistant', 'private reasoning', { channel: 'analysis' }),
    tool: node('tool', 'thought', 'tool', 'internal raw output'), a: node('a', 'tool', 'assistant', '最终回答'),
  } };
  expect(normalizeConversation(raw, url).messages.map(m => m.markdown)).toEqual(['问题', '最终回答']);
});
it.each(['in_progress', 'pending', 'streaming'])('exports saved contents with a notice instead of blocking on a stale API status (%s)', status => {
  const stale = data(); stale.mapping.a2.message.status = status; stale.mapping.a1.message.status = status;
  const result = normalizeConversation(stale, url);
  expect(result.messages.map(message => message.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  expect(result.messages.at(-1)?.markdown).toBe('**新回答**');
  expect(result.warnings.filter(warning => warning.includes('未完成标记'))).toHaveLength(1);
  expect(renderMarkdown(result)).toContain('未完成标记');
  expect(renderHtml(result)).toContain('未完成标记');
  expect(() => validatePage(result, { title: '', url, visibleIds: [], generating: true })).toThrow(/生成/);
});
it('does not let an old pending user message block subsequent completed replies', () => {
  const stale = data(); stale.mapping.u1.message.status = 'pending';
  const result = normalizeConversation(stale, url);
  expect(result.messages).toHaveLength(4); expect(result.warnings.join('')).toContain('未完成标记');
});
it('keeps non-text attachments visible', () => {
  const raw = { title: '附件', current_node: 'u', mapping: { u: node('u', null, 'user', '', {
    content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-1' }] },
    metadata: { attachments: [{ name: 'notes.pdf' }] },
  }) } };
  const result = normalizeConversation(raw, url);
  expect(result.messages[0].markdown).toContain('图片');
  expect(result.messages[0].markdown).toContain('notes.pdf');
  expect(result.warnings.join('')).toContain('附件');
});
it('reads only same-origin first-party endpoints and never returns the access token', async () => {
  const requests: Array<{ url: string; options?: RequestInit }> = [];
  vi.stubGlobal('fetch', async (input: string, options?: RequestInit) => {
    requests.push({ url: input, options });
    return new Response(JSON.stringify(input.endsWith('/api/auth/session') ? { accessToken: 'fixture-secret' } : data()), { status: 200 });
  });
  const result = await readConversation(url, [], new AbortController().signal);
  expect(requests.map(r => r.url)).toEqual(['https://chatgpt.com/api/auth/session', 'https://chatgpt.com/backend-api/conversation/test-conversation']);
  expect(new Headers(requests[1].options?.headers).get('Authorization')).toBe('Bearer fixture-secret');
  expect(JSON.stringify(result)).not.toContain('fixture-secret');
});
it('rejects 401/403 and cancellation without returning a partial DOM snapshot', async () => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
  await expect(readConversation(url, [], new AbortController().signal)).rejects.toThrow(/登录/);
  const controller = new AbortController(); controller.abort();
  await expect(readConversation(url, [], controller.signal)).rejects.toThrow(/取消/);
});
