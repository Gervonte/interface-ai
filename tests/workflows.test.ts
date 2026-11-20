import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DEFAULT_RUNTIME_BUDGETS } from '@interface-ai/contracts';
import type { Capability, Target, Values } from '@interface-ai/contracts';
import { workflowWorker } from '../apps/automation/src/workflows/worker.js';
import { DecisionSchema, outputLabels } from '../apps/automation/src/workflows/contracts.js';
import type { Observation } from '../apps/automation/src/workflows/contracts.js';
import type { Configuration, WorkerContext } from '../apps/automation/src/execution/coordinator.js';
import type { BrowserSurface, ResolvedTarget } from '../apps/automation/src/execution/surface.js';
import { Executor } from '../apps/automation/src/execution/executor.js';
import { DispatchGate } from '../apps/automation/src/execution/gate.js';
import { EvidenceStore } from '../apps/automation/src/execution/evidence.js';
import type { StoredEventInput } from '../apps/automation/src/db/repository.js';

const scope = { kind: 'frame' as const, frames: [{ attribute: 'title' as const, value: 'Member servicing workspace' }] };
const role = (name: string, role = 'button'): Target => ({ scope, within: [], locator: { kind: 'role', role: role as 'button', name, exact: true }, expectedMatches: 1 });
const field = (label: string): Target => ({ scope, within: [{ kind: 'container', locator: { kind: 'role', role: 'region', name: 'Account Details', exact: true } }], locator: { kind: 'field', label }, expectedMatches: 1 });
const row = { kind: 'tableRow' as const, tableCaption: 'Member accounts', cells: [{ columnHeader: 'Account Type', equals: { kind: 'literal' as const, value: 'Primary Savings' } }, { columnHeader: 'Designation', equals: { kind: 'literal' as const, value: 'Primary' } }] };
const blankOutputs = { memberId: '', accountId: '', accountType: '', currentBalanceMinor: '', currency: '' };
const goal = 'Find the primary savings account current balance for memberId.';
const configuration: Configuration = { target: { id: 'demo-credit-union', version: 2, surface: 'browser', applicationFamily: 'demo-credit-union', entryPoint: 'https://portal.example/' }, policy: { id: 'demo-policy', version: 2, allowedOrigins: ['https://portal.example'], allowedClickNames: ['Member Search', 'Search', 'Open', 'Account Inquiry'], allowedFillNames: ['Member ID'], allowedActions: ['navigate','click','fill','capture','wait','intervene'], allowRiskyActions: false, budgets: { ...DEFAULT_RUNTIME_BUDGETS, pollIntervalMs: 1, stepTimeoutMs: 100, activeTimeoutMs: 10_000 } } };
async function fixture(memberId: string, saved?: Capability, wrongIdentity = false, profile = false) {
  const config=structuredClone(configuration);if(profile){config.target.version=3;config.policy.allowedClickNames!.push('Acknowledge notice');config.policy.budgets.maxActions=300;}
  let screen = 'Staff workspace'; let location = 'about:blank'; let input = ''; let sequence = 0; let modelCalls = 0; let published: Capability | undefined; let outputs: Values | undefined;
  const accountId = memberId === 'M1001' ? 'S2001' : 'S2002';
  const money = memberId === 'M1001' ? '$1,250.34' : '$87.65';
  const actions: string[] = []; const events: StoredEventInput[] = [];
  const values: Record<string, string> = { 'Member ID': wrongIdentity ? 'M9999' : memberId, 'Account ID': accountId, 'Account Type': 'Primary Savings', Designation: 'Primary', Status: 'ACTIVE', Currency: 'USD', 'Current Balance': money, 'Available Balance': '$0.01' };
  const observe = async (): Promise<Observation> => {
    const controls: Observation['controls'] = [];
    const add = (label: Observation['controls'][number]['label'], target = role(label), kind: 'click' | 'fill' = 'click') => { const control = { ref: 'c' + (controls.length + 1), kind, label, target, enabled: true, filled: kind === 'fill' && input === memberId, row: {}, matchesInputs: [] }; controls.push(control); return control; };
    if (screen === 'Staff workspace') add('Member Search'); // A different route from Start Member Search is learned.
    if (screen === 'Member Search') { add('Member ID', { scope, within: [], locator: { kind: 'label', text: 'Member ID', exact: true }, expectedMatches: 1 }, 'fill'); add('Search'); if (actions.at(-1) === 'Search') add('Open', { ...role('Open'), within: [{ kind: 'tableRow', tableCaption: 'Member search results', cells: [{ columnHeader: 'Member ID', equals: { kind: 'input', name: 'memberId' } }] }] }); }
    if (screen === 'Member Overview') add('Account Inquiry');
    if (screen === 'Account Inquiry') { const control = add('Open', { ...role('Open'), within: [row] }); Object.assign(control, { row: { 'Account Type': 'Primary Savings', Designation: 'Primary' }, accountIdTarget: { scope, within: [row], locator: { kind: 'cell', columnHeader: 'Account ID' }, expectedMatches: 1 } }); }
    const fields: Observation['fields'] = screen === 'Account Details' ? Object.keys(values).map((label, index) => ({ ref: 'f' + (index + 1), label: label as 'Member ID', region: 'Account Details', target: field(label), matchesInputs: label === 'Member ID' ? ['memberId'] : [], constant: label === 'Designation' ? 'Primary' : null })) : [];
    return { observationId: randomUUID(), fingerprint: (screen + input + actions.length).split('').map(char => char.charCodeAt(0).toString(16)).join('').padEnd(64, '0').slice(0,64), ready: true, headings: [{ label: screen as 'Staff workspace', target: role(screen, 'heading') }], controls, fields };
  };
  const nameOf = (target: ResolvedTarget) => target.locator.kind === 'role' ? target.locator.name : target.locator.kind === 'label' ? target.locator.text : target.locator.kind === 'field' ? target.locator.label : target.locator.kind === 'cell' ? target.locator.columnHeader : '';
  const surface: BrowserSurface = { location: async () => location, observe,
    navigate: async url => { location = url; actions.push('navigate'); screen = 'Staff workspace'; },
    inspect: async target => {
      const name = nameOf(target); let count = target.locator.kind==='attribute'?0:1;
      if (target.locator.kind === 'role' && target.locator.role === 'heading') count = name === screen ? 1 : 0;
      for (const item of target.within) if (item.kind === 'tableRow') for (const cell of item.cells) { if (cell.columnHeader === 'Member ID' && cell.equals !== memberId) count = 0; if (cell.columnHeader === 'Account ID' && cell.equals !== accountId) count = 0; }
      return { count, visible: true, enabled: true, editable: name === 'Member ID' && screen === 'Member Search', text: values[name] ?? name, value: input, checked: false, tag: name === 'Member ID' && screen === 'Member Search' ? 'input' : 'button', name, inputType: 'text' };
    },
    dispatch: async (type, target, _policy, value) => { const name = nameOf(target); actions.push(name); if (type === 'fill') input = value!;
      else if (name === 'Member Search') screen = 'Member Search'; else if (name === 'Open') screen = screen === 'Member Search' ? 'Member Overview' : 'Account Details'; else if (name === 'Account Inquiry') screen = 'Account Inquiry'; },
    snapshot: async () => ({}) };
  const folder = await mkdtemp(tmpdir() + '/workflows-');
  const context: WorkerContext = { runId: randomUUID(), signal: new AbortController().signal, configuration:config,
    record: async event => { events.push(event); return ++sequence; }, capability: async () => { if (!saved) throw new Error('Missing artifact'); return saved; },
    executor: async (targets, variables) => new Executor({ runId: randomUUID(), entryPoint: config.target.entryPoint, policy: { ...config.policy, allowedFillNames: config.policy.allowedFillNames!, allowedClickNames: config.policy.allowedClickNames! }, targets, inputs: { memberId }, ...(variables ? { variables } : {}), surface, gate: new DispatchGate(2), revision: 2, signal: new AbortController().signal, routes: { 'fresh-session': 'about:blank', 'target-entry': config.target.entryPoint }, authorize: async () => {}, record: async event => { events.push(event); return ++sequence; }, evidence: new EvidenceStore(folder) }),
    plan: async ({ observation }) => {
      if (saved) throw new Error('Replay called the model'); modelCalls++;
      if (screen === 'Account Details') return DecisionSchema.parse({ observationId: observation.observationId, action: 'finish', controlRef: '', inputName: '', outputs: Object.fromEntries(Object.entries(outputLabels).map(([name,label]) => [name, observation.fields.find(field => field.label === label)!.ref])), reason: 'goal_complete' });
      const control = screen === 'Member Search' ? observation.controls.find(control => input !== memberId ? control.kind === 'fill' : actions.at(-1) === 'Search' ? control.label === 'Open' : control.label === 'Search')! : observation.controls[0]!;
      return { observationId: observation.observationId, action: control.kind, controlRef: control.ref, inputName: control.kind === 'fill' ? 'memberId' : '', outputs: blankOutputs, reason: 'continue' };
    }, publish: async (artifact, output) => { published = artifact; outputs = output; } };
  return { context, actions, events, surface, discover: () => workflowWorker({ mode:'discovery', targetId:'demo-credit-union', goal, inputs:{memberId} }, context), artifact: () => published!, outputs: () => outputs, calls: () => modelCalls };
}

describe('model-selected discovery and deterministic capability replay', () => {
  it('constructs a parameterized artifact from confirmed actions and replays another member without a planner', async () => {
    const discovery = await fixture('M1001'); await discovery.discover(); const artifact = discovery.artifact();
    expect(discovery.calls()).toBeGreaterThan(0); expect(discovery.outputs()).toMatchObject({ memberId:'M1001', accountId:'S2001', currentBalanceMinor:125034 });
    expect(JSON.stringify(artifact)).not.toMatch(/M1001|S2001|125034/);
    expect(artifact.steps.filter(step=>step.type==='click').map(step=>artifact.targets[step.target]?.locator)).toContainEqual({kind:'role',role:'button',name:'Member Search',exact:true});
    for (const step of artifact.steps) { expect(step.source.kind).toBe('discovery'); if(step.source.kind==='discovery') expect(discovery.events[step.source.eventSequence-1]).toMatchObject({stepId:step.id,type:step.type==='capture'?'READ_COMPLETED':'ACTION_COMPLETED'}); }
    const replay = await fixture('M1002',artifact); const result = await workflowWorker({ mode:'replay',targetId:'demo-credit-union',capability:{id:artifact.capabilityId,version:artifact.version},inputs:{memberId:'M1002'} },replay.context);
    expect(result).toMatchObject({kind:'success',output:{values:{memberId:'M1002',accountId:'S2002',currentBalanceMinor:8765,currency:'USD'}}}); expect(replay.calls()).toBe(0);
    expect(replay.actions).toEqual(discovery.actions);
  });
  it('rejects wrong-member completion before publishing', async()=> { const f=await fixture('M1001',undefined,true); await expect(f.discover()).rejects.toBeTruthy(); expect(f.artifact()).toBeUndefined(); });
  it('rejects mapping available balance as the current balance', async()=> { const f=await fixture('M1001'); const plan=f.context.plan; f.context.plan=async data=>{const decision=await plan(data); if(decision.action==='finish') decision.outputs.currentBalanceMinor=data.observation.fields.find(field=>field.label==='Available Balance')!.ref;return decision;};await expect(f.discover()).rejects.toMatchObject({message:'HUMAN_HELP_REQUIRED'});expect(f.artifact()).toBeUndefined(); });
  it('requires a UI-selected account before accepting a finish decision',async()=>{const f=await fixture('M1001');f.context.plan=async({observation})=>({observationId:observation.observationId,action:'finish',controlRef:'',inputName:'',outputs:blankOutputs,reason:'goal_complete'});await expect(f.discover()).rejects.toMatchObject({message:'HUMAN_HELP_REQUIRED'});expect(f.artifact()).toBeUndefined();});
  it('rejects a proposal for another observation before dispatch',async()=>{const f=await fixture('M1001');f.context.plan=async()=>({observationId:randomUUID(),action:'click',controlRef:'c1',inputName:'',outputs:blankOutputs,reason:'continue'});await expect(f.discover()).rejects.toMatchObject({message:'HUMAN_HELP_REQUIRED'});expect(f.actions).toEqual(['navigate']);});
  it('requires supported input bindings before creating a browser',async()=>{const f=await fixture('M1001');await expect(workflowWorker({mode:'discovery',targetId:'demo-credit-union',goal,inputs:{memberId:'invalid'}},f.context)).rejects.toMatchObject({code:'INVALID_BINDING'});expect(f.actions).toEqual([]);});
  it('fails unsupported goals without creating a browser or calling the planner',async()=>{const f=await fixture('M1001');await expect(workflowWorker({mode:'discovery',targetId:'demo-credit-union',goal:'Send a wire transfer.',inputs:{memberId:'M1001'}},f.context)).rejects.toMatchObject({code:'UNSUPPORTED_GOAL'});expect(f.actions).toEqual([]);expect(f.calls()).toBe(0);});
  it('attaches authored scenario rules to a newly discovered capability',async()=>{
    const f=await fixture('M1001',undefined,false,true);await f.discover();expect(f.artifact().outcomeRules).toHaveLength(3);expect(f.artifact().runtimeGuards!.some(rule=>rule.id==='account-identity')).toBe(true);
  });
  it('returns a record-qualified negative discovery outcome without fabricating a capability',async()=>{
    const f=await fixture('M1001',undefined,false,true);const inspect=f.surface.inspect;
    f.surface.inspect=async(target,policy)=>{const state=await inspect(target,policy);if(f.actions.includes('Search')){
      if(target.locator.kind==='attribute'&&target.locator.value==='No matching member')return{...state,count:1,visible:true};
      if(target.locator.kind==='field'&&target.locator.label==='Searched Member ID')return{...state,count:1,visible:true,text:'M1001'};
      if(target.locator.kind==='role'&&target.locator.name==='Open'&&target.within.some(scope=>scope.kind==='tableRow'&&scope.tableCaption==='Member search results'))return{...state,count:0};
    }return state;};
    expect(await f.discover()).toMatchObject({kind:'business_outcome',code:'MEMBER_NOT_FOUND'});expect(f.artifact()).toBeUndefined();expect(f.actions.filter(action=>action==='Search')).toHaveLength(1);
  });
  it('retains the actual recovery action as declared-rule provenance during discovery',async()=>{
    const f=await fixture('M1001',undefined,false,true);const inspect=f.surface.inspect;
    f.surface.inspect=async(target,policy)=>{const state=await inspect(target,policy);if(target.locator.kind==='attribute'&&['Servicing notice','true'].includes(target.locator.value)&&f.actions.includes('Account Inquiry')&&!f.actions.includes('Acknowledge notice'))return{...state,count:1,visible:true};return state;};
    await f.discover();const rule=f.artifact().recoveryRules.find(rule=>rule.id==='acknowledge-notice')!;expect(rule.source.observedEventSequences).toHaveLength(1);const sequence=rule.source.observedEventSequences![0]!;expect(f.events[sequence-1]).toMatchObject({type:'ACTION_COMPLETED',details:{operation:'click',targetRef:'ruleAcknowledge'}});expect(f.actions.filter(action=>action==='Acknowledge notice')).toHaveLength(1);
  });

});
