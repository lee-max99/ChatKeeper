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
  expect(root.querySelector('#selected-count')!.textContent).toContain('已选 1 组问答');
  root.querySelector<HTMLInputElement>('#range-from')!.value = '2'; root.querySelector<HTMLInputElement>('#range-to')!.value = '2';
  root.querySelector<HTMLButtonElement>('#select-range')!.click();
  expect(root.querySelector('#selected-count')!.textContent).toContain('已选 2 组问答');
  root.querySelector<HTMLInputElement>('#range-from')!.value = '0'; root.querySelector<HTMLButtonElement>('#select-range')!.click();
  expect(root.querySelector('#selected-count')!.textContent).toContain('已选 2 组问答');
});

function retainedSelection() {
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({mode:'open'});
  root.innerHTML = '<section id="panel"><button id="select-mode"></button><div id="selection-tools"></div><span id="selected-count"></span><button id="select-all"></button><button id="clear-selection"></button><details id="selection-range"><summary>按序号选取</summary><input id="range-from"><input id="range-to"><button id="select-range"></button></details><ol id="questions"></ol></section>';
  const data = {title:'',url:location.href,exportedAt:'',warnings:[],messages:['u','v'].map(id => ({id,stable:true,role:'user' as const,markdown:id,html:''}))};
  const selection = mountFloatingSelection(root,{cached:() => data,read:() => {},changed:() => {},downloading:() => false,availability:() => {},message:() => {}});
  const mode = root.querySelector<HTMLButtonElement>('#select-mode')!;
  mode.click(); selection.toggle('u');
  return {root,data,selection,mode};
}
it('retains chosen Q&A when returning to browsing and re-entering selection',() => {
  const {root,data,selection,mode} = retainedSelection();
  mode.click();
  expect(selection.prepareExport()(data).messages.map(item => item.id)).toEqual(['u','v']);
  mode.click();
  expect(selection.prepareExport()(data).messages.map(item => item.id)).toEqual(['u']);
  expect(root.querySelector('#selected-count')!.textContent).toContain('已选 1 组问答');
});
it('invalidates retained choices when their prompt changes while browsing',() => {
  const {selection,mode} = retainedSelection();mode.click();
  const newer = {title:'',url:location.href,exportedAt:'',warnings:[],messages:[{id:'u',stable:true,role:'user' as const,markdown:'edited',html:''}]};
  selection.sync(newer); mode.click();
  // The fresh cached response at re-entry is still checked before saving.
  expect(() => selection.prepareExport()).toThrow(/请选择/);
});
it('clears retained choices on explicit clear or conversation reset and collapses range controls',() => {
  const {root,selection,mode} = retainedSelection();
  (root.querySelector('#selection-range') as HTMLDetailsElement).open = true;
  mode.click();expect((root.querySelector('#selection-range') as HTMLDetailsElement).open).toBe(false);
  mode.click();root.querySelector<HTMLButtonElement>('#clear-selection')!.click();
  expect(() => selection.prepareExport()).toThrow(/请选择/);
  selection.toggle('u');selection.reset();mode.click();
  expect(() => selection.prepareExport()).toThrow(/请选择/);
});
