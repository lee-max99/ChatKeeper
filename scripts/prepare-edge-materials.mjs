// Assemble store assets around the existing, verified release ZIP; never rebuild it implicitly.
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import MarkdownIt from 'markdown-it';

const root = resolve(import.meta.dirname, '..');
const version = '0.7.5';
const expectedHash = '9A478DA903153CFF39868683E77591E0A0A863647BEB9986FA1E05A055FC2F09';
const source = join(root, 'docs/store-submission/edge');
const output = join(root, `artifacts/edge-submission-${version}`);
const release = join(root, `artifacts/ChatKeeper-${version}.zip`);
const hash = data => createHash('sha256').update(data).digest('hex').toUpperCase();
if (hash(await readFile(release)) !== expectedHash) throw Error('Release ZIP changed; review the release before preparing assets.');
for (const dir of ['package', 'assets', 'documents', 'preview']) await mkdir(join(output, dir), { recursive: true });
await copyFile(release, join(output, 'package', `ChatKeeper-${version}-edge.zip`));
await copyFile(join(root, 'public/icons/128.png'), join(output, 'assets/icon-128.png'));
for (const file of ['listing-zh-CN.txt', 'review-and-privacy.txt', 'privacy-policy.md', 'submission-checklist.txt']) {
  await copyFile(join(source, file), join(output, 'documents', file));
}
const policy = new MarkdownIt({ html: false }).render(await readFile(join(source, 'privacy-policy.md'), 'utf8'));
const policyHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ChatKeeper · Microsoft Edge 隐私说明</title><style>body{font:17px/1.85 system-ui,"Microsoft YaHei",sans-serif;max-width:860px;margin:48px auto;padding:0 24px;color:#242333}h1,h2{line-height:1.4}h2{margin-top:40px}a{color:#7054e8}code{overflow-wrap:anywhere}</style><main>${policy}</main></html>`;
await writeFile(join(source, 'privacy-policy.html'), policyHtml);
await writeFile(join(output, 'documents/privacy-policy.html'), policyHtml);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const shots = [
    ['01-outline', '提问目录', '浏览、搜索并定位当前对话中的提问', 'floating-panel.png', 'wide'],
    ['02-selection', '选择问答导出', '按需选择不连续的问答，保存为 Markdown 或 HTML', 'floating-selection-detail.png', 'panel'],
    ['03-offline-reader', '离线 HTML 阅读', '目录 · 全文搜索 · 代码复制 · 打印', 'export-html.png', 'reader'],
  ];
  for (const [name, title, subtitle, filename, layout] of shots) {
    const data = `data:image/png;base64,${(await readFile(join(root, 'artifacts', filename))).toString('base64')}`;
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f8f7fc;color:#282437;font-family:"Microsoft YaHei",system-ui,sans-serif}header{height:120px;padding:22px 40px;background:white;border-bottom:1px solid #e8e4f1}h1{font-size:28px;margin:0 0 8px}p{font-size:16px;margin:0;color:#666177}.brand{float:right;color:#7054e8;font-size:18px;margin-top:12px}.stage{height:640px;overflow:hidden;display:flex;align-items:center;justify-content:center}.wide{width:1200px;height:auto}.panel{height:590px;width:auto}.reader{width:1120px;height:auto;align-self:flex-start;margin-top:18px;box-shadow:0 8px 30px #28243712}footer{height:40px;padding:8px 40px;font-size:12px;color:#777081;background:white}</style><header><span class="brand">ChatKeeper · Microsoft Edge</span><h1>${title}</h1><p>${subtitle}</p></header><div class="stage"><img class="${layout}" src="${data}" alt="${title}实际界面"></div><footer>扩展实际界面截图；聊天内容为测试演示数据。${layout === 'reader' ? '长页面仅展示首屏。' : ''}</footer></html>`;
    const htmlPath = join(output, 'preview', `${name}.html`);
    await writeFile(htmlPath, html);
    await page.goto(pathToFileURL(htmlPath).href);
    await page.locator('img').evaluate(img => img.decode());
    await page.screenshot({ path: join(output, 'assets', `screenshot-${name}.png`) });
  }
} finally { await browser.close(); }

const listing = await readFile(join(source, 'listing-zh-CN.txt'), 'utf8');
const description = listing.split('详细介绍（以下正文可粘贴）：')[1].split('分类建议：')[0].trim();
if (description.length < 250 || description.length > 10000) throw Error('Description length outside Edge limits.');
await writeFile(join(output, 'documents/store-description.txt'), description);
const review = (await readFile(join(source, 'review-and-privacy.txt'), 'utf8')).split('Reviewer notes（以下英文可粘贴）:')[1]?.trim();
if (!review) throw Error('Reviewer notes missing');
await writeFile(join(output, 'documents/reviewer-notes.txt'), review);
await copyFile(join(source, 'submission-checklist.txt'), join(output, 'START-HERE.txt'));
const files = [];
async function inventory(dir) {
  for (const entry of await readdir(join(output, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await inventory(path);
    else if (path !== 'material-report.json') {
      const bytes = await readFile(join(output, path));
      const info = { path, bytes: bytes.length, sha256: hash(bytes) };
      if (path.endsWith('.png')) {
        info.width = bytes.readUInt32BE(16); info.height = bytes.readUInt32BE(20);
        if (path.includes('screenshot-') && (info.width !== 1280 || info.height !== 800)) throw Error('Invalid screenshot dimensions');
      }
      files.push(info);
    }
  }
}
await inventory('');
await writeFile(join(output, 'material-report.json'), JSON.stringify({ version, createdAt: new Date().toISOString(), fixtureScreenshots: true, published: false, descriptionCharacters: description.length, packageSha256: expectedHash, files }, null, 2));
console.log(JSON.stringify({ output, files: files.length, descriptionCharacters: description.length, packageSha256: expectedHash }));
