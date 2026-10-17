import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mountFloating} from '../src/floating';

const Observer = globalThis.MutationObserver;const observers:MutationObserver[] = [];
beforeEach(() => {vi.stubGlobal('MutationObserver',class extends Observer {constructor(callback:MutationCallback) {super(callback);observers.push(this);}});});
afterEach(() => {observers.splice(0).forEach(observer => observer.disconnect());vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();document.body.innerHTML = '';});

it('keeps failed question navigation next to its row without replacing export feedback',async () => {
  vi.useFakeTimers();vi.stubGlobal('matchMedia',() => ({matches:true}));
  history.replaceState(null,'','/c/interaction');
  vi.stubGlobal('chrome',{runtime:{sendMessage:async () => ({ok:true})},storage:{local:{get:async () => ({}),set:async () => {}},onChanged:{addListener:() => {}}}});
  document.body.innerHTML = '<main><p>页面尚无这条历史提问</p></main>';
  const data = {title:'',url:location.href,exportedAt:'',warnings:[],messages:[{id:'u',stable:true,role:'user',html:'',markdown:'历史提问'}]};
  const bridge = (type:string) => type === 'CK_STATUS' ? {ok:true,state:'done',data} : type === 'CK_INFO' ? {ok:true,data:{generating:false}} : {ok:true};
  mountFloating(bridge); const root = document.querySelector('#chatkeeper-widget')!.shadowRoot!;
  root.getElementById('launcher')!.click();await vi.advanceTimersByTimeAsync(0);
  root.querySelector<HTMLButtonElement>('#questions button')!.click();await vi.advanceTimersByTimeAsync(0);
  expect(root.querySelector('.question-status')?.textContent).toMatch(/无法定位/);
  expect(root.getElementById('download-status')!.textContent).toBe('');
});
it.each(['.question-jump','input[type=checkbox]'])('keeps focus on the same selection control when a historical turn mounts (%s)',async selector => {
  vi.useFakeTimers();vi.stubGlobal('matchMedia',() => ({matches:true}));history.replaceState(null,'','/c/focus-interaction');
  vi.stubGlobal('chrome',{runtime:{sendMessage:async () => ({ok:true})},storage:{local:{get:async () => ({}),set:async () => {}},onChanged:{addListener:() => {}}}});
  document.body.innerHTML = '<main><p>尚未加载提问</p></main>';
  const data = {title:'',url:location.href,exportedAt:'',warnings:[],messages:[{id:'u',stable:true,role:'user',html:'',markdown:'历史提问'}]};
  const bridge = (type:string) => type === 'CK_STATUS' ? {ok:true,state:'done',data} : type === 'CK_INFO' ? {ok:true,data:{generating:false}} : {ok:true};
  mountFloating(bridge);const root = document.querySelector('#chatkeeper-widget')!.shadowRoot!;
  root.getElementById('launcher')!.click();await vi.advanceTimersByTimeAsync(0);root.getElementById('select-mode')!.click();
  const before = root.querySelector<HTMLElement>(selector)!;before.focus();
  document.querySelector('main')!.innerHTML = '<article><div data-message-author-role="user" data-message-id="u">历史提问</div></article>';
  await vi.advanceTimersByTimeAsync(150);
  expect(before.isConnected).toBe(false);
  expect(root.activeElement).toBe(root.querySelector(selector));
});
it('defers directory rebuilds during automatic scrolling and refreshes after finding the loaded question',async () => {
  vi.useFakeTimers();vi.stubGlobal('matchMedia',() => ({matches:true}));history.replaceState(null,'','/c/smooth-navigation');
  vi.stubGlobal('chrome',{runtime:{sendMessage:async () => ({ok:true})},storage:{local:{get:async () => ({}),set:async () => {}},onChanged:{addListener:() => {}}}});
  document.body.innerHTML = '<main style="overflow-y:auto"><article data-turn="user"><div data-message-author-role="user" data-message-id="recent">最新提问</div></article></main>';
  const main = document.querySelector('main')!;Object.defineProperties(main,{clientHeight:{value:500},scrollHeight:{value:4000}});main.scrollTop = 2000;main.scrollTo = (({top}:ScrollToOptions) => {main.scrollTop = Number(top);}) as typeof main.scrollTo;
  const data = {title:'',url:location.href,exportedAt:'',warnings:[],messages:['历史提问','最新提问'].map((markdown,i) => ({id:i ? 'recent' : 'old',stable:true,role:'user',html:'',markdown}))};
  const bridge = (type:string) => type === 'CK_STATUS' ? {ok:true,state:'done',data} : type === 'CK_INFO' ? {ok:true,data:{generating:false}} : {ok:true};
  mountFloating(bridge);const root = document.querySelector('#chatkeeper-widget')!.shadowRoot!;
  root.getElementById('launcher')!.click();root.getElementById('select-mode')!.click();await vi.advanceTimersByTimeAsync(0);root.getElementById('select-mode')!.click();
  const button = root.querySelector<HTMLButtonElement>('.question-button')!;button.click();
  const article = document.createElement('article');article.dataset.turn = 'user';article.innerHTML = '<div data-message-author-role="user" data-message-id="old">历史提问</div>';article.scrollIntoView = vi.fn();main.prepend(article);
  await vi.advanceTimersByTimeAsync(150);expect(button.isConnected).toBe(true);
  await vi.advanceTimersByTimeAsync(700);expect(article.scrollIntoView).toHaveBeenCalledOnce();
  expect(button.isConnected).toBe(false);expect(root.querySelector('.question-status')!.textContent).toBe('');
});
