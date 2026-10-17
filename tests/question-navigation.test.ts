import { afterEach, expect, it, vi } from 'vitest';
import { navigateQuestion } from '../src/question-navigation';
import type { OutlineEntry } from '../src/question-outline';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
function fixture() {
  vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<main style="overflow-y:auto"><article id="loaded">最新提问</article></main>';
  const main = document.querySelector('main')!; const loaded = document.querySelector<HTMLElement>('article')!;
  Object.defineProperties(main, { clientHeight: { value: 500 }, scrollHeight: { value: 3000, configurable: true } });
  main.scrollTop = 2000;
  const scroll = vi.fn(({ top }: ScrollToOptions) => { main.scrollTop = Math.max(0, Math.min(2500, top || 0)); });
  main.scrollTo = scroll as typeof main.scrollTo;
  const old: OutlineEntry = { identity: 'old', text: '历史提问', target: null, element: null };
  const recent: OutlineEntry = { identity: 'recent', text: '最新提问', target: loaded, element: loaded };
  const entries = [old, recent]; const jump = vi.fn(); loaded.scrollIntoView = jump;
  const load = () => { const node = document.createElement('article'); node.textContent = old.text; node.scrollIntoView = jump; main.prepend(node); old.element = old.target = node; };
  return { main, entries, old, recent, jump, scroll, load };
}
it('jumps immediately to loaded questions without loading or changing the scroll container first', async () => {
  const f = fixture();
  expect(await navigateQuestion(f.recent, () => f.entries, () => true, () => {})).toBe('found');
  expect(f.jump).toHaveBeenCalledOnce(); expect(f.scroll).not.toHaveBeenCalled();
});
it('briefly emphasizes the located question without overwriting its page styles',async () => {
  const f = fixture();const target = f.recent.target!;
  const animate = vi.fn(() => ({cancel:() => {}} as Animation));target.animate = animate;
  target.style.outline = '1px solid blue';
  expect(await navigateQuestion(f.recent,() => f.entries,() => true,() => {})).toBe('found');
  expect(animate).toHaveBeenCalledOnce();expect(target.style.outline).toBe('1px solid blue');
});
it('scrolls the chat container and waits for asynchronously loaded history before jumping', async () => {
  const f = fixture(); setTimeout(f.load, 1400);
  const result = navigateQuestion(f.old, () => f.entries, () => true, () => {});
  await vi.advanceTimersByTimeAsync(2000);
  expect(await result).toBe('found'); expect(f.scroll.mock.calls[0][0].top).toBeLessThan(2000); expect(f.jump).toHaveBeenCalledOnce();
});
it('loads forward when a virtualized target follows the currently mounted questions', async () => {
  const f = fixture(); f.entries.reverse(); f.main.scrollTop = 0; setTimeout(f.load, 900);
  const result = navigateQuestion(f.old, () => f.entries, () => true, () => {}); await vi.advanceTimersByTimeAsync(1500);
  expect(await result).toBe('found'); expect(f.scroll.mock.calls[0][0].top).toBeGreaterThan(0);
});
it('stops an obsolete request without jumping when another question or conversation takes over', async () => {
  const f = fixture(); let current = true;
  const result = navigateQuestion(f.old, () => f.entries, () => current, () => {});
  current = false; f.load(); await vi.advanceTimersByTimeAsync(500);
  expect(await result).toBe('cancelled'); expect(f.jump).not.toHaveBeenCalled();
});
it('bounds failed loading and restores the previous position without guessing another target', async () => {
  const f = fixture(); const result = navigateQuestion(f.old, () => f.entries, () => true, () => {});
  await vi.advanceTimersByTimeAsync(46000);
  expect(await result).toBe('unavailable'); expect(f.main.scrollTop).toBe(2000); expect(f.jump).not.toHaveBeenCalled();
});
it.each([false,true])('moves through unloaded history in small frame steps without scanning every frame (offset clock=%s)',async offsetClock => {
  const f = fixture();vi.stubGlobal('matchMedia',() => ({matches:false}));let current = true;
  if (offsetClock) vi.spyOn(performance,'now').mockReturnValue(1_000_000);
  const read = vi.fn(() => f.entries);const result = navigateQuestion(f.old,read,() => current,() => {});
  await vi.advanceTimersByTimeAsync(180);
  const positions = [2000,...f.scroll.mock.calls.map(([options]) => Number(options.top))];
  expect(positions.length).toBeGreaterThan(4);
  expect(positions.slice(1).every((top,index) => top < positions[index] && positions[index] - top < 100)).toBe(true);
  expect(read.mock.calls.length).toBeLessThan(5);
  current = false;const writes = f.scroll.mock.calls.length;await vi.advanceTimersByTimeAsync(500);
  expect(await result).toBe('cancelled');expect(f.scroll).toHaveBeenCalledTimes(writes);
});
it('waits at a loading boundary instead of repeatedly issuing scroll commands at the same position',async () => {
  const f = fixture();f.main.scrollTop = 0;let current = true;
  const result = navigateQuestion(f.old,() => f.entries,() => current,() => {});
  await vi.advanceTimersByTimeAsync(1200);expect(f.scroll).not.toHaveBeenCalled();
  current = false;await vi.advanceTimersByTimeAsync(500);expect(await result).toBe('cancelled');
});
it('continues from the browser-adjusted position when historical content shifts the scroll anchor',async () => {
  const f = fixture();vi.stubGlobal('matchMedia',() => ({matches:false}));let current = true;
  const result = navigateQuestion(f.old,() => f.entries,() => current,() => {});await vi.advanceTimersByTimeAsync(80);
  f.main.scrollTop += 500;const anchored = f.main.scrollTop;await vi.advanceTimersByTimeAsync(32);
  expect(f.main.scrollTop).toBeLessThan(anchored);expect(anchored - f.main.scrollTop).toBeLessThan(100);
  current = false;await vi.advanceTimersByTimeAsync(500);expect(await result).toBe('cancelled');
});
