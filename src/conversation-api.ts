import type { ChatMessage, Conversation } from './types';
import { assertChatGPT } from './collector';
import { matchesMessagePath, uniqueMessageIds } from './message-identity';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
const label = (value: unknown) => String(value || '').replace(/[\r\n]/g, ' ').replace(/[\\[\]]/g, '\\$&');

class SavedMessageNotFound extends Error {}

function exportable(message: RecordValue | undefined): message is RecordValue {
  if (!message || !['user', 'assistant'].includes(String(record(message.author)?.role))) return false;
  return !['thoughts', 'reasoning_recap'].includes(String(record(message.content)?.content_type)) &&
    !record(message.metadata)?.is_visually_hidden_from_conversation &&
    !['analysis', 'justify', 'confidence', 'summary', 'complete'].includes(String(message.channel)) &&
    !(typeof message.recipient === 'string' && message.recipient !== 'all');
}

export function conversationId(url: string): string {
  assertChatGPT(url);
  const id = new URL(url).pathname.match(/(?:^|\/)c\/([a-zA-Z0-9-]+)\/?$/)?.[1];
  if (!id) throw new Error('请打开一条已保存的 ChatGPT 对话后再导出。');
  return id;
}

function messageText(message: RecordValue, warnings: Set<string>): string {
  const content = record(message.content);
  if (!content) throw new Error('消息正文结构无法识别，未生成文件。');
  const metadata = record(message.metadata);
  const resourceNotice = () => warnings.add('图片、音频与附件保留名称或可用链接，文件本身未嵌入。');
  const parts = Array.isArray(content.parts) ? content.parts : typeof content.text === 'string' ? [content.text] : [];
  let text = parts.map(part => {
    if (typeof part === 'string') return part;
    const item = record(part);
    if (typeof item?.text === 'string') return item.text;
    resourceNotice();
    const type = String(item?.content_type || '');
    return `> ${/image/.test(type) ? '图片' : /audio/.test(type) ? '音频' : /video/.test(type) ? '视频' : '非文本内容'}（文件未嵌入）`;
  }).join('\n\n');
  if (Array.isArray(metadata?.attachments)) for (const attachment of metadata.attachments) {
    const item = record(attachment);
    const name = label(item?.name || item?.filename || '附件');
    const href = typeof item?.url === 'string' && /^https?:\/\//i.test(item.url) ? item.url : undefined;
    resourceNotice(); text += `\n\n> 附件：${href ? `[${name}](<${href.replace(/[<>\r\n]/g, '')}>)` : name}（文件未嵌入）`;
  }
  // Resolve citation references when a public URL accompanies their display text.
  if (Array.isArray(metadata?.content_references)) for (const reference of metadata.content_references) {
    const item = record(reference);
    if (typeof item?.matched_text === 'string' && typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) {
      text = text.split(item.matched_text).join(`[${label(item.title || '参考来源')}](<${item.url.replace(/[<>\r\n]/g, '')}>)`);
    }
  }
  if (!text.trim()) {
    warnings.add('部分特殊内容仅保留类型说明。');
    text = `> 非文本消息（${label(content.content_type || '未知类型')}）`;
  }
  return text;
}

export function normalizeConversation(raw: unknown, url: string, visibleIds: string[] = [], options: { retryMissingMessages?: boolean } = {}): Conversation {
  conversationId(url);
  const data = record(raw); const mapping = record(data?.mapping);
  if (!mapping || typeof data?.current_node !== 'string') throw new Error('未能读取完整对话，网页数据格式可能已更新。');
  const reported = uniqueMessageIds(visibleIds);
  const aliases = new Map<RecordValue, string[]>();
  for (const [key, value] of Object.entries(mapping)) {
    const node = record(value);
    if (node) aliases.set(node, uniqueMessageIds([key, node.id, record(node.message)?.id].filter((id): id is string => typeof id === 'string')));
  }
  const knownIds = new Set([...aliases.values()].flat());
  const visible = reported.filter(id => knownIds.has(id));
  if (visible.length !== reported.length && options.retryMissingMessages) throw new SavedMessageNotFound('页面消息尚未保存。');
  const path = (leaf: string): RecordValue[] => {
    const result: RecordValue[] = []; const visited = new Set<string>();
    let id: string | null = leaf;
    while (id !== null) {
      if (visited.has(id)) throw new Error('对话结构异常，未生成文件。');
      visited.add(id);
      const node = Object.hasOwn(mapping, id) ? record(mapping[id]) : undefined;
      if (!node || (node.parent !== null && typeof node.parent !== 'string')) throw new Error('对话数据不完整，未生成文件。');
      result.push(node); id = node.parent as string | null;
    }
    return result.reverse();
  };
  const matches = (nodes: RecordValue[]) => matchesMessagePath(nodes.map(node => aliases.get(node)!), visible);
  let nodes: RecordValue[] = [];
  let savedPathError: unknown;
  try { nodes = path(data.current_node); }
  catch (error) { savedPathError = error; if (!visible.length) throw error; }
  if (!nodes.length || !matches(nodes)) {
    const parents = new Set(Object.values(mapping).map(value => record(value)?.parent));
    const candidates = new Map<string, RecordValue[]>();
    for (const id of Object.keys(mapping)) if (!parents.has(id)) {
      try {
        const branch = path(id);
        if (matches(branch)) {
          // Hidden recap/tool records can create different leaves for the exact
          // same user-visible conversation. Compare only exported messages.
          const key = JSON.stringify(branch.map(node => record(node.message)).filter(exportable).map(message => message.id));
          if (!candidates.has(key)) candidates.set(key, branch);
        }
      } catch { /* A broken unrelated path is not a candidate. */ }
    }
    // Page IDs are optional hints. Prefer a unique matching version, otherwise
    // keep this conversation's saved current path instead of blocking export.
    if (candidates.size === 1) nodes = candidates.values().next().value!;
    else if (!nodes.length) throw savedPathError || new Error('对话数据不完整，未生成文件。');
  }
  const warnings = new Set<string>(); const messages: ChatMessage[] = [];
  if (!reported.length || visible.length !== reported.length || !matches(nodes)) {
    warnings.add('已按此会话保存的当前版本导出。');
  }
  for (const node of nodes) {
    const message = record(node.message);
    if (!exportable(message)) continue;
    const role = record(message.author)!.role as ChatMessage['role'];
    if (['in_progress', 'pending', 'streaming'].includes(String(message.status))) {
      warnings.add('保存记录中仍有未完成标记，已导出当前保存的内容；部分回答可能尚未完整保存。');
    }
    if (typeof message.id !== 'string') throw new Error('消息标识不完整，未生成文件。');
    messages.push({ id: message.id, stable: true, role, html: '', markdown: messageText(message, warnings) });
  }
  if (!messages.length) throw new Error('这条对话没有可以导出的消息。');
  return { title: typeof data.title === 'string' && data.title.trim() ? data.title : 'ChatGPT 对话', url,
    exportedAt: new Date().toISOString(), messages, warnings: [...warnings], source: 'api', sourceMessageIds: nodes.map(node => aliases.get(node)!) };
}

export async function readConversation(url: string, visibleIds: string[], signal: AbortSignal): Promise<Conversation> {
  const id = conversationId(url);
  if (signal.aborted) throw new Error('导出已取消。');
  const controller = new AbortController();
  const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 45000);
  const wait = (delay: number) => new Promise<void>((resolve, reject) => {
    if (controller.signal.aborted) { reject(new Error('读取已中止。')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new Error('读取已中止。')); };
    const timer = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, delay);
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const get = async (path: string, headers?: HeadersInit): Promise<unknown> => {
    const response = await fetch(`https://chatgpt.com${path}`, { credentials: 'include', headers, signal: controller.signal, cache: 'no-store', redirect: 'error' });
    if ([401, 403].includes(response.status)) throw new Error('当前登录状态或工作区无法读取此对话，请刷新 ChatGPT 并确认已登录。');
    if (response.status === 404) throw new Error('没有找到这条对话，请确认对话已保存且当前账号可以访问。');
    if (response.status === 429) throw new Error('请求过于频繁，请稍后重试。');
    if (!response.ok) throw new Error(`读取对话失败（${response.status}），请稍后重试。`);
    try { return await response.json(); } catch { throw new Error('网页未返回有效的对话数据，请刷新后重试。'); }
  };
  try {
    const session = record(await get('/api/auth/session'));
    if (typeof session?.accessToken !== 'string' || !session.accessToken) throw new Error('请先登录 ChatGPT，再导出对话。');
    // The short-lived token is used only for this same-origin request. It is
    // never returned to the popup, persisted, logged, or sent to another host.
    for (let attempt = 0; ; attempt++) {
      const raw = await get(`/backend-api/conversation/${encodeURIComponent(id)}`, { Authorization: `Bearer ${session.accessToken}` });
      if (signal.aborted) throw new Error('导出已取消。');
      try { return normalizeConversation(raw, url, visibleIds, { retryMissingMessages: attempt < 2 }); }
      catch (error) {
        if (!(error instanceof SavedMessageNotFound) || attempt >= 2) throw error;
        await wait(attempt === 0 ? 400 : 1000);
      }
    }
  } catch (error) {
    if (signal.aborted) throw new Error('导出已取消。');
    if (controller.signal.aborted) throw new Error('读取超时，请检查网络后重试。');
    if (error instanceof TypeError) throw new Error('无法连接 ChatGPT，请检查网络或刷新页面后重试。');
    throw error;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
