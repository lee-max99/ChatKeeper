import { jumpToQuestion, type OutlineEntry } from './question-outline';

// Move continuously between document checks. Read the live position on each
// frame so ChatGPT's scroll anchoring can prepend history without a snap back.
function glide(container:HTMLElement,direction:number,current:() => boolean,duration:number):Promise<void> {
  return new Promise(resolve => {
    let frame = 0;let previous: number | undefined;
    const finish = () => {cancelAnimationFrame(frame);clearTimeout(timer);resolve();};
    const timer = setTimeout(finish,duration);
    const tick = (now:number) => {
      if (!current() || !container.isConnected) {finish();return;}
      const elapsed = previous === undefined ? 16 : Math.max(0,Math.min(32,now - previous));previous = now;
      if (!elapsed) {frame = requestAnimationFrame(tick);return;}
      const top = container.scrollTop;const max = container.scrollHeight - container.clientHeight;
      const next = Math.max(0,Math.min(max,top + direction * Math.max(200,container.clientHeight * 1.4) * elapsed / 1000));
      if (next === top) {finish();return;}
      container.scrollTo({top:next,behavior:'instant'});
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
}

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
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let boundarySince = 0; let lastState = ''; let direction = -1;
  let first = true;
  progress('正在加载并定位提问…滚动聊天页可停止。');
  while (current() && container.isConnected && Date.now() < deadline) {
    if (!first) initial = read();first = false;const index = initial.findIndex(same);
    if (index < 0) break;
    if (jumpToQuestion(initial[index])) return 'found';
    const mounted = initial.flatMap((item, offset) => item.target?.isConnected ? [offset] : []);
    if (mounted.length) {
      if (index < mounted[0]) direction = -1;
      else if (index > mounted[mounted.length - 1]) direction = 1;
    }
    const top = container.scrollTop; const max = container.scrollHeight - container.clientHeight;
    const state = `${top}:${max}:${mounted.join(',')}`;
    const boundary = (direction < 0 && top <= 1) || (direction > 0 && top >= max - 1);
    if (boundary) {
      if (lastState !== state || !boundarySince) boundarySince = Date.now();
      if (Date.now() - boundarySince >= 6000) break;
    } else boundarySince = 0;
    lastState = state;
    if (boundary) {
      await new Promise<void>(resolve => setTimeout(resolve,Math.min(250,Math.max(0,deadline - Date.now()))));
    } else if (reducedMotion) {
      // Respect reduced motion while retaining overlapping windows for loading.
      container.scrollTo({top:Math.max(0,Math.min(max,top + direction * Math.max(100,container.clientHeight * .7))),behavior:'instant'});
      await new Promise<void>(resolve => setTimeout(resolve,Math.min(500,Math.max(0,deadline - Date.now()))));
    } else {
      await glide(container,direction,current,Math.min(250,Math.max(0,deadline - Date.now())));
    }
  }
  if (!current()) return 'cancelled';
  if (container.isConnected) container.scrollTo({ top: originalTop, behavior: 'instant' });
  return 'unavailable';
}
