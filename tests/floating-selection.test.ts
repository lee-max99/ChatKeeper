import { afterEach, expect, it, vi } from 'vitest';
import { mountFloatingSelection } from '../src/floating-selection';
afterEach(() => { document.body.innerHTML = ''; });
it('enters selection immediately from a cached complete conversation without another read', () => {
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<section id="panel"><button id="select-mode"></button><div id="selection-tools"></div><span id="selected-count"></span><button id="select-all"></button><button id="clear-selection"></button><input id="range-from"><input id="range-to"><button id="select-range"></button><ol id="questions"></ol></section>';
  const data = { title: '', url: '', exportedAt: '', warnings: [], messages: [{ id: 'u', stable: true, role: 'user' as const, markdown: '问题', html: '' }] };
  const read = vi.fn();
  const selection = mountFloatingSelection(root, { read, cached: () => data, changed: () => {}, downloading: () => false, availability: () => {}, message: () => {} });
  root.querySelector<HTMLButtonElement>('#select-mode')!.click();
  expect(selection.ready).toBe(true); expect(read).not.toHaveBeenCalled();
  selection.toggle('u'); selection.sync({ ...data, messages: [...data.messages, { ...data.messages[0], id: 'v' }] });
  expect(root.querySelector('#selected-count')!.textContent).toContain('1 / 2');
  root.querySelector<HTMLInputElement>('#range-from')!.value = '2'; root.querySelector<HTMLInputElement>('#range-to')!.value = '2';
  root.querySelector<HTMLButtonElement>('#select-range')!.click();
  expect(root.querySelector('#selected-count')!.textContent).toContain('2 / 2');
  root.querySelector<HTMLInputElement>('#range-from')!.value = '0'; root.querySelector<HTMLButtonElement>('#select-range')!.click();
  expect(root.querySelector('#selected-count')!.textContent).toContain('2 / 2');
});
