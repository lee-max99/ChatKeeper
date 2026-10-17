import { selectQuestionGroups } from './conversation-selection';
import type { ChatMessage, Conversation } from './types';
import type { OutlineEntry } from './question-outline';

export function mountFloatingSelection(root: ShadowRoot, controls: {
  cached?: () => Conversation | undefined; read: () => void; changed: () => void; downloading: () => boolean;
  availability: (label: string, disabled: boolean) => void; message: (text: string) => void;
}) {
  const mode = root.getElementById('select-mode') as HTMLButtonElement;
  const tools = root.getElementById('selection-tools')!;
  const count = root.getElementById('selected-count')!;
  const all = root.getElementById('select-all') as HTMLButtonElement;
  const clear = root.getElementById('clear-selection') as HTMLButtonElement;
  const ranges = root.getElementById('selection-range') as HTMLDetailsElement | null;
  let active = false; let ready = false;
  let questions: ChatMessage[] = [];
  const chosen = new Map<string, ChatMessage>();
  function lock(): void {
    mode.disabled = controls.downloading();
    all.disabled = !ready || !questions.length || controls.downloading();
    clear.disabled = !chosen.size || controls.downloading();
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#range-from, #range-to, #select-range').forEach(input => {input.disabled = !ready || controls.downloading();});
    root.querySelectorAll<HTMLInputElement>('#questions input[type=checkbox]').forEach(input => {
      input.checked = chosen.has(input.value); input.disabled = controls.downloading();
    });
    if (active) root.querySelectorAll<HTMLButtonElement>('#questions button').forEach(button => { button.disabled = controls.downloading(); });
  }
  function update(): void {
    mode.textContent = active ? '退出选择' : chosen.size ? `选择问答 · ${chosen.size}` : '选择问答'; mode.setAttribute('aria-pressed', String(active));
    tools.hidden = !active; root.getElementById('panel')!.classList.toggle('selecting', active);
    count.textContent = ready ? `已选 ${chosen.size} 组问答` : '读取完整目录…';
    lock();
    controls.availability(active ? `导出所选 · ${chosen.size} 组` : '导出全部', active && (!ready || !chosen.size));
  }
  function toggle(id: string): void {
    if (!active || !ready || controls.downloading()) return;
    const question = questions.find(message => message.id === id); if (!question) return;
    if (chosen.has(id)) chosen.delete(id); else chosen.set(id, { ...question });
    controls.message(''); update();
  }
  mode.addEventListener('click', () => {
    if (controls.downloading()) return;
    active = !active;if (ranges) ranges.open = false;
    const cached = active ? controls.cached?.() : undefined;
    if (cached) sync(cached);
    update(); controls.message(''); controls.changed();
    if (active && !cached) controls.read();
  });
  all.addEventListener('click', () => {
    if (!ready || controls.downloading()) return;
    questions.forEach(question => chosen.set(question.id, { ...question })); controls.message(''); update();
  });
  clear.addEventListener('click', () => {
    if (controls.downloading()) return;
    chosen.clear(); controls.message(''); update();
  });
  const range = root.getElementById('select-range') as HTMLButtonElement | null;
  range?.addEventListener('click', () => {
    if (!ready || controls.downloading()) return;
    const from = Number((root.getElementById('range-from') as HTMLInputElement).value);
    const to = Number((root.getElementById('range-to') as HTMLInputElement).value);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > questions.length) { controls.message(`请输入 1～${questions.length} 内的有效范围。`); return; }
    questions.slice(from - 1, to).forEach(question => chosen.set(question.id, { ...question }));
    controls.message(''); update();
  });
  update();
  function sync(data:Conversation): void {
    if (!active && !ready) return;
    questions = data.messages.filter(message => message.role === 'user'); ready = true;
    const latest = new Map(questions.map(question => [question.id, question]));
    for (const [id, question] of chosen) {
      const current = latest.get(id);
      if (!current || current.markdown !== question.markdown || current.html !== question.html) chosen.delete(id);
    }
    update();
  }
  return {
    get active() { return active; }, get ready() { return ready; }, toggle, lock,
    sync,
    checkbox(entry: OutlineEntry, index: number): HTMLInputElement {
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = entry.identity;
      input.setAttribute('aria-label', `选择第 ${index + 1} 组问答：${entry.text}`); input.checked = chosen.has(entry.identity);
      input.disabled = controls.downloading(); input.addEventListener('change', () => toggle(entry.identity));
      return input;
    },
    prepareExport(): (data: Conversation) => Conversation {
      if (!active) return data => data;
      if (!ready || !chosen.size) throw new Error('请选择至少一组问答。');
      const snapshot = [...chosen.values()].map(question => ({ ...question }));
      return data => selectQuestionGroups(data, snapshot);
    },
    reset(): void {
      active = false; ready = false; questions = []; chosen.clear();if (ranges) ranges.open = false;
      root.querySelectorAll<HTMLInputElement>('#range-from, #range-to').forEach(input => {input.value = '';});update();
    },
  };
}
