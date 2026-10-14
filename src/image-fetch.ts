import type { Conversation, SavedImage } from './types';
import { embedImages } from './image-assets';
import { resourceUrl } from './rich-content';

export function trustedImageUrl(value: unknown): string | undefined {
  const href = resourceUrl(value); if (!href) return;
  const url = new URL(href);
  return url.protocol === 'https:' && (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.oaiusercontent.com')) ? href : undefined;
}
export async function imageResponseData(response: Response): Promise<string> {
  const mime = response.headers.get('content-type')?.split(';')[0].toLowerCase();
  if (!response.ok || !mime || !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime) || Number(response.headers.get('content-length')) > 5_000_000) throw new Error('图片不可读取或格式不支持。');
  const reader = response.body?.getReader(); if (!reader) throw new Error('图片为空。');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length; if (size > 5_000_000) throw new Error('图片超过 5 MB。'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error('图片为空。');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const head = String.fromCharCode(...bytes.subarray(0,32));
  const signature = mime === 'image/png' ? head.startsWith('\x89PNG\r\n\x1a\n') && head.slice(12,16) === 'IHDR' :
    mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
    mime === 'image/gif' ? /^GIF8[79]a/.test(head) : mime === 'image/webp' ? head.startsWith('RIFF') && head.slice(8,12) === 'WEBP' : head.slice(4,8) === 'ftyp' && /avif|avis/.test(head);
  if (!signature) throw new Error('返回内容不是有效图片。');
  if (typeof createImageBitmap === 'function') {
    const decoded = await createImageBitmap(new Blob([bytes], {type:mime}));
    if (!decoded.width || !decoded.height) { decoded.close(); throw new Error('图片无法解码。'); }
    decoded.close();
  }
  let binary = ''; for (let from = 0; from < size; from += 8192) binary += String.fromCharCode(...bytes.subarray(from, from + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export async function fetchExportImages(data: Conversation, current: () => boolean = () => true, progress: (text: string) => void = () => {}, signal?: AbortSignal): Promise<Conversation> {
  if (!data.messages.some(message => message.images?.length)) return data;
  const deadline = Date.now() + 45_000;
  let session: Promise<string> | undefined;
  const imageFetch = async <T>(url: string, options: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> => {
    const controller = new AbortController(); const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
    const timer = setTimeout(abort,8_000);
    try { return await consume(await fetch(url, {...options,signal:controller.signal})); }
    finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
  const authenticated = async <T>(path: string, consume: (response: Response) => Promise<T>) => {
    session ||= imageFetch('https://chatgpt.com/api/auth/session', {credentials:'include', redirect:'error'}, response => response.json()).then(value => {
      if (typeof value.accessToken !== 'string') throw new Error('登录已失效。'); return value.accessToken;
    });
    return imageFetch(`https://chatgpt.com${path}`, {credentials:'include', redirect:'error', headers:{Authorization:`Bearer ${await session}`}}, consume);
  };
  return embedImages(data, async (image: SavedImage) => {
    if (Date.now() >= deadline || !current()) throw new Error('图片读取已停止。');
    let href = image.url;
    if (image.fileId) {
      const id = new URL(data.url).pathname.split('/').pop()!;
      const result = await authenticated(`/backend-api/files/${encodeURIComponent(image.fileId)}/download?conversation_id=${encodeURIComponent(id)}`, async response => {
        if (!response.ok) throw new Error('原图链接已失效。');
        if (response.headers.get('content-type')?.startsWith('image/')) return {dataUrl:await imageResponseData(response)};
        const file = await response.json(); return {href:resourceUrl(file.download_url || file.url)};
      });
      if (result.dataUrl) return result.dataUrl; href = result.href;
    }
    if (!href || !resourceUrl(href)) throw new Error('没有可用图片链接。');
    try {
      // Public images never receive the ChatGPT access token or credentials.
      return await imageFetch(href, {credentials:'omit', referrerPolicy:'no-referrer'}, imageResponseData);
    } catch {
      if (signal?.aborted || !current()) throw new Error('图片读取已停止。');
      if (!trustedImageUrl(href)) throw new Error('图片站点不允许读取。');
      const id = crypto.randomUUID();
      const cancel = () => {void chrome.runtime.sendMessage({type:'CANCEL_IMAGE',id}).catch(() => {});};
      signal?.addEventListener('abort',cancel,{once:true});
      try {
        const result = await chrome.runtime.sendMessage({type:'FETCH_IMAGE',url:href,id});
        if (!result?.ok || typeof result.dataUrl !== 'string') throw new Error('图片下载失败。');
        return result.dataUrl;
      } finally {signal?.removeEventListener('abort',cancel);}
    }
  }, () => current() && !signal?.aborted, progress);
}
