import { jumpToQuestion, type OutlineEntry } from './question-outline';

// Page scrolling asks ChatGPT itself to mount history; saved API data is not a page node.
export async function navigateQuestion(entry: OutlineEntry, read: () => OutlineEntry[], current: () => boolean,
  progress: (text: string) => void): Promise<'found' | 'cancelled' | 'unavailable'> {
  const same = (item: OutlineEntry) => entry.identity ? item.identity === entry.identity : item.element === entry.element && item.target === entry.target;
  let initial = read(); const target = initial.find(same);
  if (!current()) return 'cancelled';
  if (target && jumpToQuestion(target)) return 'found';
  if (!target) return 'unavailable';
  const doc = document;
  const origins = [initial.find(item => item.target?.isConnected)?.target, doc.querySelector<HTMLElement>('main, [role="main"]')];
  let container: HTMLElement | undefined;
  for (const origin of origins) {
    for (let node = origin; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) { container = node; break; }
    }
    if (container) break;
  }
  container ??= doc.scrollingElement as HTMLElement | undefined;
  if (!container || container.scrollHeight <= container.clientHeight) return 'unavailable';
  const originalTop = container.scrollTop; const deadline = Date.now() + 45_000;
  let boundarySince = 0; let lastState = ''; let direction = -1;
  progress('正在加载并定位提问…滚动聊天页可停止。');
  while (current() && container.isConnected && Date.now() < deadline) {
    initial = read(); const index = initial.findIndex(same);
    if (index < 0) break;
    if (jumpToQuestion(initial[index])) return 'found';
    const mounted = initial.flatMap((item, offset) => item.target?.isConnected ? [offset] : []);
    if (mounted.length) {
      if (index < mounted[0]) direction = -1;
      else if (index > mounted[mounted.length - 1]) direction = 1;
    }
    const top = container.scrollTop; const max = container.scrollHeight - container.clientHeight;
    const state = `${top}:${max}:${mounted.join(',')}`;
    if ((direction < 0 && top <= 1) || (direction > 0 && top >= max - 1)) {
      if (lastState !== state || !boundarySince) boundarySince = Date.now();
      if (Date.now() - boundarySince >= 6000) break;
    } else boundarySince = 0;
    lastState = state;
    // Overlapping steps keep virtualized messages from being skipped between screens.
    container.scrollTo({ top: Math.max(0, Math.min(max, top + direction * Math.max(100, container.clientHeight * .7))), behavior: 'instant' });
    await new Promise<void>(resolve => setTimeout(resolve, 500));
  }
  if (!current()) return 'cancelled';
  if (container.isConnected) container.scrollTo({ top: originalTop, behavior: 'instant' });
  return 'unavailable';
}
