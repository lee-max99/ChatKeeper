import { afterEach, expect, it, vi } from 'vitest';
import { collectQuestions, jumpToQuestion, savedQuestionOutline } from '../src/question-outline';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('lists current questions in order, retaining repeated prompts while excluding answers, hidden branches and navigation', () => {
  document.body.innerHTML = `<aside><div data-message-author-role="user">侧栏文字</div></aside><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user"><h5 class="sr-only">You said:</h5><div>问题 一<button>编辑</button><span hidden>隐藏文字</span></div><div data-message-author-role="user">补充</div></div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">回答</div></article>
    <article data-testid="conversation-turn-2"><div data-message-author-role="user">问题 一 补充</div></article>
    <article hidden><div data-message-author-role="user">旧分支</div></article>
    <article style="display:none"><div data-message-author-role="user">未显示分支</div></article>
    <form><div data-message-author-role="user">输入框</div></form>
  </main>`;
  const questions = collectQuestions(document);
  expect(questions.map(item => item.text)).toEqual(['问题 一 补充', '问题 一 补充']);
  expect(questions[0].target).toBe(document.querySelector('[data-testid="conversation-turn-0"]'));
});

it('recognizes explicit user turns and accessibility headings without requiring message IDs', () => {
  document.body.innerHTML = `<main>
    <article data-testid="conversation-turn-0" data-turn="user"><h5 class="sr-only">你说：</h5><div class="whitespace-pre-wrap">无 ID 的问题</div></article>
    <article data-testid="conversation-turn-1" data-turn="assistant"><div>回答</div></article>
    <article data-testid="conversation-turn-2"><h5 class="sr-only">You said:</h5><div class="whitespace-pre-wrap">另一问题</div></article>
    <article data-testid="conversation-turn-3"><h6 class="sr-only">ChatGPT said:</h6><div>另一回答</div></article>
    <article data-testid="conversation-turn-4"><div class="user-message-bubble-color">气泡问题</div></article>
  </main>`;
  expect(collectQuestions(document).map(item => item.text)).toEqual(['无 ID 的问题', '另一问题', '气泡问题']);
});

it('recognizes user turns outside the first main and newer role labels without IDs', () => {
  document.body.innerHTML = '<main hidden>占位</main><main><div data-turn="user"><h2 class="sr-only">你说：</h2><p>实际提问</p></div><section data-testid="conversation-turn-2"><h3 class="sr-only">You said:</h3><p>另一问</p></section></main>';
  expect(collectQuestions(document).map(item => item.text)).toEqual(['实际提问', '另一问']);
});

it('uses saved current-path user messages to recover a directory and map plain page text, preserving duplicates and unloaded entries', () => {
  document.body.innerHTML = '<main><div><p>重复问题</p></div><div data-message-author-role="assistant">重复问题</div><div><p>重复问题</p></div><p>加粗提问</p></main>';
  const data = { title: '记录', url: 'https://chatgpt.com/c/one', exportedAt: '', warnings: [], messages: [
    { id: 'u1', stable: true, role: 'user' as const, html: '', markdown: '重复问题' },
    { id: 'a1', stable: true, role: 'assistant' as const, html: '', markdown: '回答' },
    { id: 'u2', stable: true, role: 'user' as const, html: '', markdown: '重复问题' },
    { id: 'u3', stable: true, role: 'user' as const, html: '', markdown: '**加粗提问**' },
    { id: 'u4', stable: true, role: 'user' as const, html: '', markdown: '尚未加载的历史问题' },
  ] };
  const outline = savedQuestionOutline(data, document);
  expect(outline.map(entry => entry.identity)).toEqual(['u1', 'u2', 'u3', 'u4']);
  expect(outline[0].target?.contains(document.querySelectorAll('p')[0])).toBe(true);
  expect(outline[1].target?.contains(document.querySelectorAll('p')[1])).toBe(true);
  expect(outline[2].text).toBe('加粗提问');
  expect(outline[3].target).toBeNull();
});

it('recognizes user bubbles without turn wrappers and never treats quoted user headings inside answers as prompts', () => {
  document.body.innerHTML = `<main><div class="user-message-bubble-color">无包装节点的提问</div>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant"><h5>You said:</h5><div class="whitespace-pre-wrap">回答引用</div><div data-message-author-role="user">回答内嵌示例</div></div></article>
    <article data-testid="conversation-turn-3"><div data-message-author-role="assistant"><h5>You said:</h5>另一处回答引用</div></article>
  </main>`;
  expect(collectQuestions(document).map(item => item.text)).toEqual(['无包装节点的提问']);
});

it('does not guess which repeated saved question is loaded when only one unmarked copy is present', () => {
  document.body.innerHTML = '<main><div><p>重复问题</p></div><p>唯一问题</p></main>';
  const data = { title: '', url: '', exportedAt: '', warnings: [], messages: ['重复问题', '重复问题', '唯一问题'].map((markdown, index) => ({ id: `u${index}`, stable: true, role: 'user' as const, html: '', markdown })) };
  const outline = savedQuestionOutline(data, document);
  expect(outline.slice(0, 2).map(entry => entry.target)).toEqual([null, null]);
  expect(outline[2].target).toBe(document.querySelectorAll('p')[1]);
});

it('resolves node aliases by message identity despite system or hidden nodes in the source path', () => {
  document.body.innerHTML = '<main><p data-message-id="node-first">页面里已编辑的第一问</p><p data-message-id="node-second">页面里已编辑的第二问</p></main>';
  const data = { title: '', url: '', exportedAt: '', warnings: [], sourceMessageIds: [['root', 'system'], ['node-first', 'first'], ['hidden'], ['node-second', 'second']], messages: ['first', 'second'].map(id => ({ id, stable: true, role: 'user' as const, html: '', markdown: `保存的${id}` })) };
  expect(savedQuestionOutline(data, document).map(entry => entry.target?.getAttribute('data-message-id'))).toEqual(['node-first', 'node-second']);
});

it('reserves an identified later duplicate before matching earlier questions by text', () => {
  document.body.innerHTML = '<main><p data-message-id="u1">重复问题</p></main>';
  const data = { title: '', url: '', exportedAt: '', warnings: [], messages: ['u0', 'u1'].map(id => ({ id, stable: true, role: 'user' as const, html: '', markdown: '重复问题' })) };
  const outline = savedQuestionOutline(data, document);
  expect(outline[0].target).toBeNull();
  expect(outline[1].target).toBe(document.querySelector('p'));
});

it('excludes newer assistant role markers from collection and saved question targets', () => {
  document.body.innerHTML = '<main><div data-message-role="assistant"><div data-message-role="user">回答里的引用</div></div></main>';
  expect(collectQuestions(document)).toEqual([]);
  const data = { title: '', url: '', exportedAt: '', warnings: [], messages: [{ id: 'u', stable: true, role: 'user' as const, html: '', markdown: '回答里的引用' }] };
  expect(savedQuestionOutline(data, document)[0].target).toBeNull();
});

it('keeps unmarked text ambiguous when the saved answer repeats the entire question', () => {
  document.body.innerHTML = '<main><p>你好</p></main>';
  const data = { title: '', url: '', exportedAt: '', warnings: [], messages: ['user', 'assistant'].map((role, index) => ({ id: `m${index}`, stable: true, role: role as 'user' | 'assistant', html: '', markdown: '你好' })) };
  expect(savedQuestionOutline(data, document)[0].target).toBeNull();
  document.querySelector('p')!.setAttribute('data-message-role', 'user');
  expect(savedQuestionOutline(data, document)[0].target).toBe(document.querySelector('p'));
});

it('does not jump to an unmarked answer paragraph that repeats the question within a longer answer', () => {
  document.body.innerHTML = '<main><div><p>你好</p><p>我可以帮你什么？</p></div></main>';
  const data = { title: '', url: '', exportedAt: '', warnings: [], messages: [
    { id: 'u', stable: true, role: 'user' as const, html: '', markdown: '你好' },
    { id: 'a', stable: true, role: 'assistant' as const, html: '', markdown: '你好\n\n我可以帮你什么？' },
  ] };
  expect(savedQuestionOutline(data, document)[0].target).toBeNull();
});

it('updates text and replaces removed nodes without caching a previous page or persisting messages', () => {
  document.body.innerHTML = '<main><div data-message-author-role="user">第一问</div></main>';
  const old = collectQuestions(document)[0];
  document.querySelector('main')!.innerHTML = '<div data-message-author-role="user">新会话的提问</div>';
  const next = collectQuestions(document);
  expect(next).toHaveLength(1);
  expect(next[0].text).toBe('新会话的提问');
  expect(next[0].element).not.toBe(old.element);
});

it('handles attachment-only prompts and treats prompt markup as inert text', () => {
  document.body.innerHTML = '<main><div data-message-author-role="user"><img alt="设计图.png"><button aria-label="编辑消息">编辑</button></div><div data-message-author-role="user">&lt;img src=x onerror=alert(1)&gt;</div></main>';
  expect(collectQuestions(document).map(item => item.text)).toEqual(['设计图.png', '<img src=x onerror=alert(1)>']);
});

it('scrolls a question into view with a header offset while preserving page styles and reduced-motion preference', () => {
  document.body.innerHTML = '<main><div data-message-author-role="user" style="scroll-margin-top:24px">问题</div></main>';
  const entry = collectQuestions(document)[0];
  const scroll = vi.fn(); entry.target.scrollIntoView = scroll;
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  jumpToQuestion(entry);
  expect(scroll).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
  expect(entry.target.style.scrollMarginTop).toBe('24px');
});
