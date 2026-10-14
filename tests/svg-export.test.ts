import { expect, it } from 'vitest';
import { normalizeConversation } from '../src/conversation-api';
import { renderHtml, renderMarkdown } from '../src/exporters';

const diagram = '<box border padding={3}><row><box><icon name="monitor"/><title>电脑 A：H723 HUB</title><text>XCOM · 1000000 baud</text></box><box><icon name="monitor"/><title>电脑 B：Z7 Glove</title></box></row><svg viewBox="0 0 800 120" width="100%" height="120"><defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#09998d"/></marker></defs><rect x="0" y="30" width="230" height="70" rx="12" fill="#e9e9ed"/><rect x="570" y="30" width="230" height="70" rx="12" fill="#e9e9ed"/><line x1="265" y1="65" x2="535" y2="65" stroke="#09998d" stroke-width="3" stroke-dasharray="10 6" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="115" y="74" text-anchor="middle" font-size="28">H723 HUB</text><text x="685" y="74" text-anchor="middle" font-size="28">Z7 Glove</text><text x="400" y="35" text-anchor="middle" fill="#09998d">BLE / UWB</text></svg><text>两台电脑不需要互连，各自控制本地串口即可。</text></box>';
function data(source: string) {return normalizeConversation({current_node:'a',mapping:{a:{parent:null,message:{id:'a',author:{role:'assistant'},content:{parts:[source]}}}}},'https://chatgpt.com/c/example');}

it('preserves a static connection diagram, marker arrows and monitor icons', () => {
  const value = data(diagram); const doc = new DOMParser().parseFromString(renderHtml(value),'text/html');
  expect(doc.querySelector('.body svg line')).not.toBeNull();
  expect(doc.querySelectorAll('.body svg rect').length).toBeGreaterThanOrEqual(4);
  const marker = doc.querySelector('.body marker')!;
  expect(marker?.id).toMatch(/^ck-svg-/);
  expect(doc.querySelector('.body line')?.getAttribute('marker-end')).toBe(`url(#${marker.id})`);
  expect(doc.querySelector('.body')?.textContent).not.toContain('无法完整离线还原');
  const md = renderMarkdown(value); expect(md).toContain('H723 HUB'); expect(md).toContain('BLE / UWB');
  expect(md).not.toMatch(/无法完整离线还原|<path|<rect|viewBox/);
});
it('keeps graphic source in code samples and removes active/external SVG features', () => {
  const literal = '```svg\n'+diagram+'\n```'; expect(data(literal).messages[0].markdown).toBe(literal);
  const hostile = '<box><svg viewBox="0 0 100 100" onload="alert(1)"><script>alert(2)</script><image href="https://tracker.test/pixel"/><foreignObject><iframe src="https://evil.test"/></foreignObject><a href="javascript:alert(3)"><text x="5" y="20">可读标签</text></a><rect width="90" height="30" fill="url(https://tracker.test/color)"/><use href="https://tracker.test/icon#shape"/></svg></box>';
  const doc = new DOMParser().parseFromString(renderHtml(data(hostile)),'text/html');
  expect(doc.querySelectorAll('.body script,.body image,.body iframe,.body foreignObject,.body [onload]')).toHaveLength(0);
  expect(doc.querySelector('.body')?.innerHTML).not.toMatch(/tracker\.test|evil\.test|javascript:/);
  expect(doc.querySelector('.body')?.textContent).toContain('可读标签');
});
it('supports a standalone SVG without requiring a layout or a text child', () => {
  const doc = new DOMParser().parseFromString(renderHtml(data('<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5" fill="teal"/></svg>')),'text/html');
  expect(doc.querySelector('.body svg circle')).not.toBeNull();
});
it('preserves explicit viewport dimensions, local use references and decoded text entities', () => {
  const source = '<svg width="200" height="300"><defs><g id="device"><rect x="10" y="210" width="80" height="50" fill="teal"/></g></defs><use xlink:href="#device"/><text x="10" y="20">A &amp; B &lt; C</text></svg>';
  const doc = new DOMParser().parseFromString(renderHtml(data(source)),'text/html');
  const svg = doc.querySelector('.body svg')!; expect(svg.getAttribute('viewBox')).toBe('0 0 200 300');
  expect(doc.querySelector('.body use')?.getAttribute('href')).toBe('#'+doc.querySelector('.body defs g')!.id);
  expect(doc.querySelector('.body svg text')?.textContent).toBe('A & B < C');
});
