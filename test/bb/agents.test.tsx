// @vitest-environment jsdom
import {render, fireEvent, cleanup} from '@testing-library/react';
import {afterEach, expect, it} from 'vitest';
import {agentLabel, AgentRows, CostBreakdown} from '../../extensions/bb/agents.js';
import {applyDiscounts} from '../../src/discounts.js';
import {buildReport} from '../../src/report.js';
import {assistant} from '../helpers.js';
import {answer} from './fixtures.js';
afterEach(cleanup);
it('keeps agent spend inside report totals and discounts its token kinds exactly', () => {
 const r = buildReport([assistant(3), {...assistant(2), agentId:'native'}], null);
 expect(r.cost.total).toBe(5);
 expect(r.agents!.rows[0]!.cost.total).toBe(2);
 const priced = applyDiscounts(r, {input:50,output:0,cacheRead:0,cacheWrite:0});
 expect(priced.agents!.rows[0]!.cost.total).toBe(1.5);
 expect(r.agents!.rows[0]!.cost.total).toBe(2);
 expect(agentLabel(undefined)).toBe('Unavailable');
 expect(agentLabel({coverage:'partial',rows:[]})).toBe('Unavailable');
});
it('opens the calculation on hover or focus, closes on Escape, and keeps child-native spend separate', () => {
 const r=buildReport([assistant(3), {...assistant(2),agentId:'root-agent'}],null);
 r.agents!.coverage='available';
 const a=answer({report:r,family:{total:10,calls:4,estimated:false,children:[{threadId:'thr_child000',title:'Worker',cost:5,calls:2,running:false,model:null,estimated:false}],agents:{coverage:'available',rows:[...r.agents!.rows,{...r.agents!.rows[0]!,id:'child-agent',cost:{input:1,output:0,cacheRead:0,cacheWrite:0,total:1}}]}}});
 const ui=render(<CostBreakdown answer={a}>$5.00</CostBreakdown>);
 expect(ui.queryByRole('tooltip')).toBeNull();
 fireEvent.mouseEnter(ui.getByRole('button').parentElement!);
 expect(ui.getByRole('tooltip').textContent).toContain('Child threads, own calls$4.00');
 expect(ui.getByRole('tooltip').textContent).toContain('All subagents$3.00');
 fireEvent.keyDown(ui.getByRole('button'),{key:'Escape'});
 expect(ui.queryByRole('tooltip')).toBeNull();
 fireEvent.focus(ui.getByRole('button'));
 expect(ui.getByRole('tooltip').textContent).toContain('Total with children$10.00');
});
it('expands native rows as parts of their thread total', () => {
 const r=buildReport([{...assistant(2),agentId:'native'}],null);
 const ui=render(<AgentRows agents={r.agents}/>);
 expect(ui.getByText(/of the thread total/)).toBeTruthy();
 expect(ui.getByText('Subagent 1')).toBeTruthy();
});

for (const coverage of ["available", "partial"] as const) {
 it(`omits the entire child section without BB children (${coverage} native coverage)`, () => {
  const report=buildReport([assistant(3), {...assistant(2),agentId:'native'}],null);
  report.agents!.coverage=coverage;
  const a=answer({report,family:{total:5,calls:2,estimated:false,children:[],agents:report.agents}});
  const ui=render(<CostBreakdown answer={a}>$5.00</CostBreakdown>);
  const button=ui.getByRole('button', {name:'Cost calculation'});
  expect(button.className).toContain('decoration-dotted');
  expect(ui.queryByRole('tooltip')).toBeNull();
  fireEvent.mouseEnter(button.parentElement!);
  const tip=ui.getByRole('tooltip');
  expect(tip.textContent).toContain('This thread');
  expect(tip.textContent).toContain('Displayed amount$5.00');
  expect(tip.textContent).not.toMatch(/With children|Total with children|Child threads|All subagents/);
 });
}
it('keeps the child section when a reported child has zero cost', () => {
 const a=answer();
 a.family.children=[{threadId:'thr_child000',title:'Worker',cost:0,calls:0,running:false,model:null,estimated:false}];
 const ui=render(<CostBreakdown answer={a}>$4.82</CostBreakdown>);
 fireEvent.focus(ui.getByRole('button'));
 expect(ui.getByRole('tooltip').textContent).toContain('With children');
 expect(ui.getByRole('tooltip').textContent).toContain('Total with children$4.82');
});
