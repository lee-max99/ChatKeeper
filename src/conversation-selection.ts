import type { ChatMessage, Conversation } from './types';

export function selectQuestionGroups(data: Conversation, questions: readonly ChatMessage[]): Conversation {
  if (!questions.length) throw new Error('请选择至少一组问答。');
  const users = new Map(data.messages.filter(message => message.role === 'user').map(message => [message.id, message]));
  const selected = new Set<string>();
  for (const question of questions) {
    const current = users.get(question.id);
    if (question.role !== 'user' || !current || current.markdown !== question.markdown || current.html !== question.html) {
      throw new Error('所选提问已变化，请重新选择后导出。');
    }
    selected.add(question.id);
  }
  let included = false;
  const messages = data.messages.filter(message => {
    if (message.role === 'user') included = selected.has(message.id);
    return included;
  });
  const ids = new Set(messages.map(message => message.id));
  return { ...data, messages, sourceMessageIds: data.sourceMessageIds?.filter(aliases => aliases.some(id => ids.has(id))),
    warnings: [...data.warnings, `部分导出：已选择 ${selected.size} / ${users.size} 组问答。`] };
}
