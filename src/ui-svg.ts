import type { Tag } from './ui-markup';

type TagReader = (source: string, start: number) => Tag | undefined;
const shapes = new Set('svg g defs marker path rect circle ellipse line polyline polygon text tspan title desc use'.split(' '));
const active = new Set('script style foreignobject iframe object embed image animate animatemotion animatetransform set'.split(' '));
const numeric = new Set('x y x1 y1 x2 y2 cx cy r rx ry width height dx dy stroke-width stroke-dasharray stroke-dashoffset font-size opacity fill-opacity stroke-opacity refX refY markerWidth markerHeight'.split(' '));
const aliases: Record<string,string> = {strokeWidth:'stroke-width',strokeDasharray:'stroke-dasharray',strokeLinecap:'stroke-linecap',strokeLinejoin:'stroke-linejoin',fontSize:'font-size',fontWeight:'font-weight',textAnchor:'text-anchor',markerEnd:'marker-end',markerStart:'marker-start',markerMid:'marker-mid',fillOpacity:'fill-opacity',strokeOpacity:'stroke-opacity',xlinkHref:'href','xlink:href':'href',viewbox:'viewBox'};
const scalar = (value: unknown): string => typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' ? String(value) : '';

export function svgDescription(source: string): string {
  const doc = new DOMParser().parseFromString(source,'text/html');
  doc.querySelectorAll('script,style,foreignObject,iframe,object,embed,image').forEach(node => node.remove());
  const labels = [...doc.querySelectorAll('text,title,desc')].map(node => (node.textContent || '').trim()).filter(Boolean);
  return [...new Set(labels)].join(' · ') || '静态示意图';
}

// Build inert vector markup from geometry and local references. Arbitrary SVG
// source, scripts, foreign documents, remote images and CSS never pass through.
export function staticSvg(source: string, readTag: TagReader): string {
  const tags: Tag[] = [];
  for (let pos = source.indexOf('<'); pos >= 0; pos = source.indexOf('<',pos + 1)) {
    const tag = readTag(source,pos); if (tag) {tags.push(tag);pos = tag.end - 1;}
    if (tags.length > 10_000 || source.length > 200_000) return '';
  }
  const doc = new DOMParser().parseFromString('<!doctype html><body></body>','text/html');
  const prefix = 'ck-svg-' + crypto.getRandomValues(new Uint32Array(2)).join('') + '-';
  const ids = new Map<string,string>();
  for (const tag of tags) if (!tag.closing && shapes.has(tag.name) && /^[\w-]+$/.test(scalar(tag.props.id))) {
    const id = scalar(tag.props.id); if (!ids.has(id)) ids.set(id,prefix + ids.size);
  }
  let root: Element | undefined; let from = 0;
  const stack: {name:string;node?:Element;blocked:boolean}[] = [];
  const parent = () => [...stack].reverse().find(item => item.node)?.node;
  const blocked = () => stack.some(item => item.blocked);
  for (const tag of tags) {
    if (!blocked() && stack.some(item => ['text','tspan','title','desc'].includes(item.name))) {
      const text = doc.createElement('textarea'); text.innerHTML = source.slice(from,tag.start);
      parent()?.append(doc.createTextNode(text.value));
    }
    from = tag.end;
    if (tag.closing) {if (stack.at(-1)?.name === tag.name) stack.pop(); continue;}
    const hidden = blocked() || active.has(tag.name);
    let node: Element | undefined;
    if (!hidden && shapes.has(tag.name)) {
      node = doc.createElementNS('http://www.w3.org/2000/svg',tag.name);
      for (const [rawKey,value] of Object.entries(tag.props)) {
        const key = aliases[rawKey] || rawKey; const text = scalar(value).trim(); if (!text) continue;
        let safe: string | undefined;
        if (key === 'id') {const id = ids.get(text);if (id) node.setAttribute('data-ck-svg-id',id);continue;}
        if (numeric.has(key) && /^[-+\d.eE,\s%]+(?:px)?$/.test(text)) safe = text;
        if (key === 'viewBox' && /^[-+\d.eE,\s]+$/.test(text)) safe = text;
        if (key === 'd' && /^[MmLlHhVvCcSsQqTtAaZz\d.eE,+\-\s]+$/.test(text)) safe = text;
        if (key === 'points' && /^[-+\d.eE,\s]+$/.test(text)) safe = text;
        if (key === 'transform' && /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([-+\d.eE,\s]+\)\s*)+$/.test(text)) safe = text;
        if (['fill','stroke','color'].includes(key) && /^(?:#[\da-fA-F]{3,8}|[a-zA-Z]{1,24}|(?:rgba?|hsla?)\([\d.,% /+-]+\))$/.test(text)) safe = text;
        if (['fill','stroke','marker-start','marker-mid','marker-end'].includes(key)) {
          const id = text.match(/^url\(#([\w-]+)\)$/)?.[1]; if (id && ids.has(id)) safe = `url(#${ids.get(id)})`;
        }
        if (key === 'href' && text.startsWith('#') && ids.has(text.slice(1))) safe = '#' + ids.get(text.slice(1));
        if (['text-anchor','dominant-baseline','stroke-linecap','stroke-linejoin','fill-rule','clip-rule','orient','preserveAspectRatio','font-weight','font-family','role','aria-label'].includes(key) && /^[\w\s,.-]+$/.test(text)) safe = text;
        if (safe) node.setAttribute(key,safe);
      }
      if (!root && tag.name === 'svg') root = node;
      else parent()?.append(node);
    }
    if (!tag.selfClosing) stack.push({name:tag.name,node,blocked:hidden});
  }
  if (!root) return '';
  root.setAttribute('class','ck-static-svg'); root.setAttribute('role','img');
  if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label',svgDescription(source));
  if (!root.hasAttribute('viewBox')) {
    const width = Number(root.getAttribute('width')); const height = Number(root.getAttribute('height'));
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) root.setAttribute('viewBox',`0 0 ${width} ${height}`);
  } else root.setAttribute('width','100%');
  return root.outerHTML;
}

export const monitorSvg = '<svg class="ck-monitor" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" aria-label="电脑" role="img"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/></svg>';
