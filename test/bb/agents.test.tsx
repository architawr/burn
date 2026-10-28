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
 const a=answer({report:r,family:{total:10,calls:4,estimated:false,children:[],agents:{coverage:'available',rows:[...r.agents!.rows,{...r.agents!.rows[0]!,id:'child-agent',cost:{input:1,output:0,cacheRead:0,cacheWrite:0,total:1}}]}}});
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
