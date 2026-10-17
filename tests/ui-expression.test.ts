import {expect,it} from 'vitest';
import {uiExpression} from '../src/ui-expression';
import {expandUiTemplates} from '../src/ui-template';
const scope = new Map<string,unknown>([['item',['名称','说明']],['i',2],['rows',[1,2,3,4]]]);
it.each([['item[0]','名称'],['item[1]','说明'],['i < rows.length - 1',true],['i === 2 ? "danger" : "success"','danger'],['1 == "1"',true],['false',false],['0',0],['null',null]])('reads static expression %s accurately',(source,value) => {expect(uiExpression(source,scope)).toEqual({ok:true,value});});
it.each(['item.constructor','item["__proto__"]','globalThis','fetch("https://evil.test")','item.map(x => x)','i = 9','1/0','++i','--i','i++','i--','i + ++i'])('rejects executable, inherited or invalid access: %s',source => {expect(uiExpression(source,scope).ok).toBe(false);});
it('handles nested loop scopes and quoted braces without reparsing inserted text',() => {
  const source = '<box>{#each [["A","B"],["C"]] as row,i}{i}:{#each row as item,i}{i}={item};{/each}|{i}{/each}</box>';
  expect(expandUiTemplates(source,() => [],new Set()).replace(/\n/g,'')).toBe('<box>0:0=A;1=B;|01:0=C;|1</box>');
  const braces = '<box>{#each ["literal {#if true} text"] as item}{item}{/each}</box>';
  expect(expandUiTemplates(braces,() => [],new Set())).toContain('literal \\{\\#if true\\} text');
});
it('limits cumulative expansion across sibling loops and preserves surrounding prose',() => {
  const block = `{#each ${JSON.stringify(Array(256).fill(1))} as item}${'a'.repeat(5000)}{/each}`;
  const output = expandUiTemplates(`前文${block}中间${block}后文`,() => [],new Set());
  expect(output.length).toBeLessThan(2_000_100);
  expect(output.includes('动态模板无法静态还原')).toBe(true);
  expect(output.startsWith('前文')).toBe(true);
  expect(output).toContain('中间');
  expect(output.endsWith('后文')).toBe(true);
});
it('checks the last loop append and bounds nested expansion',() => {
  const block = `{#each [1,2] as item}${'a'.repeat(1_000_001)}{/each}`;
  const nested = `{#each ${JSON.stringify(Array(20).fill(1))} as row}{#each ${JSON.stringify(Array(20).fill(1))} as item}${'a'.repeat(7000)}{/each}{/each}`;
  for (const source of [block,nested]) {
    const output = expandUiTemplates(`前文${source}后文`,() => [],new Set());
    expect(output.length).toBeLessThan(2_000_100);
    expect(output.includes('动态模板无法静态还原')).toBe(true);
    expect(output.endsWith('后文')).toBe(true);
  }
});
it('bounds repeated escaping interpolations inside a single loop body',() => {
  const source = `{#each ${JSON.stringify(['*'.repeat(3000)])} as item}${'{item}'.repeat(5000)}{/each}后文`;
  const output = expandUiTemplates(source,() => [],new Set());
  expect(output.length).toBeLessThan(100);
  expect(output).toContain('动态模板无法静态还原');
  expect(output.endsWith('后文')).toBe(true);
});
