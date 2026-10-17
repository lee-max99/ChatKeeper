import { afterEach, expect, it, vi } from 'vitest';
import { saveDownload,downloadSummary } from '../src/download-client';

const payload = { type: 'DOWNLOAD' as const, format: 'md' as const, filename: '会话.md', content: '问答' };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('reports saved only after the browser completes the same download ID', async () => {
  vi.useFakeTimers(); let reads = 0;
  const send = vi.fn(async (message: { type: string; id?: number }) => {
    if (message.type === 'DOWNLOAD') return { ok: true, id: 23 };
    expect(message.id).toBe(23);
    return { ok: true, state: ++reads === 1 ? 'in_progress' : 'complete', filename: '浏览器改名.md' };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } }); const progress = vi.fn();
  const saving = saveDownload(payload, progress); await vi.advanceTimersByTimeAsync(0);
  expect(progress.mock.calls.every(([text]) => !text.includes('已保存'))).toBe(true);
  await vi.advanceTimersByTimeAsync(500);
  expect(await saving).toBe('已保存：浏览器改名.md'); expect(reads).toBe(2);
});

it('rejects an invalid acknowledgement rather than pretending a file was created', async () => {
  const send = vi.fn(async () => ({ ok: true })); vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
  await expect(saveDownload(payload, () => {})).rejects.toThrow(/未返回有效下载任务/);
  expect(send).toHaveBeenCalledOnce();
});

it('does not turn a long pending save into success or automatically create a second file', async () => {
  vi.useFakeTimers();
  const send = vi.fn(async (message: { type: string }) => message.type === 'DOWNLOAD' ? { ok: true, id: 23 } : { ok: true, state: 'in_progress' });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
  const saving = saveDownload(payload, () => {}); await vi.advanceTimersByTimeAsync(120_000);
  expect(await saving).toContain('保存结果待确认');
  expect(send.mock.calls.filter(([message]) => message.type === 'DOWNLOAD')).toHaveLength(1);
});

it('stops checking or updating an obsolete floating conversation', async () => {
  vi.useFakeTimers(); let current = true;
  const send = vi.fn(async (message: { type: string }) => message.type === 'DOWNLOAD' ? { ok: true, id: 23 } : { ok: true, state: 'in_progress' });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } }); const progress = vi.fn();
  const saving = saveDownload(payload, progress, () => current); await vi.advanceTimersByTimeAsync(0);
  current = false; const updates = progress.mock.calls.length;
  await vi.advanceTimersByTimeAsync(500);
  expect(await saving).toBe(''); expect(progress).toHaveBeenCalledTimes(updates); expect(send).toHaveBeenCalledTimes(2);
});

it('keeps simultaneous exports attached to their own browser downloads', async () => {
  let sequence = 0;
  const send = vi.fn(async (message: { type: string; id?: number }) => message.type === 'DOWNLOAD' ? { ok: true, id: ++sequence } :
    { ok: true, state: 'complete', filename: `会话${message.id}.md` });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
  expect(await Promise.all([saveDownload(payload, () => {}), saveDownload(payload, () => {})])).toEqual(['已保存：会话1.md', '已保存：会话2.md']);
});
it.each(['missing-record','transport-error','unknown-state'])('reports an unconfirmed save without calling it failed or creating another download (%s)',async mode => {
  const send = vi.fn(async (message:{type:string}) => {
    if (message.type === 'DOWNLOAD') return {ok:true,id:23};
    if (mode === 'transport-error') throw new Error('response unavailable');
    return mode === 'missing-record' ? {ok:false,unconfirmed:true,error:'无法读取记录'} : {ok:true,state:'unknown'};
  });
  vi.stubGlobal('chrome',{runtime:{sendMessage:send}});
  const result = await saveDownload(payload,() => {});
  expect(result).toMatch(/待确认.*Ctrl\+J/);
  expect(result).not.toMatch(/已保存：|文件未保存/);
  expect(send.mock.calls.filter(([message]) => message.type === 'DOWNLOAD')).toHaveLength(1);
});
it('adds the exact image failure count only to a confirmed saved file',() => {
  const data = {title:'',url:'',exportedAt:'',messages:[],warnings:['2 张图片未能保存（读取受限）；正文仍已保留。']};
  expect(downloadSummary('已保存：会话.md',data)).toContain('2 张图片未保存');
  expect(downloadSummary('保存结果待确认',data)).toBe('保存结果待确认');
});
it('treats a lost creation response as unconfirmed without sending a duplicate request',async () => {
  const send = vi.fn(async () => {throw new Error('The message port closed before a response was received.');});
  vi.stubGlobal('chrome',{runtime:{sendMessage:send}});
  expect(await saveDownload(payload,() => {})).toMatch(/待确认.*Ctrl\+J/);
  expect(send).toHaveBeenCalledOnce();
});
it('reports a creation request with no receiving extension as a connection failure',async () => {
  const send = vi.fn(async () => {throw new Error('Could not establish connection. Receiving end does not exist.');});
  vi.stubGlobal('chrome',{runtime:{sendMessage:send}});
  await expect(saveDownload(payload,() => {})).rejects.toThrow(/连接.*刷新/);
  expect(send).toHaveBeenCalledOnce();
});
