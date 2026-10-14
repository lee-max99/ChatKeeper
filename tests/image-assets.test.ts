import { expect, it, vi, afterEach } from 'vitest';
import { normalizeConversation } from '../src/conversation-api';
import { renderHtml, renderMarkdown } from '../src/exporters';
import { embedImages } from '../src/image-assets';
import { messageImages } from '../src/image-assets';
import { imageResponseData, fetchExportImages } from '../src/image-fetch';

afterEach(() => vi.unstubAllGlobals());
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==';
function sample() { return normalizeConversation({ current_node: 'a', mapping: { a: { parent: null, message: { id: 'a', author: { role: 'assistant' }, content: { parts: ['回答正文', {content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-abc', caption: '测试图片'}] } } } } }, 'https://chatgpt.com/c/test'); }
it('collects original image references and embeds acquired images in both export formats', async () => {
  const value = sample();
  expect(value.messages[0].images?.[0].fileId).toBe('file-abc');
  const embedded = await embedImages(value, async image => { expect(image.fileId).toBe('file-abc'); return png; });
  const html = new DOMParser().parseFromString(renderHtml(embedded), 'text/html');
  expect(html.querySelector('.body img')?.getAttribute('src')).toBe(png);
  expect(html.querySelector('.body a[download]')?.getAttribute('href')).toBe(png);
  expect(renderMarkdown(embedded)).toContain(png);
});
it('keeps the conversation downloadable when a picture fails and deduplicates references', async () => {
  const value = sample();
  const result = await embedImages(value, async () => { throw new Error('401'); });
  expect(renderMarkdown(result)).toContain('回答正文');
  expect(result.warnings.join('')).toMatch(/1.*图片.*未能保存/);
  expect(renderHtml(result)).not.toMatch(/<img /);
});
it('rejects active image formats and keeps selected conversations isolated', async () => {
  const value = sample();
  const result = await embedImages(value, async () => 'data:image/svg+xml;base64,PHN2Zy8+');
  expect(renderHtml(result)).not.toContain('data:image/svg');
});
it('prefers the image resource over its source article and rejects mislabeled non-images', async () => {
  const images = messageImages({metadata:{content_references:[{type:'image',url:'https://source.test/article',image_url:'https://images.test/photo.png'}]}});
  expect(images[0].url).toBe('https://images.test/photo.png');
  await expect(imageResponseData(new Response('NOT AN IMAGE',{headers:{'content-type':'image/png'}}))).rejects.toThrow(/有效图片/);
});
it('does not mistake user-authored component examples for pictures to fetch', () => {
  expect(messageImages({author:{role:'user'},content:{parts:['<Image src="https://private.test/example.png"/>']}})).toEqual([]);
});
it('keeps cancellation connected until the entire image response body has been read', async () => {
  const controller = new AbortController(); let active: AbortSignal | undefined;
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    active = options.signal as AbortSignal;
    return new Response(new ReadableStream({start(stream) { active!.addEventListener('abort',() => stream.error(new Error('aborted')),{once:true}); }}),{headers:{'content-type':'image/png'}});
  });
  const value = sample(); value.messages[0].images = [{alt:'图片',url:'https://images.test/photo.png'}];
  const pending = fetchExportImages(value,() => true,() => {},controller.signal);
  await vi.waitFor(() => expect(active).toBeDefined()); controller.abort();
  await expect(pending).rejects.toThrow(/取消/); expect(active!.aborted).toBe(true);
});
