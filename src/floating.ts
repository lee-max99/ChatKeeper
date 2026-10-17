import { floatingStyle } from './floating-style';
import { collectQuestions, outlinePageFingerprint, savedQuestionOutline, type OutlineEntry } from './question-outline';
import { navigateQuestion } from './question-navigation';
import { mountFloatingDownload } from './floating-download';
import { mountFloatingSelection } from './floating-selection';
import type { Conversation } from './types';
import { conversationId } from './conversation-api';

const icon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>';
type Position = { right: number; top: number };

export function mountFloating(bridge: (type: string) => unknown): void {
  const host = document.createElement('div'); host.id = 'chatkeeper-widget';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${floatingStyle}</style><button id="launcher" title="提问目录" aria-label="打开提问目录" aria-expanded="false" aria-controls="panel">${icon}</button>
  <section id="panel" aria-label="ChatKeeper 提问目录" hidden><header id="drag-handle"><div class="brand">${icon}<span>ChatKeeper</span></div><button id="minimize" title="收起" aria-label="收起提问目录"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></header>
  <div class="summary"><h2 id="title"></h2><div class="meta"><span>提问目录</span><div class="meta-right"><span id="count" aria-live="polite"></span><button id="select-mode" type="button" aria-pressed="false">选择问答</button></div></div><div class="search-row"><input id="question-search" type="search" placeholder="搜索提问" aria-label="搜索提问" autocomplete="off"></div><div id="selection-tools" hidden><span id="selected-count" aria-live="polite"></span><div><button id="select-all" type="button">全选</button><button id="clear-selection" type="button">清空</button></div><details id="selection-range"><summary>按序号选取</summary><div class="range-row"><input id="range-from" type="number" min="1" placeholder="起始" aria-label="起始提问序号"><span>—</span><input id="range-to" type="number" min="1" placeholder="结束" aria-label="结束提问序号"><button id="select-range" type="button">选取</button></div><p class="range-note">按完整目录序号选择</p></details></div></div>
  <nav class="outline" aria-label="当前会话的提问"><ol id="questions"></ol><p id="search-empty" hidden>没有匹配的提问</p><div id="empty" hidden><p>页面提问未识别，可读取保存的目录。</p><button id="read-outline" type="button">读取目录</button></div></nav>
  <footer class="downloads"><select id="download-format" aria-label="导出格式"><option value="md">Markdown</option><option value="html">HTML</option></select><button id="download" type="button">导出全部</button><div class="download-status" hidden><span id="download-status" role="status" aria-live="polite"></span><button id="download-retry" type="button" hidden>重试</button><button id="download-cancel" type="button" hidden>取消</button></div></footer></section>`;
  const get = <T extends HTMLElement>(id: string) => root.getElementById(id) as T;
  const launcher = get<HTMLButtonElement>('launcher'); const panel = get('panel');
  const title = get('title'); const list = get('questions'); const count = get('count'); const empty = get('empty');
  let expanded = false; let lastUrl = ''; let dirty = true;
  let contentUrl = location.href; let waitingForContent = false;
  let contentVersion = 0; let observedContentVersion = 0;
  let entries: OutlineEntry[] = []; let buttons: HTMLButtonElement[] = [];
  let staleQuestions: OutlineEntry[] = [];
  let cacheFingerprint = ''; let readFingerprint = ''; let saved: Conversation | undefined; let automaticReadUrl = '';
  let usingSavedOutline = false; let outlineFingerprint = ''; let refreshAt = 0; let refreshRetries = 0;
  let readWasRefresh = false; let beforeReadQuestions = '';
  const questionVersion = (data?: Conversation) => JSON.stringify(data?.messages.filter(message => message.role === 'user').map(message => [message.id, message.markdown ?? message.html]));
  let position: Position | undefined; let dragged = false; let active = -1;
  let scrollFrame = 0;
  let navigationRun = 0; let navigating = false;
  let navigationStatus: {identity:string;text:string;loading:boolean} | undefined;
  function paintNavigation(): void {
    [...list.children].forEach((item,index) => {
      const state = navigationStatus?.identity === entries[index]?.identity ? navigationStatus : undefined;
      const status = item.querySelector<HTMLElement>('.question-status');
      if (status) {status.textContent = state?.text || '';status.hidden = !state?.text;}
      item.querySelector('.question-button')?.setAttribute('aria-busy',String(Boolean(state?.loading)));
    });
  }
  function stopNavigation(notify = false): void {
    navigationRun++;
    if (!navigationStatus || (notify && !navigating)) {navigating = false;return;}
    if (navigating && notify && navigationStatus) navigationStatus = {...navigationStatus,text:'已停止定位',loading:false};
    else navigationStatus = undefined;
    navigating = false;
    paintNavigation();
  }
  function startNavigation(entry:OutlineEntry,renderedUrl:string): void {
    if (location.href !== renderedUrl) {dirty = true;update();return;}
    if (downloads.downloading) return;
    stopNavigation();navigating = true;const token = navigationRun;
    const current = () => token === navigationRun && location.href === renderedUrl && expanded && !host.hidden;
    const progress = (text:string) => {if (current()) {navigationStatus = {identity:entry.identity,text,loading:true};paintNavigation();}};
    progress('正在定位…');
    void navigateQuestion(entry,() => usingSavedOutline && saved ? savedQuestionOutline(saved,document) : collectQuestions(document),current,() => progress('正在加载，按 Esc 可停止'))
      .then(result => {
        if (!current()) return;
        navigating = false;
        if (usingSavedOutline) {outlineFingerprint = outlinePageFingerprint(document);refreshAt = 0;}
        navigationStatus = result === 'found' ? undefined : {identity:entry.identity,text:'暂时无法定位，点击可重试',loading:false};paintNavigation();dirty = true;update();
      }).catch(() => {
        if (!current()) return;
        navigating = false;navigationStatus = {identity:entry.identity,text:'暂时无法定位，点击可重试',loading:false};paintNavigation();dirty = true;update();
      });
  }
  let selection: ReturnType<typeof mountFloatingSelection> | undefined; let renderedSelecting = false;

  function place(): void {
    const box = host.getBoundingClientRect();
    const width = box.width || (expanded ? 300 : 36); const height = box.height || 36;
    const right = Math.max(12, Math.min(position?.right ?? 20, Math.max(12, innerWidth - width - 12)));
    const top = Math.max(12, Math.min(position?.top ?? Math.round(innerHeight * .38), Math.max(12, innerHeight - height - 12)));
    host.style.right = `${right}px`; host.style.top = `${top}px`;
  }
  function highlight(): void {
    if (!expanded || host.hidden || navigating || !entries.length) return;
    const line = Math.min(140, innerHeight * .25); let current = entries.findIndex(entry => entry.target?.isConnected);
    for (let index = 0; index < entries.length; index++) {
      if (!entries[index].target?.isConnected) continue;
      if (entries[index].target!.getBoundingClientRect().top <= line) current = index;
      else break;
    }
    if (active === current) return;
    active = current;
    buttons.forEach((button, index) => {
      if (index === current) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
    });
  }
  function render(next: OutlineEntry[]): void {
    const selecting = Boolean(selection?.active);
    if (selecting === renderedSelecting && next.length === entries.length && next.every((entry, index) => entry.element === entries[index].element && entry.target === entries[index].target && entry.text === entries[index].text && entry.identity === entries[index].identity && entry.domIdentity === entries[index].domIdentity)) return;
    renderedSelecting = selecting;
    const focused = root.activeElement;
    const focusedIndex = [...list.children].findIndex(item => item.contains(focused));
    const focusSelector = focused?.matches('input[type=checkbox]') ? 'input[type=checkbox]' : focused?.matches('.question-jump') ? '.question-jump' : '.question-button';
    const focusedEntry = entries[focusedIndex]; const scrollTop = list.parentElement!.scrollTop;
    entries = next; buttons = []; active = -1;
    const fragment = document.createDocumentFragment(); const renderedUrl = lastUrl;
    entries.forEach((entry, index) => {
      const item = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';button.className = 'question-button';
      const number = document.createElement('span'); number.className = 'number'; number.textContent = String(index + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span'); text.className = 'question-text'; text.textContent = entry.text;
      const spinner = document.createElement('span');spinner.className = 'nav-spinner';spinner.setAttribute('aria-hidden','true');
      button.title = entry.text; button.setAttribute('aria-label', `第 ${index + 1} 个提问：${entry.text}`); button.append(number, text,spinner);
      button.addEventListener('click', () => {
        if (location.href !== renderedUrl) { dirty = true; update(); return; }
        if (selection?.active) { selection.toggle(entry.identity); return; }
        startNavigation(entry,renderedUrl);
      });
      if (selecting && selection) item.append(selection.checkbox(entry, index));
      item.append(button);
      if (selecting) {
        const jump = document.createElement('button');jump.type = 'button';jump.className = 'question-jump';jump.title = '定位提问';jump.setAttribute('aria-label',`定位第 ${index + 1} 个提问`);
        jump.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        jump.addEventListener('click',() => startNavigation(entry,renderedUrl));item.append(jump);
      }
      const status = document.createElement('span');status.className = 'question-status';status.hidden = true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');item.append(status);
      fragment.append(item); buttons.push(button);
    });
    list.replaceChildren(fragment);paintNavigation();filterQuestions(); count.textContent = `${entries.length} 个提问`; empty.hidden = entries.length > 0;
    if (focusedEntry && buttons.length) {
      const sameEntry = entries.findIndex(entry => (focusedEntry.element && entry.element === focusedEntry.element) || (focusedEntry.identity && entry.identity === focusedEntry.identity));
      const index = sameEntry >= 0 ? sameEntry : Math.min(focusedIndex, buttons.length - 1);
      (list.children[index].querySelector<HTMLElement>(focusSelector) || buttons[index]).focus({ preventScroll: true });
      list.parentElement!.scrollTop = scrollTop;
    }
  }
  function filterQuestions(): void {
    const query = get<HTMLInputElement>('question-search').value.trim().toLocaleLowerCase();
    let visible = 0;
    [...list.children].forEach((item, index) => { (item as HTMLElement).hidden = !entries[index].text.toLocaleLowerCase().includes(query); if (!(item as HTMLElement).hidden) visible++; });
    get('search-empty').hidden = !query || visible > 0;
  }
  get('question-search').addEventListener('input', filterQuestions);
  get('selection-range').addEventListener('toggle',place);
  function show(value: boolean): void {
    if (!value) stopNavigation();
    expanded = value; panel.hidden = !value; launcher.hidden = value;
    launcher.setAttribute('aria-expanded', String(value));
    if (value) dirty = true;
    place();
  }
  function update(): void {
    if (!host.isConnected && document.body) document.body.append(host);
    if (location.href !== lastUrl) {
      stopNavigation();
      const changedConversation = lastUrl && new URL(lastUrl).pathname !== location.pathname;
      if (changedConversation) staleQuestions = [...staleQuestions.filter(entry => entry.element?.isConnected), ...entries];
      // Invalidate only export preparation for the previous URL, including toolbar jobs.
      bridge('CK_STATUS'); downloads.reset(); saved = undefined; cacheFingerprint = ''; get<HTMLInputElement>('question-search').value = ''; automaticReadUrl = '';
      selection?.reset();
      usingSavedOutline = false; outlineFingerprint = ''; refreshAt = 0; refreshRetries = 0;
      waitingForContent = Boolean(changedConversation && (contentUrl !== location.href || contentVersion <= observedContentVersion));
      lastUrl = location.href; dirty = true;
      entries = []; buttons = []; active = -1; list.replaceChildren();
    }
    observedContentVersion = contentVersion;
    // Navigation checks the page independently; defer full directory work until it settles.
    if (!expanded || host.hidden || navigating) return;
    const nextTitle = document.title.replace(/\s*[-–—|]\s*ChatGPT\s*$/i, '').trim() || '当前会话';
    if (title.textContent !== nextTitle) { title.textContent = nextTitle; title.title = nextTitle; }
    if (dirty) {
      dirty = false;
      staleQuestions = staleQuestions.filter(entry => entry.element?.isConnected);
      const pageQuestions = collectQuestions(document);
      const current: OutlineEntry[] = usingSavedOutline && saved && !waitingForContent ? savedQuestionOutline(saved, document) : pageQuestions;
      // A confirmed saved path belongs to this URL, including history shared with the previous chat.
      const next = usingSavedOutline && saved && !waitingForContent ? current :
        current.filter(entry => !staleQuestions.some(old => entry.element === old.element && entry.target === old.target && entry.text === old.text && entry.identity === (old.domIdentity ?? old.identity)));
      const newQuestions = next.length > 0 && (staleQuestions.length > 0 || contentUrl === location.href);
      if (!waitingForContent || newQuestions || !current.length) {
        waitingForContent = false;
        // Once a reused node represents the new chat, retire its earlier versions.
        staleQuestions = staleQuestions.filter(old => !next.some(entry => entry.element === old.element || entry.target === old.target));
        render(next);
      }
      count.textContent = `${entries.length} 个提问`; empty.hidden = entries.length > 0;
      if (usingSavedOutline && saved && !waitingForContent) {
        const fingerprint = outlinePageFingerprint(document);
        if (fingerprint !== outlineFingerprint) {
          outlineFingerprint = fingerprint; refreshAt = Date.now() + 800; refreshRetries = 1;
        }
      }
    }
    empty.querySelector('p')!.textContent = selection?.active && !selection.ready ? '读取完整目录后即可选择。' : waitingForContent ? '正在加载当前会话的提问…' : '页面提问未识别，可读取保存的目录。';
    get('read-outline').hidden = waitingForContent;
    if (waitingForContent) { count.textContent = '0 个提问'; empty.hidden = false; }
    highlight(); place();
    if (usingSavedOutline && saved && refreshAt && Date.now() >= refreshAt && !waitingForContent && !downloads.busy && !navigating) {
      const info = bridge('CK_INFO') as { ok: boolean; data?: { generating: boolean } };
      if (info.ok && !info.data?.generating) { refreshAt = 0; downloads.start('outline'); }
    }
    if (!entries.length && !selection?.active && !waitingForContent && automaticReadUrl !== location.href) {
      try { conversationId(location.href); }
      catch { return; }
      automaticReadUrl = location.href; downloads.start('outline');
    }
  }
  launcher.addEventListener('click', event => {
    const wasDragged = dragged; dragged = false;
    if (!wasDragged || event.detail === 0) { show(true); update(); }
  });
  get('minimize').addEventListener('click', () => show(false));
  function startDrag(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as Element).closest('#minimize')) return;
    dragged = false;
    const x = event.clientX; const y = event.clientY; const box = host.getBoundingClientRect();
    const move = (next: PointerEvent) => {
      if (Math.abs(next.clientX - x) + Math.abs(next.clientY - y) < 4 && !dragged) return;
      dragged = true;
      const left = Math.max(12, Math.min(box.x + next.clientX - x, innerWidth - box.width - 12));
      position = { right: innerWidth - left - box.width, top: box.y + next.clientY - y }; place();
    };
    const stop = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop);
      if (dragged) {
        const current = host.getBoundingClientRect(); position = { right: innerWidth - current.right, top: current.top };
        void chrome.storage.local.set({ floatingPosition: position });
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
  }
  launcher.addEventListener('pointerdown', startDrag); get('drag-handle').addEventListener('pointerdown', startDrag);
  window.addEventListener('resize', () => { place(); highlight(); });
  window.addEventListener('scroll', () => {
    if (!expanded || host.hidden || navigating || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; highlight(); });
  }, { capture: true, passive: true });
  window.addEventListener('popstate', update); window.addEventListener('hashchange', update);
  const manualScroll = (event: Event) => {
    if (event.composedPath().includes(host)) return;
    stopNavigation(true);
  };
  window.addEventListener('wheel', manualScroll, { capture: true, passive: true });
  window.addEventListener('touchstart', manualScroll, { capture: true, passive: true });
  window.addEventListener('pointerdown', manualScroll, { capture: true, passive: true });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') stopNavigation(true);
    else if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) manualScroll(event);
  }, true);
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(records => {
    if (!records.some(record => record.target !== host && !host.contains(record.target))) return;
    if (records.some(record => {
      if (record.type === 'attributes' && !['data-message-author-role', 'data-message-role', 'data-message-id', 'data-testid', 'data-turn'].includes(record.attributeName || '')) return false;
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      const user = '[data-message-author-role="user"], [data-message-role="user"], [data-testid="user-message"], .user-message-bubble-color, [data-turn="user"]';
      const questionChanged = (node: Node): boolean => node instanceof Element && Boolean(node.matches(user) || node.querySelector(user) || [...node.querySelectorAll('h2.sr-only, h3.sr-only, h4.sr-only, h5.sr-only, h6.sr-only')].some(heading => /^(you said|you|你说|您说|用户)\s*[:：]?$/i.test(heading.textContent?.trim() || '')));
      return Boolean(element?.closest('main, [role="main"]') && (element.closest(user) || [...record.addedNodes, ...record.removedNodes].some(questionChanged))) || [...record.addedNodes].some(node => node instanceof Element && Boolean(node.matches('main, [role="main"]') || node.querySelector('main, [role="main"]')));
    })) { contentUrl = location.href; contentVersion++; }
    dirty = true; clearTimeout(updateTimer); updateTimer = setTimeout(update, 120);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['hidden', 'aria-hidden', 'style', 'class', 'alt', 'data-turn', 'data-message-author-role', 'data-message-role', 'data-message-id', 'data-testid'] });
  setInterval(update, 1000);
  function preference(value: unknown): void { host.hidden = value === false; if (host.hidden) show(false); place(); }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.floatingEnabled) preference(changes.floatingEnabled.newValue);
  });
  void chrome.storage.local.get(['floatingEnabled', 'floatingPosition']).then(values => {
    const saved = values.floatingPosition as Partial<Position> | undefined;
    if (saved && typeof saved.right === 'number' && Number.isFinite(saved.right) && typeof saved.top === 'number' && Number.isFinite(saved.top)) position = saved as Position;
    preference(values.floatingEnabled);
  }).catch(() => {});
  const downloads = mountFloatingDownload(root, bridge, data => {
    if (data.url !== location.href) return;
    if (navigating && questionVersion(saved) !== questionVersion(data)) stopNavigation();
    // Current-URL records can supply the directory before the page replaces its old nodes.
    if (usingSavedOutline) waitingForContent = false;
    if (readWasRefresh && beforeReadQuestions === questionVersion(data) && refreshRetries > 0 && !refreshAt) {
      refreshRetries--; refreshAt = Date.now() + 1800;
    }
    saved = data; cacheFingerprint = readFingerprint; selection?.sync(data); dirty = true; update();
  }, place, {
    started(purpose, source) {
      stopNavigation();
      // A joined task has no known starting DOM; only our own new read can certify its fingerprint.
      readFingerprint = source === 'new' ? outlinePageFingerprint(document) : source === 'cached' ? cacheFingerprint : '';
      readWasRefresh = purpose === 'outline' && usingSavedOutline && Boolean(saved);
      beforeReadQuestions = questionVersion(saved);
      if (purpose === 'outline' || waitingForContent) usingSavedOutline = true;
      if (usingSavedOutline) { outlineFingerprint = outlinePageFingerprint(document); refreshAt = 0; }
    },
    failed(error) {
      // A response starting during a read invalidates it; resume after generation, not on every token.
      if (usingSavedOutline && saved && error instanceof Error && error.message.includes('回答还在生成')) {
        refreshAt = Date.now() + 800; refreshRetries = 1;
      } else { refreshAt = 0; refreshRetries = 0; }
    },
    reuse: () => Boolean(saved && saved.url === location.href && cacheFingerprint === outlinePageFingerprint(document)),
    prepareExport: () => { stopNavigation(); return selection?.prepareExport() ?? (data => data); },
    stateChanged: () => selection?.lock(),
  });
  selection = mountFloatingSelection(root, {
    cached: () => { if (saved?.url !== location.href) return undefined; usingSavedOutline = true; waitingForContent = false; return saved; }, read: () => downloads.start('outline'), changed: () => { stopNavigation(); dirty = true; update(); },
    downloading: () => downloads.downloading, availability: downloads.availability, message: downloads.message,
  });
  document.body.append(host); update();
}
