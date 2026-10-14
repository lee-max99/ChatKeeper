import MarkdownIt from 'markdown-it';
import { resourceUrl, convertUiMarkup } from './rich-content';
import type { Conversation, SavedImage } from './types';

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export const validImageData = (value: unknown): value is string => typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length <= 7_000_000;
export function messageImages(message: Record<string, unknown>): SavedImage[] {
  const images: SavedImage[] = []; const keys = new Set<string>();
  function add(item: Record<string, unknown>) {
    const raw = item.image_url || item.src || item.url;
    const url = resourceUrl(record(raw)?.url ?? raw);
    const fileId = typeof item.asset_pointer === 'string' ? item.asset_pointer.match(/^(?:file-service|sediment):\/\/(file[-_][\w-]+)$/)?.[1] : undefined;
    if (!url && !fileId) return;
    const key = fileId || url!; if (keys.has(key)) return; keys.add(key);
    const alt = [item.caption,item.alt,item.title,item.name].find(value => typeof value === 'string') as string || '图片';
    images.push({alt, ...(url ? {url} : {}), ...(fileId ? {fileId} : {})});
  }
  const content = record(message.content); const parts = Array.isArray(content?.parts) ? content.parts : [content?.text];
  const md = new MarkdownIt({html: false});
  for (const part of parts) {
    const item = record(part);
    if (item && /image/.test(String(item.content_type))) add(item);
    const source = typeof part === 'string' ? part : typeof item?.text === 'string' ? item.text : '';
    if (record(message.author)?.role === 'user') continue;
    for (const token of md.parse(source, {})) for (const child of token.children || []) if (child.type === 'image') add({url: child.attrGet('src'), alt: child.content});
    if (source.includes('<')) convertUiMarkup(source, new Set(), (tag, text) => { if (['image','img'].includes(tag.name)) add(tag.props); return text; });
  }
  const metadata = record(message.metadata);
  for (const raw of Array.isArray(metadata?.content_references) ? metadata.content_references : []) {
    const ref = record(raw); if (!ref) continue;
    if (/image/.test(String(ref.type)) || ref.image_url) add(ref);
    for (const nested of Array.isArray(ref.items) ? ref.items : []) { const item = record(nested); if (item && (/image/.test(String(item.type)) || item.image_url)) add(item); }
  }
  for (const raw of Array.isArray(metadata?.attachments) ? metadata.attachments : []) {
    const item = record(raw); if (item && (/^image\//.test(String(item.mime_type)) || /\.(png|jpe?g|webp|gif|avif)$/i.test(String(item.name || item.filename)))) add(item);
  }
  return images;
}
export async function embedImages(data: Conversation, load: (image: SavedImage) => Promise<string>, current: () => boolean = () => true, progress: (text: string) => void = () => {}): Promise<Conversation> {
  const cache = new Map<string, Promise<string | undefined>>(); let total = 0; let failed = 0; let count = 0;
  // HTML writes each image twice (display + download link). Reserve room for
  // the conversation itself and the document shell within the download limit.
  const textSize = data.messages.reduce((size,message) => size + Math.max(message.html.length,message.markdown?.length || 0,message.uiSource?.length || 0) * 2 + 1000, 0);
  const budget = Math.min(12_000_000, Math.max(0,(24_000_000 - textSize) / 2));
  const messages = [];
  for (const message of data.messages) {
    const images: SavedImage[] = [];
    for (const image of message.images || []) {
      if (!current()) throw new Error('导出已取消或对话已切换。');
      progress(`正在保存图片 ${++count}…`);
      const key = image.fileId || image.url || image.alt;
      if (!cache.has(key)) cache.set(key, (async () => {
        try {
          const value = image.dataUrl || await load(image);
          if (!validImageData(value)) return;
          return value;
        } catch { return; }
      })());
      let dataUrl = await cache.get(key);
      if (!current()) throw new Error('导出已取消或对话已切换。');
      if (dataUrl && total + dataUrl.length > budget) dataUrl = undefined;
      if (!dataUrl) failed++; else total += dataUrl.length;
      const {dataUrl: _previous, ...resource} = image;
      images.push({...resource, ...(dataUrl ? {dataUrl} : {})});
    }
    messages.push({...message, ...(images.length ? {images} : {})});
  }
  const warnings = data.warnings.map(warning => count && /图片.*未嵌入/.test(warning) ? '音频与其他附件保留名称或链接；图片保存结果见下方。' : warning);
  if (count) warnings.push(failed ? `${failed} 张图片未能保存（链接不可用、读取受限或图片过大）；正文仍已保留，请在原对话查看。` : `已内嵌 ${count} 张图片，可离线查看。`);
  return {...data, messages, warnings};
}
