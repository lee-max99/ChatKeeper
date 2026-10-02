export function shortConversation() {
  const entries = [
    ['user-1', 'user', '帮我写一个 Python 脚本，整理阅读笔记。\n请保留标题、表格和代码。'],
    ['assistant-1', 'assistant', '## 一个简单的开始\n\n将笔记放入文件夹，再按日期整理。你可以用下面的代码读取文件：\n\n````python\nfrom pathlib import Path\n\nfor note in Path("notes").glob("*.md"):\n    print(note.name)\n    print("```fence```")\n````\n\n| 字段 | 用途 |\n| --- | --- |\n| title | 笔记标题 |\n| tags | 阅读\\|技术 |\n\n公式：$x^2$\n\n[Python 文档](https://docs.python.org/3/)'],
    ['user-2', 'user', '可以再给一些建议吗？'],
    ['assistant-2', 'assistant', '- 每条笔记只讨论一个主题。\n- 给相关笔记添加链接。\n- 每周回顾一次。\n\n> 好的笔记，是写给未来的自己。'],
  ];
  let parent = 'root';
  const mapping = { root: { id: 'root', parent: null, message: null } };
  for (const [id, role, text] of entries) {
    mapping[id] = { id, parent, message: { id, author: { role }, status: 'finished_successfully', content: { content_type: 'text', parts: [text] } } };
    parent = id;
  }
  mapping.thought = { id: 'thought', parent: 'user-1', message: { id: 'thought', author: { role: 'assistant' }, content: { content_type: 'thoughts', thoughts: [] } } };
  mapping['assistant-1'].parent = 'thought';
  mapping.recap = { id: 'recap', parent, message: { id: 'recap', author: { role: 'assistant' }, content: { content_type: 'reasoning_recap', content: 'internal-recap-fixture' } } };
  return { title: '用 Python 整理阅读笔记', current_node: 'recap', mapping };
}
export function longConversation(count = 1000) {
  const mapping = { root: { id: 'root', parent: null, message: null } };
  for (let i = 0; i < count; i++) mapping[`m${i}`] = {
    id: `m${i}`, parent: i ? `m${i - 1}` : 'root', message: { id: `m${i}`, author: { role: i % 2 ? 'assistant' : 'user' }, status: 'finished_successfully', content: { content_type: 'text', parts: [`消息 ${i}`] } },
  };
  return { title: '1000 条长对话', current_node: `m${count - 1}`, mapping };
}
