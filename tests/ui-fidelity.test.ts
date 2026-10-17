import { expect, it } from 'vitest';
import { normalizeConversation } from '../src/conversation-api';
import { renderHtml, renderMarkdown } from '../src/exporters';

function data(source: string) {return normalizeConversation({current_node:'a',mapping:{a:{parent:null,message:{id:'a',author:{role:'assistant'},content:{parts:[source]}}}}},'https://chatgpt.com/c/test');}
const stages = [['原水系统','原水箱、原水泵 A/B/C'],['预处理 / 超滤 UF','盘滤、UF 双路运行、反洗及加药'],['一级反渗透 RO1','一级增压泵、高压泵 A/B/C'],['二级反渗透 RO2','二级增压泵、高压泵 A/B'],['EDI 电去离子','A/B 两套，各含 5 组电源及流量监控'],['后处理与终端供水','去离子泵、混床、终端供水泵']];
const flow = '<box border><column align="center" gap={3}>{#each '+JSON.stringify(stages,null,2)+' as item,i}<box align="center"><title>{item[0]}</title><text color="secondary">{item[1]}</text></box>{#if i < 5}<icon name="arrow-down"/>{/if}{/each}</column><text>按工程命名推断，实际管路应以 P&amp;ID 为准。</text></box>';

it('expands multiline tuple loops and index conditions into all six process stages', () => {
  const value = data(flow); const md = renderMarkdown(value);
  for (const [title,description] of stages) {expect(md).toContain(title);expect(md).toContain(description);}
  expect(md.match(/↓/g)).toHaveLength(5);
  expect(md).not.toMatch(/#each|\/each|\{item\[|动态模板/);
  const doc = new DOMParser().parseFromString(renderHtml(value),'text/html');
  expect(doc.querySelectorAll('.body .ck-title')).toHaveLength(6);
  expect(doc.querySelector('.body')?.textContent).not.toMatch(/#each|\/each|\{item\[/);
});
it('renders a static bar chart with exact source values while retaining its data table', () => {
  const model = {chartType:'bar',xKey:'category',series:[{dataKey:'count',label:'报警数量'}],data:['泵组故障','EDI 电源','EDI 流量低','压力/药剂/急停','水箱超高液位','温度/电导率','其他过程限值'].map((category,i) => ({category,count:[26,10,20,13,6,2,26][i]})),meta:{footer:'根据 BZ.xml 中非空的 103 条报警定义统计'}};
  const value = data('<Chart content={'+JSON.stringify(model)+'}/>'); const doc = new DOMParser().parseFromString(renderHtml(value),'text/html');
  const bars = [...doc.querySelectorAll('.body .ck-chart svg .ck-chart-bar')];
  expect(bars).toHaveLength(7);expect(bars.map(bar => bar.getAttribute('data-value'))).toEqual(['26','10','20','13','6','2','26']);
  expect(doc.querySelector('.body details table')).not.toBeNull();
  expect(doc.querySelector('.body figcaption')?.textContent).toContain('103');
  expect(renderMarkdown(value)).toContain('| 泵组故障 | 26 |');
});
it('handles zero, negative and missing values without inventing measurements or chart types', () => {
  const model = {chartType:'bar',xKey:'x',series:[{dataKey:'y',label:'测量'}],data:[{x:'负值',y:-3},{x:'零值',y:0},{x:'缺失',y:null},{x:'正值',y:6}]};
  const parse = (value:object) => new DOMParser().parseFromString(renderHtml(data('<Chart content={'+JSON.stringify(value)+'}/>')),'text/html');
  const doc = parse(model);const bars = [...doc.querySelectorAll('.ck-chart-bar')];
  expect(bars.map(bar => bar.getAttribute('data-value'))).toEqual(['-3','0','6']);
  expect(bars[1].getAttribute('height')).toBe('0');
  expect(Number(bars[0].getAttribute('y'))).toBeGreaterThan(Number(bars[2].getAttribute('y')));
  for (const value of [{...model,chartType:'pie'},{...model,stacked:true},{...model,data:[{x:'错误',y:'6'}]}]) {
    const fallback = parse(value);expect(fallback.querySelector('.ck-chart svg')).toBeNull();expect(fallback.querySelector('.body table')).not.toBeNull();
  }
});
it('preserves line series, gaps and safe labels without injecting source markup',() => {
  const model = {chartType:'line',xKey:'x',series:[{dataKey:'a',label:'<img src=x onerror=alert(1)>',valueSuffix:'%'},{dataKey:'b',label:'B'}],data:[{x:'第一项',a:2,b:0},{x:'第二项',a:null,b:3},{x:'第三项',a:4,b:6}],meta:{footer:'<script>source text</script>'}};
  const doc = new DOMParser().parseFromString(renderHtml(data('<Chart content={'+JSON.stringify(model)+'}/>')),'text/html');
  expect([...doc.querySelectorAll('.ck-chart circle')].map(node => node.getAttribute('data-value'))).toEqual(['2','4','0','3','6']);
  expect(doc.querySelectorAll('.ck-chart polyline')).toHaveLength(3);
  expect(doc.querySelector('.ck-chart')?.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(doc.querySelector('.ck-chart img, .ck-chart script')).toBeNull();
  expect(doc.querySelector('.ck-chart figcaption')?.textContent).toContain('<script>source text</script>');
});
