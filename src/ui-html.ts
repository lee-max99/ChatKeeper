import { convertUiMarkup } from './rich-content';
import { markdownToHtml } from './markdown-renderer';
import type { Tag } from './ui-markup';
import { uiScalar } from './ui-data';
import { staticSvg, monitorSvg } from './ui-svg';
import { readUiTag } from './ui-markup';

export function uiSourceToHtml(source: string): string {
  const placeholders = new Map<string, string>();
  const prefix = 'CKUI' + crypto.getRandomValues(new Uint32Array(2)).join('');
  const fragment = (text: string) => {
    let html = markdownToHtml(text).trim();
    for (const [key, replacement] of placeholders) html = html.split(`<p>${key}</p>`).join(replacement).split(key).join(replacement);
    return html;
  };
  const decorate = (tag: Tag, content: string) => {
    if (['tr','th','td','thead','tbody','tfoot','caption'].includes(tag.name)) return content;
    const prop = (name: string) => uiScalar(tag.props[name]);
    const classes = ['ck-ui', `ck-${['box','card','grid','row','column','stack','text','title','heading','badge'].includes(tag.name) ? tag.name : 'component'}`];
    if (tag.props.border) classes.push('ck-border');
    if (['success', 'danger', 'error', 'warning', 'secondary', 'tertiary'].includes(prop('color'))) classes.push(`ck-${prop('color')}`);
    if (['xs','sm','lg','xl','2xl'].includes(prop('size'))) classes.push(`ck-size-${prop('size')}`);
    if (['bold','semibold','medium'].includes(prop('weight'))) classes.push('ck-bold');
    if (tag.props.align === 'center') classes.push('ck-center');
    if (['surface-secondary','secondary','muted'].includes(prop('background'))) classes.push('ck-surface');
    for (const name of ['padding', 'gap', 'columns']) {
      const value = prop(name) ? Number(prop(name)) : NaN;
      if (Number.isInteger(value) && value >= 0 && value <= 6) classes.push(`ck-${name === 'columns' ? 'grid' : name}-${value}`);
    }
    const key = prefix + placeholders.size + 'END';
    const vector = tag.svgSource ? staticSvg(tag.svgSource,readUiTag) : tag.name === 'icon' && ['monitor','computer','desktop','pc','laptop'].includes(prop('name')) ? monitorSvg : '';
    placeholders.set(key, `<div class="${classes.join(' ')}">${vector || fragment(content)}</div>`);
    return `\n\n${key}\n\n`;
  };
  return fragment(convertUiMarkup(source, new Set(), decorate));
}
