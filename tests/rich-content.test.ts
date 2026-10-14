import { expect, it } from 'vitest';
import { normalizeConversation } from '../src/conversation-api';
import { renderHtml, renderMarkdown } from '../src/exporters';
import catchUpMarkup from './fixtures/ui-markup.txt?raw';
import intelligentUi from './fixtures/intelligent-ui.txt?raw';

const url = 'https://chatgpt.com/c/rich-content';
function conversation(parts: unknown[], metadata: object = {}, role = 'assistant') {
  return normalizeConversation({ title: '图片与交互内容', current_node: 'a', mapping: {
    a: { id: 'a', parent: null, message: { id: 'a', author: { role }, content: { content_type: 'multimodal_text', parts }, metadata } },
  } }, url, ['a']);
}
it('converts image markers to readable references while retaining the surrounding answer in both formats', () => {
  const marker = '\ue200i\ue202turn0image0\ue201';
  const data = conversation([`前文\n${marker}\n后文`], { content_references: [{ matched_text: marker, type: 'image', title: '示意图', image_url: 'https://example.test/image.png' }] });
  expect(data.messages[0].markdown).toContain('示意图');
  for (const output of [renderMarkdown(data), renderHtml(data)]) {
    expect(output).not.toContain(marker); expect(output).not.toContain('turn0image0');
    expect(output).toContain('https://example.test/image.png'); expect(output).toContain('前文'); expect(output).toContain('后文');
  }
});
it('retains image captions and available URLs instead of discarding the resource', () => {
  const data = conversation([{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://private', caption: '电路结构', url: 'https://example.test/circuit.png' }]);
  expect(data.messages[0].markdown).toContain('电路结构'); expect(data.messages[0].markdown).toContain('https://example.test/circuit.png');
  expect(renderMarkdown(data)).not.toContain('file-service://');
});
it('turns unresolved widgets and image groups into honest fallbacks without leaking JSON or internal identifiers', () => {
  const data = conversation(['开头\ue200image_group\ue202{"query":["海边"],"layout":"carousel"}\ue201中间\ue200chart\ue202{"internal_id":"secret-id"}\ue201结尾']);
  expect(data.messages[0].markdown).toContain('海边'); expect(data.messages[0].markdown).toContain('原对话');
  expect(data.messages[0].markdown).not.toMatch(/[\ue200\ue201\ue202]|secret-id|"layout"/);
  expect(data.warnings.join('')).toContain('交互');
});
it('keeps entity labels and citation source titles readable', () => {
  const data = conversation(['参观\ue200entity\ue202["place","上海博物馆","museum"]\ue201。\ue200cite\ue202turn0search0\ue201'], {
    content_references: [{ matched_text: '\ue200cite\ue202turn0search0\ue201', items: [{ title: '参观信息', url: 'https://example.test/visit' }] }],
  });
  expect(data.messages[0].markdown).toContain('上海博物馆'); expect(data.messages[0].markdown).toContain('参观信息');
  expect(data.messages[0].markdown).not.toMatch(/turn0search0|\ue200/);
});
it('does not modify literal protocol examples in code or user text', () => {
  const marker = '\ue200chart\ue202{"id":1}\ue201';
  const source = '```text\n' + marker + '\n```\n\n`' + marker + '`\n\n    ' + marker;
  expect(conversation([source]).messages[0].markdown).toBe(source);
  expect(conversation([marker], {}, 'user').messages[0].markdown).toBe(marker);
});
it('does not turn hostile widget metadata into executable HTML, links or markdown images', () => {
  const marker = '\ue200widget\ue202{}\ue201';
  const data = conversation([marker], { content_references: [{ matched_text: marker, title: '![](https://tracker.test/pixel)<script>x</script>', url: 'javascript:alert(1)' }] });
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  expect(doc.querySelectorAll('.body script,.body img,.body iframe,.body a[href^="javascript:"]')).toHaveLength(0);
  expect(renderMarkdown(data)).not.toContain('javascript:');
});
it('resolves ordinary citations outside code and keeps raw examples untouched', () => {
  const data = conversation(['参考〔来源1〕。代码 `〔来源1〕`'], { content_references: [{ matched_text: '〔来源1〕', title: '来源', url: 'https://example.test/source' }] });
  expect(data.messages[0].markdown).toContain('[来源](<https://example.test/source>)');
  expect(data.messages[0].markdown).toContain('`〔来源1〕`');
});
it('does not output broken internal image URLs and keeps unrelated private-use glyphs', () => {
  const data = conversation(['正文 ![生成的图](sandbox:/mnt/data/plot.png)\n图标：\ue200普通文字\n尾部']);
  expect(data.messages[0].markdown).toContain('生成的图');
  expect(data.messages[0].markdown).toContain('图标：\ue200普通文字');
  expect(data.messages[0].markdown).not.toContain('sandbox:');
});
it('keeps hostile resource labels inert in both formats', () => {
  const data = conversation([{ content_type: 'image_asset_pointer', caption: '![](https://tracker.test/pixel)', url: 'https://example.test/image.png' }]);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  expect(doc.querySelectorAll('.body img')).toHaveLength(0);
  expect(doc.querySelector('.body a')?.getAttribute('href')).toBe('https://example.test/image.png');
  expect(data.messages[0].markdown).toContain('\\!');
});
it('preserves text carried by media parts', () => {
  const data = conversation([{ content_type: 'audio_transcription', text: '完整转写正文' }, { content_type: 'image', text: '图片附带的说明' }]);
  expect(data.messages[0].markdown).toContain('完整转写正文');
  expect(data.messages[0].markdown).toContain('图片附带的说明');
});
it('respects escaped opening backticks and paragraph boundaries', () => {
  const marker = '\ue200chart\ue202{}\ue201';
  const code = '\\``' + marker + '`';
  expect(conversation([code]).messages[0].markdown).toBe(code);
  const separate = '`第一段\n\n' + marker + '\n\n第三段`';
  expect(conversation([separate]).messages[0].markdown).not.toContain(marker);
  const windowsSource = '代码 `' + marker + '`\r\n下一行';
  expect(conversation([windowsSource]).messages[0].markdown).toBe(windowsSource);
});
it('treats complete component payloads containing Markdown as a single unit', () => {
  const data = conversation(['前文 \ue200image_group\ue202{"query":["`Array.map` 用法示意图"]}\ue201 后文']);
  expect(data.messages[0].markdown).toContain('Array.map');
  expect(data.messages[0].markdown).toContain('后文');
  expect(data.messages[0].markdown).not.toMatch(/[\ue200\ue201\ue202]|"query"/);
});
it('retains trailing prose when a component has no trustworthy ending', () => {
  const data = conversation(['结论：\ue200chart\ue202{} 后面的正文必须保留']);
  expect(data.messages[0].markdown).toContain('后面的正文必须保留');
});
it('retains image reference captions even without a public URL', () => {
  const marker = '\ue200i\ue202turn0image0\ue201';
  const data = conversation([marker], { content_references: [{ matched_text: marker, type: 'image', caption: '电路结构图', image_url: 'file-service://private' }] });
  expect(data.messages[0].markdown).toContain('电路结构图');
  expect(data.messages[0].markdown).toContain('原对话');
  expect(data.messages[0].markdown).not.toContain('file-service:');
});
it('preserves table-cell code without pairing backticks across cells', () => {
  const marker = '\ue200chart\ue202{}\ue201';
  const table = '| A | B | C |\n| -- | -- | -- |\n| `literal | `' + marker + '` | ' + marker + ' |';
  const output = conversation([table]).messages[0].markdown!;
  expect(output).toContain('`' + marker + '`');
  expect(output).toContain('【交互内容，请在原对话查看】');
  expect(output.split(marker)).toHaveLength(2);
});

it('exports the reported nested UI layout as readable text rather than escaped tags or indented code', () => {
  const data = conversation([catchUpMarkup]);
  const markdown = renderMarkdown(data);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  for (const output of [markdown, doc.querySelector('.body')!.textContent!]) {
    expect(output).not.toMatch(/<\/?(?:box|text|row|icon|divider)\b|padding=|color=/);
    expect(output).toContain('R70 Catch-up 的实际接入关系');
    expect(output).toMatch(/MeasurementSource: FIFO 128[\s\S]*↓[\s\S]*Batcher: 3 Records \/ Batch[\s\S]*↓[\s\S]*UploadManager: PIPE4 \/ RETX/);
    expect(output).toContain('C1：监测三个队列的积压情况');
    expect(output).toContain('C2：达到阈值后，只清理尚未交给 BLE 的合法可丢弃记录');
    expect(output).toContain('C3：跨 Host/BLE 的完整恢复，当前禁止启用');
    expect(output).toContain('后续正文保持可读。');
  }
  expect(doc.querySelectorAll('.body pre,.body box,.body text')).toHaveLength(0);
  expect(doc.querySelectorAll('.body strong')).toHaveLength(4);
  expect(data.warnings.join('')).toContain('交互');
});

it('discards UI attributes with quoted delimiters and JSX expressions without executing or exposing them', () => {
  const data = conversation(['前文\n\n<box padding={3} title="a > b" onClick={() => fetch("https://tracker.test/private")}><text color="secondary">保留正文</text><icon name="unknown"/></box>\n\n后文']);
  const markdown = renderMarkdown(data);
  expect(markdown).toContain('保留正文'); expect(markdown).toContain('前文'); expect(markdown).toContain('后文');
  expect(markdown).not.toMatch(/<box|<text|<icon|onClick|tracker\.test|fetch\(/);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  expect(doc.querySelectorAll('.body script,.body img,.body iframe,[onclick]')).toHaveLength(0);
});

it('preserves intentional UI source examples in code and user messages', () => {
  const layout = '<box padding={3}><text color="secondary">示例</text></box>';
  const source = '```jsx\n' + layout + '\n```\n\n`' + layout + '`\n\n    ' + layout;
  expect(conversation([source]).messages[0].markdown).toBe(source);
  expect(conversation([layout], {}, 'user').messages[0].markdown).toBe(layout);
  const plainExamples = '使用 <box> 和 <text> 标签。\n\n<div>普通 HTML 示例</div>';
  expect(conversation([plainExamples]).messages[0].markdown).toBe(plainExamples);
});

it('keeps explicit code inside a converted layout intact and scopes conversion to complete layouts', () => {
  const code = '`<text color="secondary">行内示例</text>`';
  const fence = '```jsx\n<box padding={1}><text>代码示例</text></box>\n```';
  const source = '<box padding={2}><text size="sm">开头</text>\n\n' + code + '\n\n' + fence + '\n\n<text>结尾</text></box>\n\n`<box padding={2}>`';
  const output = conversation([source]).messages[0].markdown!;
  expect(output).toContain(code); expect(output).toContain(fence);
  expect(output).toContain('`<box padding={2}>`');
  expect(output).toContain('开头'); expect(output).toContain('结尾');
  expect(output).not.toContain('<text size="sm">');
});

it.each(['<icon name="arrow-down"/>', '<box>'])('preserves inline code %s inside indented layout text', literal => {
  const source = '<box padding={2}>\n\n    <text>保留示例 `' + literal + '` 和后文</text>\n\n</box>';
  const data = conversation([source]);
  expect(data.messages[0].markdown).toContain('`' + literal + '`');
  expect(data.messages[0].markdown).not.toContain('<box padding={2}>');
  expect(data.messages[0].markdown).not.toContain('<text>');
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  expect(doc.querySelector('.body code')?.textContent).toBe(literal);
  expect(doc.querySelector('.body')?.textContent).toContain('和后文');
  expect(doc.querySelectorAll('.body pre')).toHaveLength(0);
});

it('leaves malformed layouts and following prose intact rather than guessing component boundaries', () => {
  for (const source of [
    '<box padding={2}><text>没有结束的组件\n\n后面的正文必须保留',
    '<box padding={2}><text>错位结束</box></text>\n\n后面的正文必须保留',
  ]) expect(conversation([source]).messages[0].markdown).toBe(source);
});

it('exports the second screenshot with standalone UI text, metrics and a chart data table', () => {
  const data = conversation([intelligentUi]);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  for (const output of [renderMarkdown(data), doc.querySelector('.body')!.textContent!]) {
    expect(output).not.toMatch(/<\/?(?:text|row|title|Chart)\b|chartType|dataKey|tabularNums|content=|yAxisMin/);
    for (const text of ['计算方式', '非递增占比', 'L1', '8.42%', 'L3', '8.86%', 'R1', '9.23%', '仅表示序号非递增占比，不等于永久丢包率。', '118,532', 'CRC错误帧', '3帧', '0.0002245%', '1,336,285', '周期停流']) expect(output).toContain(text);
  }
  expect(doc.querySelectorAll('.body table')).toHaveLength(1);
  expect([...doc.querySelectorAll('.body tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))).toEqual([['L1', '8.42%'], ['L3', '8.86%'], ['R1', '9.23%']]);
  expect(doc.querySelectorAll('.body script,.body iframe,.body img,.body pre')).toHaveLength(0);
});

it.each([
  '<text color="secondary">独立正文</text>',
  '<row align="center" gap={3}>独立正文</row>',
  '<title size="xl" tabularNums>独立正文</title>',
  '<Text size="sm">独立正文</Text>',
])('converts standalone styled UI without requiring a box wrapper: %s', source => {
  const output = conversation([source]).messages[0].markdown!;
  expect(output.trim()).toBe('独立正文');
});

it('keeps every chart series, zero value, suffix and note when a chart is nested inside a layout', () => {
  const content = { chartType: 'line', meta: { title: '统计', footer: '完整说明' }, xKey: 'name', series: [
    { dataKey: 'a', label: '错误率', valueSuffix: '%' }, { dataKey: 'b', label: '计数', valueSuffix: '帧' },
  ], data: [{ name: '设备一', a: 0, b: 3 }, { name: '设备二', a: 1.25, b: 0 }] };
  const output = conversation(['<box padding={2}><Chart content={' + JSON.stringify(content) + '}/><text>后续解释</text></box>']).messages[0].markdown!;
  expect(output).toContain('| 设备一 | 0% | 3帧 |');
  expect(output).toContain('| 设备二 | 1.25% | 0帧 |');
  for (const text of ['统计', '错误率', '计数', '完整说明', '后续解释']) expect(output).toContain(text);
  expect(output).not.toMatch(/<box|<Chart|<text|dataKey/);
});

it('treats chart JSON as inert data even with Markdown, backticks, quotes and tag delimiters', () => {
  const content = { xKey: 'x', series: [{ dataKey: 'y', label: '![](https://tracker.test/pixel)' }], data: [
    { x: '`<box>` > } | <script>alert(1)</script>', y: 3 },
  ], meta: { footer: '正文 `示例` <text>' } };
  const data = conversation(['<Chart content={' + JSON.stringify(content) + '}/>\n\n后文']);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  expect(doc.querySelector('.body td')?.textContent).toBe('`<box>` > } | <script>alert(1)</script>');
  expect(doc.querySelector('.body')?.textContent).toContain('正文 `示例` <text>');
  expect(doc.querySelectorAll('.body script,.body img,.body iframe,.body a')).toHaveLength(0);
  expect(data.messages[0].markdown).not.toContain('<Chart');
});

it.each([
  '<Chart content={(() => fetch("https://tracker.test/private"))()}/>',
  '<Chart content={{"private_id":"secret-chart","unexpected":[]}}/>',
  '<FutureWidget content={{"private_id":"secret-widget"}}/>',
])('uses a readable fallback for unsupported component data without exposing it: %s', source => {
  const data = conversation(['前文\n\n' + source + '\n\n后文']);
  expect(data.messages[0].markdown).toContain('原对话');
  expect(data.messages[0].markdown).toContain('前文'); expect(data.messages[0].markdown).toContain('后文');
  expect(data.messages[0].markdown).not.toMatch(/<Chart|<FutureWidget|content=|secret-|private_id|fetch\(|tracker\.test/);
});

it('preserves new UI syntax in actual code examples and user messages', () => {
  const source = '<Chart content={{"data":[]}}/>';
  const codes = '```jsx\n' + intelligentUi + '\n```\n\n`' + source + '`\n\n    ' + source;
  expect(conversation([codes]).messages[0].markdown).toBe(codes);
  expect(conversation([intelligentUi], {}, 'user').messages[0].markdown).toBe(intelligentUi);
});

it('retains incomplete chart data and trailing prose when no tag boundary can be established', () => {
  const source = '<Chart content={{"data":[\n\n后面的正文必须保留';
  expect(conversation([source]).messages[0].markdown).toBe(source);
});

it('exports arbitrary component containers and public structured data without a component-name whitelist', () => {
  const source = '<FuturePanel><UnknownHeading label="设备汇总"/><future-metric padding={2} label="温度" value={23}/><NovelVisualization content={{"title":"设备列表","items":[{"设备":"A","温度":23},{"设备":"B","温度":24}],"description":"保留这段说明","private_id":"private-hidden"}}/></FuturePanel>';
  const data = conversation([source]);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  for (const output of [renderMarkdown(data), doc.querySelector('.body')!.textContent!]) {
    for (const label of ['设备汇总', '设备列表', '温度', '23', '24', '保留这段说明']) expect(output).toContain(label);
    expect(output).not.toMatch(/FuturePanel|UnknownHeading|future-metric|NovelVisualization|content=|private-hidden|private_id/);
  }
  expect(doc.querySelectorAll('.body table')).toHaveLength(1);
});

it('exports links, media descriptions, control values and checked states as static readable content', () => {
  const source = '<Stack gap={2}><Link href="https://example.test/docs">文档</Link><Image src="https://example.test/plot.png" alt="分布图"/><Button label="重新计算"/><Input label="人数" value={5}/><Checkbox label="准备完成" checked={true}/><Checkbox label="未完成" checked={false}/><Slider label="进度" value={25} min={0} max={100}/></Stack>';
  const data = conversation([source]);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  const body = doc.querySelector('.body')!;
  expect(body.querySelector('a[href="https://example.test/docs"]')?.textContent).toBe('文档');
  expect(body.querySelector('a[href="https://example.test/plot.png"]')?.textContent).toBe('分布图');
  for (const label of ['重新计算', '人数', '5', '☑', '☐', '准备完成', '未完成', '进度', '25', '100']) expect(body.textContent).toContain(label);
  expect(body.querySelectorAll('img,input,button,iframe,script')).toHaveLength(0);
  expect(data.messages[0].markdown).not.toMatch(/<Stack|<Button|<Input|<Checkbox|checked=|value=/);
});

it('exports table content, list items, tab labels and both tab bodies', () => {
  const source = '<Tabs><Tab label="方案一"><DataTable content={{"columns":[{"key":"name","label":"名称"},{"key":"count","label":"数量"}],"rows":[{"name":"设备A","count":3}]}}/></Tab><Tab label="方案二"><List><ListItem>第一项</ListItem><ListItem>第二项</ListItem></List></Tab></Tabs>';
  const data = conversation([source]);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  expect([...doc.querySelectorAll('.body th')].map(cell => cell.textContent)).toEqual(['名称', '数量']);
  expect([...doc.querySelectorAll('.body td')].map(cell => cell.textContent)).toEqual(['设备A', '3']);
  expect([...doc.querySelectorAll('.body li')].map(cell => cell.textContent)).toEqual(['第一项', '第二项']);
  expect(doc.querySelector('.body')?.textContent).toContain('方案一');
  expect(doc.querySelector('.body')?.textContent).toContain('方案二');
  expect(data.messages[0].markdown).not.toMatch(/<Tabs|<Tab|<DataTable|<List|content=/);
});

it('does not expose executable attributes or create unsafe links while retaining public labels', () => {
  const data = conversation(['<FutureCard title="可读标题" onClick={() => fetch("https://tracker.test/private")}><Link href="javascript:alert(1)">安全文字</Link><Image src="file-service://private" alt="图片说明"/></FutureCard>']);
  const output = renderMarkdown(data);
  expect(output).toContain('可读标题'); expect(output).toContain('安全文字'); expect(output).toContain('图片说明');
  expect(output).not.toMatch(/javascript:|file-service:|tracker\.test|onClick|fetch\(/);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  expect(doc.querySelectorAll('.body a,.body img,.body script,.body iframe')).toHaveLength(0);
});

it('preserves numeric and formatted content in the generic structured fallback', () => {
  const data = conversation(['<NewComponent content={{"title":"结果","value":0,"enabled":false,"details":{"count":3,"note":"a | b < c"},"items":["第一项","第二项"]}}/>']);
  const body = new DOMParser().parseFromString(renderHtml(data), 'text/html').querySelector('.body')!;
  for (const label of ['结果', '0', 'false', '3', 'a | b < c', '第一项', '第二项']) expect(body.textContent).toContain(label);
  expect(body.textContent).not.toMatch(/NewComponent|content=|\{"/);
});

it('handles complete unstyled native and unknown lowercase components', () => {
  const source = '<text>独立文本</text>\n\n<row><title>指标</title>3帧</row>\n\n<futurepanel><captionline>扩展说明</captionline></futurepanel>';
  const output = conversation([source]).messages[0].markdown!;
  expect(output).toContain('独立文本'); expect(output).toContain('指标'); expect(output).toContain('3帧'); expect(output).toContain('扩展说明');
  expect(output).not.toMatch(/<\/?(?:text|row|title|futurepanel|captionline)>/);
});

it('reads inert JSX object literals and direct table props without evaluating expressions', () => {
  const source = '<DataTable columns={[{key: \'name\', label: \'名称\'}, {key: \'count\', label: \'数量\'},]} rows={[{name: \'A\', count: 0}, {name: \'B\', count: 3}]}/>';
  const doc = new DOMParser().parseFromString(renderHtml(conversation([source])), 'text/html');
  expect([...doc.querySelectorAll('.body th')].map(cell => cell.textContent)).toEqual(['名称', '数量']);
  expect([...doc.querySelectorAll('.body td')].map(cell => cell.textContent)).toEqual(['A', '0', 'B', '3']);
});

it('retains an authored table structure and ordinary HTML examples outside a UI component', () => {
  const source = '<Card><table><thead><tr><th>名称</th><th>数量</th></tr></thead><tbody><tr><td>A</td><td>3</td></tr></tbody></table></Card>\n\n<div>普通 HTML 示例</div>';
  const data = conversation([source]);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  expect([...doc.querySelectorAll('.body th')].map(cell => cell.textContent)).toEqual(['名称', '数量']);
  expect([...doc.querySelectorAll('.body td')].map(cell => cell.textContent)).toEqual(['A', '3']);
  expect(data.messages[0].markdown).toContain('<div>普通 HTML 示例</div>');
});

it('retains captions, units and field values rather than dropping additional visible properties', () => {
  const source = '<Metric label="延迟" value={0} valueSuffix="ms" description="测量说明"/><Select label="方案" value="A" options={[{label: "方案A", value: "A"}, {label: "方案B", value: "B"}]}/>';
  const output = conversation([source]).messages[0].markdown!;
  for (const text of ['延迟', '0ms', '测量说明', '方案A', '方案B']) expect(output).toContain(text);
  expect(output).not.toContain('<Metric'); expect(output).not.toContain('<Select');
});

it('protects literal UI inside table-cell code without pairing backticks across cells', () => {
  const literal = '<Chart content={{"data":[]}}/>';
  const source = '| A | B |\n| --- | --- |\n| `literal | `' + literal + '` |';
  const data = conversation([source]);
  expect(data.messages[0].markdown).toBe(source);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  expect(doc.querySelectorAll('.body table')).toHaveLength(1);
  expect(doc.querySelector('.body code')?.textContent).toBe(literal);
});

it('retains media, link and authored table captions alongside their main content', () => {
  const source = '<Image alt="分布图" caption="n=12；初步结果"/><Link label="下载" description="明天过期" href="https://example.test"/><Card><table><caption>金额以千元计</caption><tr><th>名称</th><th>金额</th></tr><tr><td>A</td><td>3</td></tr></table></Card>';
  const data = conversation([source]);
  const doc = new DOMParser().parseFromString(renderHtml(data), 'text/html');
  for (const label of ['分布图', 'n=12；初步结果', '下载', '明天过期', '金额以千元计']) expect(doc.querySelector('.body')?.textContent).toContain(label);
  expect(doc.querySelectorAll('.body table')).toHaveLength(1);
});

it('retains top-level descriptions and captions in structured table data', () => {
  const data = conversation(['<DataTable content={{"title":"数据标题","description":"数据说明","caption":"样本说明","columns":["名称"],"rows":[["A"]]}}/>']);
  const body = new DOMParser().parseFromString(renderHtml(data), 'text/html').querySelector('.body')!;
  for (const label of ['数据标题', '数据说明', '样本说明']) expect(body.textContent).toContain(label);
  expect(body.querySelector('td')?.textContent).toBe('A');
});
