// This trusted, self-contained reader is embedded in the exported document.
(() => {
  const search = document.getElementById('reader-search');
  const counter = document.getElementById('search-count');
  const empty = document.getElementById('empty');
  const articles = Array.from(document.querySelectorAll('#messages > article'));
  const links = Array.from(document.querySelectorAll('#outline a'));
  const texts = articles.map(article => article.querySelector('.body').textContent.toLocaleLowerCase());
  let group = -1;
  const groups = articles.map((article, index) => {
    if (article.classList.contains('user') || group < 0) group = index;
    return group;
  });
  const menu = document.getElementById('menu-toggle');
  const previous = document.getElementById('previous-match');
  const next = document.getElementById('next-match');
  let matches = [];
  let selected = -1;
  let timer;
  let appliedQuery = '';
  const mobile = () => window.matchMedia('(max-width: 800px)').matches;
  const setOpen = open => {
    document.body.classList.toggle('outline-open', open);
    document.body.classList.toggle('outline-closed', !open);
    menu.setAttribute('aria-expanded', String(open));
    menu.title = open ? '收起目录' : '展开目录';
  };
  setOpen(!mobile());
  menu.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') !== 'true'));
  document.getElementById('backdrop').addEventListener('click', () => setOpen(false));
  window.matchMedia('(max-width: 800px)').addEventListener('change', () => setOpen(!mobile()));
  function updateCounter() {
    counter.textContent = search.value.trim() ? `${selected + 1} / ${matches.length} 条匹配` : `${articles.length} 条消息`;
    previous.disabled = next.disabled = matches.length === 0;
  }
  function select(index) {
    if (!matches.length) return;
    selected = (index + matches.length) % matches.length;
    articles.forEach(article => article.classList.remove('search-current'));
    matches[selected].classList.add('search-current');
    matches[selected].scrollIntoView({ block: 'start', behavior: 'auto' });
    updateCounter();
  }
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    appliedQuery = query;
    matches = [];
    const matchedGroups = new Set();
    if (query) texts.forEach((text, index) => { if (text.includes(query)) matchedGroups.add(groups[index]); });
    articles.forEach((article, index) => {
      const hit = Boolean(query && texts[index].includes(query));
      const visible = !query || matchedGroups.has(groups[index]);
      article.hidden = !visible;
      article.classList.remove('search-current');
      if (hit) matches.push(article);
      const body = article.querySelector('.body');
      body.querySelectorAll('mark[data-search-hit]').forEach(mark => {
        const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); parent.normalize();
      });
      if (hit) {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('button,math,script,style')) nodes.push(walker.currentNode);
        nodes.forEach(node => {
          const text = node.textContent; const lower = text.toLocaleLowerCase();
          let from = 0; let found = lower.indexOf(query);
          if (found < 0) return;
          const fragment = document.createDocumentFragment();
          while (found >= 0) {
            fragment.append(text.slice(from, found));
            const mark = document.createElement('mark'); mark.dataset.searchHit = ''; mark.textContent = text.slice(found, found + query.length); fragment.append(mark);
            from = found + query.length; found = lower.indexOf(query, from);
          }
          fragment.append(text.slice(from)); node.replaceWith(fragment);
        });
      }
    });
    links.forEach(link => {
      const target = document.getElementById(link.hash.slice(1));
      link.closest('li').hidden = Boolean(target?.closest('article')?.hidden);
    });
    selected = matches.length ? 0 : -1;
    empty.hidden = !query || matches.length > 0;
    updateCounter();
    if (matches.length) select(0);
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(filter, 120); });
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    clearTimeout(timer);
    if (search.value.trim().toLocaleLowerCase() !== appliedQuery || !matches.length) filter();
    else select(selected + (event.shiftKey ? -1 : 1));
  });
  document.getElementById('clear-search').addEventListener('click', () => { clearTimeout(timer); search.value = ''; filter(); search.focus(); });
  previous.addEventListener('click', () => select(selected - 1));
  next.addEventListener('click', () => select(selected + 1));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(true); search.focus(); }
    if (event.key === 'Escape') { if (search.value) { clearTimeout(timer); search.value = ''; filter(); } else if (mobile()) setOpen(false); }
  });
  links.forEach(link => link.addEventListener('click', () => {
    links.forEach(item => item.removeAttribute('aria-current'));
    link.setAttribute('aria-current', 'location');
    if (mobile()) setOpen(false);
  }));
  articles.forEach(article => article.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code') || pre;
    const text = code.textContent;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'code-copy'; button.textContent = '复制'; button.setAttribute('aria-label', '复制代码');
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); button.textContent = '已复制'; }
      catch { button.textContent = '请选中复制'; }
      setTimeout(() => { button.textContent = '复制'; }, 1800);
    });
    pre.append(button);
  }));
  updateCounter();
})();
