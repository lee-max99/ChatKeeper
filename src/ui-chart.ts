import { uiObject, uiScalar, type UiRecord } from './ui-data';

export interface StaticChart {svg:string;notes:string[];footer:string;}
const palette = ['#5097ff','#29aa9b','#9368d9','#efad43','#df6778','#7183b1','#7dae4e','#c27b4e'];
const color = (value: unknown,index:number) => typeof value === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value) ? value : palette[index % palette.length];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const number = (value:number) => String(Number(value.toPrecision(6)));

// Draw only chart schemas with known numeric meaning. Other schemas retain the
// existing data fallback. Source scripts, formatters and handlers are never run.
export function staticChart(props: UiRecord): StaticChart | undefined {
  const model = uiObject(props.content) || uiObject(props.data) || props;
  const kind = uiScalar(model.chartType).toLowerCase();
  if (!['bar','line'].includes(kind) || model.stacked || model.layout === 'vertical') return;
  const rows = Array.isArray(model.data) ? model.data.map(uiObject) : [];
  const series = Array.isArray(model.series) ? model.series.map(uiObject) : [];
  if (typeof model.xKey !== 'string' || !rows.length || rows.length > 256 || rows.some(row => !row) || !series.length || series.length > 8 || series.some(item => typeof item?.dataKey !== 'string' || item.stackId != null)) return;
  const columns = series as UiRecord[]; const data = rows as UiRecord[];
  const value = (row:UiRecord,column:UiRecord) => Object.hasOwn(row,String(column.dataKey)) ? row[String(column.dataKey)] : undefined;
  const values = data.flatMap(row => columns.map(column => value(row,column)).filter(finite));
  if (!values.length || data.some(row => columns.some(column => {const cell = value(row,column);return cell != null && !finite(cell);}))) return;
  const low = Math.min(0,...values);const high = Math.max(0,...values);const span = high - low || 1;
  if (!finite(span)) return;
  const quantum = 10 ** (Math.floor(Math.log10(span)) - 1);
  const min = finite(model.yAxisMin) ? model.yAxisMin : low < 0 ? Math.floor((low - span * .06) / quantum) * quantum : 0;
  const max = finite(model.yAxisMax) ? model.yAxisMax : high > 0 ? Math.ceil((high + span * .06) / quantum) * quantum : low < 0 ? 0 : 1;
  if (!finite(min) || !finite(max) || max <= min || min > Math.min(...values) || max < Math.max(...values)) return;
  const doc = new DOMParser().parseFromString('<!doctype html><body></body>','text/html');
  const create = (name:string,attrs:Record<string,string|number> = {},text?:string) => {
    const node = doc.createElementNS('http://www.w3.org/2000/svg',name);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
    if (text !== undefined) node.textContent = text;return node;
  };
  const width = 800;const height = 460;const left = 64;const right = 18;const top = columns.length > 1 ? Math.ceil(columns.length / 4) * 22 + 18 : 20;const bottom = 72;
  const plotWidth = width - left - right;const plotHeight = height - top - bottom;
  const y = (value:number) => top + (max - value) / (max - min) * plotHeight;
  const baseline = y(Math.min(max,Math.max(min,0)));const band = plotWidth / data.length;
  const svg = create('svg',{viewBox:`0 0 ${width} ${height}`,width:'100%',role:'img','aria-label':uiScalar(model.title) || uiScalar(uiObject(model.meta)?.title) || '静态数据图表',class:'ck-chart-svg'});
  svg.append(create('title',{},columns.map(item => uiScalar(item.label || item.dataKey)).join(' / ')));
  const unit = [...new Set(columns.map(item => uiScalar(item.valueSuffix)))];
  for (let tick = 0;tick <= 4;tick++) {
    const value = min + (max - min) * tick / 4;const yy = y(value);
    svg.append(create('line',{x1:left,y1:yy,x2:width-right,y2:yy,stroke:'#eaeaf0','stroke-dasharray':'3 4'}));
    svg.append(create('text',{x:left-10,y:yy+4,'text-anchor':'end',fill:'#8b8b93','font-size':12},number(value) + (unit.length === 1 ? unit[0] : '')));
  }
  data.forEach((row,index) => {
    const label = uiScalar(row[model.xKey as string]);const maxLength = Math.max(3,Math.floor(band / 12));const chars = [...label];
    const text = create('text',{x:left + band * (index + .5),y:height-bottom+26,'text-anchor':'middle',fill:'#77777f','font-size':12},chars.length > maxLength ? chars.slice(0,maxLength-1).join('') + '…' : label);
    text.append(create('title',{},label));svg.append(text);
  });
  columns.forEach((column,columnIndex) => {
    const paint = color(column.color,columnIndex);const label = uiScalar(column.label || column.dataKey);
    if (columns.length > 1) {svg.append(create('rect',{x:left + columnIndex % 4 * 178,y:10 + Math.floor(columnIndex / 4) * 22,width:10,height:10,rx:2,fill:paint}));svg.append(create('text',{x:left + columnIndex % 4 * 178+16,y:20 + Math.floor(columnIndex / 4) * 22,fill:'#77777f','font-size':12},label));}
    let points: string[] = [];
    const flush = () => {if (points.length) {svg.append(create('polyline',{points:points.join(' '),fill:'none',stroke:paint,'stroke-width':2.5}));points = [];}};
    data.forEach((row,index) => {
      const cell = value(row,column);if (!finite(cell)) {flush();return;}
      const x = left + band * (index + .5);const yy = y(cell);
      const tip = `${uiScalar(row[model.xKey as string])} · ${label}：${uiScalar(column.valuePrefix)}${cell}${uiScalar(column.valueSuffix)}`;
      if (kind === 'bar') {
        const barWidth = band * .8 / columns.length;const bar = create('rect',{x:left + index*band + band*.1 + columnIndex*barWidth,y:Math.min(yy,baseline),width:Math.max(.1,barWidth-3),height:Math.abs(yy-baseline),rx:Math.min(10,barWidth/7),fill:paint,class:'ck-chart-bar','data-value':cell});
        bar.append(create('title',{},tip));svg.append(bar);
      } else {
        points.push(`${x},${yy}`);
        const dot = create('circle',{cx:x,cy:yy,r:3,fill:paint,'data-value':cell});dot.append(create('title',{},tip));svg.append(dot);
      }
    });
    flush();
  });
  const meta = uiObject(model.meta);
  const notes = [...new Set([model.title,model.description,model.caption,meta?.title,meta?.subtitle].map(uiScalar).filter(Boolean))];
  return {svg:svg.outerHTML,notes,footer:[...new Set([model.footer,meta?.footer].map(uiScalar).filter(Boolean))].join(' · ')};
}
