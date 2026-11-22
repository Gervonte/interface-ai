import { currentBalanceRequest, availableBalanceRequest } from '../examples/discovery-requests.js';
import {ExecutionError} from '../apps/automation/src/execution/errors.js';
import {resolveTarget} from '../apps/automation/src/execution/surface.js';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DEFAULT_RUNTIME_BUDGETS } from '@interface-ai/contracts';
import type { Capability, RunRequest, Target, Values } from '@interface-ai/contracts';
import { workflowWorker } from '../apps/automation/src/workflows/worker.js';
import { DecisionSchema, meaningLabels } from '../apps/automation/src/workflows/contracts.js';
import type { Observation } from '../apps/automation/src/workflows/contracts.js';
import type { Configuration, WorkerContext } from '../apps/automation/src/execution/coordinator.js';
import type { BrowserSurface, ResolvedTarget } from '../apps/automation/src/execution/surface.js';
import { Executor } from '../apps/automation/src/execution/executor.js';
import { DispatchGate } from '../apps/automation/src/execution/gate.js';
import { EvidenceStore } from '../apps/automation/src/execution/evidence.js';
import type { StoredEventInput } from '../apps/automation/src/db/repository.js';
import { riskyControlNames } from '../apps/automation/src/db/repository.js';
import { parseCapability } from '@interface-ai/contracts';

const scope = { kind: 'frame' as const, frames: [{ attribute: 'title' as const, value: 'Member servicing workspace' }] };
const role = (name: string, role = 'button'): Target => ({ scope, within: [], locator: { kind: 'role', role: role as 'button', name, exact: true }, expectedMatches: 1 });
const field = (label: string): Target => ({ scope, within: [{ kind: 'container', locator: { kind: 'role', role: 'region', name: 'Account Details', exact: true } }], locator: { kind: 'field', label }, expectedMatches: 1 });
const row = { kind: 'tableRow' as const, tableCaption: 'Member accounts', cells: [{ columnHeader: 'Account Type', equals: { kind: 'literal' as const, value: 'Primary Savings' } }, { columnHeader: 'Designation', equals: { kind: 'literal' as const, value: 'Primary' } }] };
const blankOutputs = { memberId: '', accountId: '', accountType: '', currentBalanceMinor: '', currency: '' };
const goal = 'Find the primary savings account current balance for memberId.';
const configuration: Configuration = { target: { id: 'demo-credit-union', version: 2, surface: 'browser', applicationFamily: 'demo-credit-union', entryPoint: 'https://portal.example/' }, policy: { id: 'demo-policy', version: 2, allowedOrigins: ['https://portal.example'], allowedClickNames: ['Member Search', 'Search', 'Open', 'Account Inquiry'], allowedFillNames: ['Member ID'], allowedActions: ['navigate','click','fill','capture','wait','intervene'], allowRiskyActions: false, budgets: { ...DEFAULT_RUNTIME_BUDGETS, pollIntervalMs: 1, stepTimeoutMs: 100, activeTimeoutMs: 10_000 } } };
async function fixture(memberId: string, saved?: Capability, wrongIdentity = false, profile = false, requested: Extract<RunRequest,{mode:'discovery'}> = currentBalanceRequest) {
  const config=structuredClone(configuration);config.policy.riskyControls=[{name:'Close account',effect:'irreversible',treatment:'block'}];if(profile){config.target.version=3;config.policy.allowedClickNames!.push('Acknowledge notice');config.policy.budgets.maxActions=300;}
  let screen = 'Staff workspace'; let location = 'about:blank'; let input = ''; let sequence = 0; let modelCalls = 0; let published: Capability | undefined; let outputs: Values | undefined;
  const selectedType=requested.outputContract.account.type==='checking'?'Checking':'Primary Savings';
  const accountId = (selectedType==='Checking'?'C':'S')+(memberId==='M1001'?'2001':'2002');
  const selectedRow={...row,cells:[{columnHeader:'Account Type',equals:{kind:'literal' as const,value:selectedType}},{columnHeader:'Designation',equals:{kind:'literal' as const,value:requested.outputContract.account.designation}}]};
  const money = memberId === 'M1001' ? '$1,250.34' : '$87.65';
  const actions: string[] = []; const events: StoredEventInput[] = [];
  const values: Record<string, string> = { 'Member ID': wrongIdentity ? 'M9999' : memberId, 'Account ID': accountId, 'Account Type': selectedType, Designation: requested.outputContract.account.designation, Status: requested.outputContract.account.status, Currency: 'USD', 'Current Balance': money, 'Available Balance': '$0.01' };
  const observe = async (): Promise<Observation> => {
    const controls: Observation['controls'] = [];
    const add = (label: Observation['controls'][number]['label'], target = role(label), kind: 'click' | 'fill' = 'click') => { const control = { ref: 'c' + (controls.length + 1), kind, label, target, enabled: true, filled: kind === 'fill' && input === memberId, row: {}, matchesInputs: [] }; controls.push(control); return control; };
    if (screen === 'Staff workspace') add('Member Search'); // A different route from Start Member Search is learned.
    if (screen === 'Member Search') { add('Member ID', { scope, within: [], locator: { kind: 'label', text: 'Member ID', exact: true }, expectedMatches: 1 }, 'fill'); add('Search'); if (actions.at(-1) === 'Search') add('Open', { ...role('Open'), within: [{ kind: 'tableRow', tableCaption: 'Member search results', cells: [{ columnHeader: 'Member ID', equals: { kind: 'input', name: 'memberId' } }] }] }); }
    if (screen === 'Member Overview') add('Account Inquiry');
    if (screen === 'Account Inquiry') { const control = add('Open', { ...role('Open'), within: [selectedRow] }); Object.assign(control, { row: { 'Account Type': selectedType, Designation: requested.outputContract.account.designation, Status: requested.outputContract.account.status==='ACTIVE'?'Active':'Closed' }, accountIdTarget: { scope, within: [selectedRow], locator: { kind: 'cell', columnHeader: 'Account ID' }, expectedMatches: 1 } }); }
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
    executor: async (targets, variables) => new Executor({ runId: randomUUID(), entryPoint: config.target.entryPoint, policy: { ...config.policy, allowedFillNames: config.policy.allowedFillNames!, allowedClickNames: config.policy.allowedClickNames!, riskyControlNames: riskyControlNames(config.policy) }, targets, inputs: { memberId }, ...(variables ? { variables } : {}), surface, gate: new DispatchGate(2), revision: 2, signal: new AbortController().signal, routes: { 'fresh-session': 'about:blank', 'target-entry': config.target.entryPoint }, authorize: async () => {}, record: async event => { events.push(event); return ++sequence; }, evidence: new EvidenceStore(folder) }),
    plan: async ({ observation, outputContract }) => {
      if (saved) throw new Error('Replay called the model'); modelCalls++;
      if (screen === 'Account Details') return DecisionSchema.parse({ observationId: observation.observationId, action: 'finish', controlRef: '', inputName: '', outputs: Object.fromEntries(Object.entries(outputContract.fields).map(([name,field]) => [name, observation.fields.find(item => item.label === meaningLabels[field.meaning])!.ref])), reason: 'goal_complete' });
      const control = screen === 'Member Search' ? observation.controls.find(control => input !== memberId ? control.kind === 'fill' : actions.at(-1) === 'Search' ? control.label === 'Open' : control.label === 'Search')! : observation.controls[0]!;
      return { observationId: observation.observationId, action: control.kind, controlRef: control.ref, inputName: control.kind === 'fill' ? 'memberId' : '', outputs: Object.fromEntries(Object.keys(outputContract.fields).map(name=>[name,''])), reason: 'continue' };
    }, publish: async (artifact, output) => { published = artifact; outputs = output; } };
  return { context, actions, events, surface, discover: () => workflowWorker({ ...requested, inputs:{memberId} }, context), artifact: () => published!, outputs: () => outputs, calls: () => modelCalls };
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
  it('uses requested available-balance semantics and arbitrary output names without task keywords',async()=>{
    const request=structuredClone(availableBalanceRequest);request.goal='Read the requested figures for the bound record.';
    const aliases:Record<string,string>={memberId:'subject',accountId:'account',accountType:'kind',availableBalanceMinor:'amount',currency:'unit'};
    request.outputContract.fields=Object.fromEntries(Object.entries(request.outputContract.fields).map(([name,field])=>[aliases[name]!,field]));
    const discovery=await fixture('M1001',undefined,false,true,request);await discovery.discover();const artifact=discovery.artifact();
    expect(discovery.outputs()).toEqual({subject:'M1001',account:'S2001',kind:'savings',amount:1,unit:'USD'});
    expect(artifact.targets[artifact.outputs.amount!.target]!.locator).toEqual({kind:'field',label:'Available Balance'});
    expect(artifact.outputSchema.required.sort()).toEqual(['account','amount','kind','subject','unit']);
    const replay=await fixture('M1002',artifact,false,true,request);
    expect(await workflowWorker({mode:'replay',targetId:'demo-credit-union',capability:{id:artifact.capabilityId,version:artifact.version},inputs:{memberId:'M1002'}},replay.context)).toMatchObject({kind:'success',output:{values:{subject:'M1002',account:'S2002',amount:1}}});
    expect(replay.calls()).toBe(0);
  });
  it('describes what the capability does and what each output means from the request contract, without record values',async()=>{
    for(const [request,balance,field] of [[currentBalanceRequest,'current balance','currentBalanceMinor'],[availableBalanceRequest,'available balance','availableBalanceMinor']] as const){
      const f=await fixture('M1001',undefined,false,true,request);await f.discover();const artifact=f.artifact();
      expect(artifact.name).toBe('Account inquiry: '+balance);
      expect(artifact.description).toContain(`opens the member's active primary savings account`);expect(artifact.description).toContain('Declared business outcomes: MEMBER_NOT_FOUND');
      expect(Object.keys(artifact.outputDescriptions!).sort()).toEqual(Object.keys(artifact.outputs).sort());
      expect(artifact.outputDescriptions![field]!.toLowerCase().startsWith(balance)).toBe(true);
      expect(JSON.stringify([artifact.name,artifact.description,artifact.outputDescriptions])).not.toMatch(/M100\d|S200\d|\$\d|125034|120034/);
    }
    const f=await fixture('M1001');await f.discover();const artifact=structuredClone(f.artifact());delete artifact.outputDescriptions!.currency;
    expect(()=>parseCapability(artifact)).toThrow();
  });
  it('replays a saved capability locally through the same engine, without a coordinator, database or model',async()=>{
    const { replayLocally } = await import('../apps/automation/src/execution/local-replay.js');
    const discovery=await fixture('M1001');await discovery.discover();const artifact=discovery.artifact();
    const replay=await fixture('M1002',artifact);const folder=await mkdtemp(tmpdir()+'/local-replay-');let closes=0;
    const record=await replayLocally(artifact,{memberId:'M1002'},{configuration:replay.context.configuration,evidenceDirectory:folder,openSurface:async()=>({surface:replay.surface,close:async()=>{closes++;}})});
    expect(record.result).toMatchObject({kind:'success',output:{values:{memberId:'M1002',accountId:'S2002',currentBalanceMinor:8765}}});
    expect(record).toMatchObject({mode:'local-replay',modelCalls:0,inferenceAttempts:0,browserClosed:true,inputNames:['memberId']});expect(closes).toBe(1);
    expect(replay.actions).toEqual(discovery.actions);expect(JSON.stringify(record.events)).not.toMatch(/M1002|S2002|8765/);
    const other=structuredClone(replay.context.configuration);other.target.applicationFamily='other-application';
    await expect(replayLocally(artifact,{memberId:'M1002'},{configuration:other,evidenceDirectory:folder,openSurface:async()=>{throw new Error('opened');}})).rejects.toMatchObject({code:'UNSUPPORTED_SURFACE'});
  });
  it('refuses to open a local browser for a non-loopback target',async()=>{
    const { openLocalBrowser } = await import('../apps/automation/src/execution/local-browser.js');
    const f=await fixture('M1001');
    await expect(openLocalBrowser(f.context.configuration)).rejects.toMatchObject({code:'POLICY_BLOCKED'});
  });
  it('rejects current balance when the requested meaning is available balance',async()=>{
    const f=await fixture('M1001',undefined,false,false,availableBalanceRequest);const plan=f.context.plan;
    f.context.plan=async data=>{const result=await plan(data);if(result.action==='finish')result.outputs.availableBalanceMinor=data.observation.fields.find(field=>field.label==='Current Balance')!.ref;return result;};
    await expect(f.discover()).rejects.toMatchObject({message:'HUMAN_HELP_REQUIRED'});expect(f.artifact()).toBeUndefined();
  });
  it('checks requested account criteria before dispatching the account Open control',async()=>{
    const f=await fixture('M1001');const observe=f.surface.observe!;
    f.surface.observe=async(inputs,policy)=>{const o=await observe(inputs,policy);for(const c of o.controls)if(c.accountIdTarget)c.row.Designation='Standard';return o;};
    await expect(f.discover()).rejects.toMatchObject({message:'HUMAN_HELP_REQUIRED'});expect(f.actions.filter(action=>action==='Open')).toHaveLength(1);expect(f.artifact()).toBeUndefined();
  });
  it('supports a checking account without applying the missing-primary-savings outcome',async()=>{
    const request=structuredClone(currentBalanceRequest);request.goal='Read the current balance of the active standard checking account.';
    request.outputContract.account={type:'checking',designation:'Standard',status:'ACTIVE'};
    request.outputContract.fields.accountType!.schema={type:'string',enum:['checking'],maxLength:20};
    const f=await fixture('M1001',undefined,false,true,request);const inspect=f.surface.inspect;
    f.surface.inspect=async(target,policy)=>{const state=await inspect(target,policy);return target.locator.kind==='attribute'&&target.locator.value==='No primary savings account'?{...state,count:1,visible:true}:state;};
    await f.discover();expect(f.outputs()).toMatchObject({accountId:'C2001',accountType:'checking'});
    expect(f.artifact().outcomeRules.some(rule=>rule.code==='NO_PRIMARY_SAVINGS_ACCOUNT')).toBe(false);
    const replay=await fixture('M1002',f.artifact(),false,true,request);
    expect(await workflowWorker({mode:'replay',targetId:'demo-credit-union',capability:{id:f.artifact().capabilityId,version:1},inputs:{memberId:'M1002'}},replay.context)).toMatchObject({kind:'success',output:{values:{accountId:'C2002',accountType:'checking'}}});
  });
  it('rejects an invalid requested contract before creating a browser',async()=>{
    const f=await fixture('M1001');const request=structuredClone(currentBalanceRequest);delete request.outputContract.fields.currency;
    await expect(workflowWorker(request,f.context)).rejects.toMatchObject({code:'INVALID_OUTPUT_CONTRACT'});expect(f.actions).toEqual([]);expect(f.calls()).toBe(0);
  });
  it('rejects wrong-member completion before publishing', async()=> { const f=await fixture('M1001',undefined,true); await expect(f.discover()).rejects.toBeTruthy(); expect(f.artifact()).toBeUndefined(); });
  it('rejects mapping available balance as the current balance', async()=> { const f=await fixture('M1001'); const plan=f.context.plan; f.context.plan=async data=>{const decision=await plan(data); if(decision.action==='finish') decision.outputs.currentBalanceMinor=data.observation.fields.find(field=>field.label==='Available Balance')!.ref;return decision;};await expect(f.discover()).rejects.toMatchObject({message:'HUMAN_HELP_REQUIRED'});expect(f.artifact()).toBeUndefined(); });
  it('requires a UI-selected account before accepting a finish decision',async()=>{const f=await fixture('M1001');f.context.plan=async({observation})=>({observationId:observation.observationId,action:'finish',controlRef:'',inputName:'',outputs:blankOutputs,reason:'goal_complete'});await expect(f.discover()).rejects.toMatchObject({message:'HUMAN_HELP_REQUIRED'});expect(f.artifact()).toBeUndefined();});
  it('rejects a proposal for another observation before dispatch',async()=>{const f=await fixture('M1001');f.context.plan=async()=>({observationId:randomUUID(),action:'click',controlRef:'c1',inputName:'',outputs:blankOutputs,reason:'continue'});await expect(f.discover()).rejects.toMatchObject({message:'HUMAN_HELP_REQUIRED'});expect(f.actions).toEqual(['navigate']);});
  it('requires supported input bindings before creating a browser',async()=>{const f=await fixture('M1001');await expect(workflowWorker({mode:'discovery',outputContract:currentBalanceRequest.outputContract,targetId:'demo-credit-union',goal,inputs:{memberId:'invalid'}},f.context)).rejects.toMatchObject({code:'INVALID_BINDING'});expect(f.actions).toEqual([]);});
  it('stops when the planner cannot support the goal, without dispatching its proposed UI action',async()=>{const f=await fixture('M1001');const plan=f.context.plan;f.context.plan=async data=>({...await plan(data),action:'help',controlRef:'',inputName:'',reason:'unsupported_goal'});await expect(workflowWorker({...currentBalanceRequest,goal:'Send a wire transfer.'},f.context)).rejects.toMatchObject({code:'UNSUPPORTED_GOAL'});expect(f.actions).toEqual(['navigate']);expect(f.calls()).toBe(1);});
  it('stops without publishing when the planner reports a goal/contract conflict on Account Details',async()=>{
    // Goal asks for available balance while the contract requests current balance; only the planner can judge the natural-language conflict.
    const f=await fixture('M1001');const plan=f.context.plan;
    f.context.plan=async data=>{const decision=await plan(data);return decision.action==='finish'?{...decision,action:'help',outputs:Object.fromEntries(Object.keys(data.outputContract.fields).map(name=>[name,''])),reason:'unsupported_goal'}:decision;};
    await expect(workflowWorker({...currentBalanceRequest,goal:'Find the available balance of the member\'s active primary savings account.'},f.context)).rejects.toMatchObject({code:'UNSUPPORTED_GOAL'});
    expect(f.actions.filter(action=>action==='Open')).toHaveLength(2);expect(f.artifact()).toBeUndefined();
  });
  it('rejects a finish decision that omits a requested output ref',async()=>{
    const f=await fixture('M1001',undefined,false,false,availableBalanceRequest);const plan=f.context.plan;
    f.context.plan=async data=>{const decision=await plan(data);if(decision.action==='finish'){const {availableBalanceMinor:_omitted,...rest}=decision.outputs;return {...decision,outputs:rest};}return decision;};
    await expect(f.discover()).rejects.toMatchObject({code:'ARTIFACT_INVALID'});expect(f.artifact()).toBeUndefined();
  });
  it('replaces input values and credential-shaped tokens in the goal before it reaches the planner',async()=>{
    const f=await fixture('M1001');const plan=f.context.plan;const seen:unknown[]=[];
    f.context.plan=async data=>{seen.push(data);return plan(data);};
    await workflowWorker({...currentBalanceRequest,goal:'Read M1001 savings balance. Token sk-syntheticSecretMarker123 Bearer bb_live_syntheticMarker4567',inputs:{memberId:'M1001'}},f.context);
    const sent=JSON.stringify(seen);
    expect(sent).toContain('{{input.memberId}}');expect(sent).toContain('[REDACTED]');
    expect(sent).not.toMatch(/M1001|syntheticSecretMarker|syntheticMarker4567|\$1,250\.34/);
  });
  it('blocks a planner-selected risky control during discovery without dispatching it',async()=>{
    const f=await fixture('M1001');const observe=f.surface.observe!;
    f.surface.observe=async(inputs,policy)=>{const o=await observe(inputs,policy);if(o.headings.some(h=>h.label==='Account Details'))o.controls.push({ref:'cx',kind:'click',label:'Close account' as 'Open',target:role('Close account'),enabled:true,filled:false,row:{},matchesInputs:[]});return o;};
    const plan=f.context.plan;
    f.context.plan=async data=>data.observation.controls.some(c=>c.ref==='cx')?{observationId:data.observation.observationId,action:'click',controlRef:'cx',inputName:'',outputs:Object.fromEntries(Object.keys(data.outputContract.fields).map(n=>[n,''])),reason:'continue'}:plan(data);
    await expect(f.discover()).rejects.toMatchObject({code:'RISKY_ACTION_BLOCKED'});
    expect(f.actions).not.toContain('Close account');expect(f.artifact()).toBeUndefined();
    expect(f.events.find(e=>e.type==='ACTION_FAILED')?.details).toMatchObject({code:'RISKY_ACTION_BLOCKED',dispatchState:'not_sent'});
  });
  it('blocks a saved step retargeted to a risky control during model-free replay',async()=>{
    const discovery=await fixture('M1001');await discovery.discover();const artifact=structuredClone(discovery.artifact());
    const click=artifact.steps.find(step=>step.type==='click'&&artifact.targets[step.target]?.locator.kind==='role'&&(artifact.targets[step.target]!.locator as {name:string}).name==='Account Inquiry');
    if(click?.type!=='click')throw new Error('Missing Account Inquiry step');
    (artifact.targets[click.target]!.locator as {name:string}).name='Close account';
    const replay=await fixture('M1002',artifact);
    await expect(workflowWorker({mode:'replay',targetId:'demo-credit-union',capability:{id:artifact.capabilityId,version:artifact.version},inputs:{memberId:'M1002'}},replay.context)).rejects.toMatchObject({code:'RISKY_ACTION_BLOCKED'});
    expect(replay.actions).not.toContain('Close account');expect(replay.calls()).toBe(0);
  });
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

  it('publishes a guarded discovery handoff with its declared guard and replays the same boundary without inference',async()=>{
    const manualDialog=(f:Awaited<ReturnType<typeof fixture>>)=>{
      let dismissed=false;const inspect=f.surface.inspect;
      f.surface.inspect=async(target,policy)=>{
        const state=await inspect(target,policy);
        if(target.locator.kind==='attribute'&&target.locator.name==='aria-modal'&&target.locator.value==='true'&&f.actions.filter(action=>action==='Open').length===2&&!dismissed)return{...state,count:1,visible:true};
        return state;
      };
      f.context.intervene=async(blocked,validate)=>{
        expect(blocked.reason).toBe('UNEXPECTED_DIALOG');const interventionId=randomUUID();dismissed=true;
        await f.surface.dispatch('click',resolveTarget(role('Dismiss servicing review'),{},{}),configuration.policy as any);
        const eventSequence=await f.context.record({type:'ACTION_COMPLETED',actor:'human',stepId:'manual-dismiss',interventionId,details:{code:'confirmed',operation:'click'}});
        expect(await validate()).toBe(true);return{interventionId,eventSequences:[eventSequence]};
      };
    };
    const discovery=await fixture('M1001',undefined,false,true);manualDialog(discovery);await discovery.discover();const artifact=discovery.artifact();
    expect(artifact.manualContributions).toMatchObject([{handling:'runtime_guard',guardId:'unexpected-dialog'}]);
    expect(artifact.runtimeGuards!.find(guard=>guard.id==='unexpected-dialog')).toMatchObject({handling:'intervention'});
    expect(artifact.steps.some(step=>step.type==='click'&&artifact.targets[step.target]?.locator.kind==='role'&&(artifact.targets[step.target]!.locator as any).name==='Dismiss servicing review')).toBe(false);
    const replay=await fixture('M1002',artifact,false,true);manualDialog(replay);
    expect(await workflowWorker({mode:'replay',targetId:'demo-credit-union',capability:{id:artifact.capabilityId,version:artifact.version},inputs:{memberId:'M1002'}},replay.context)).toMatchObject({kind:'success',output:{values:{memberId:'M1002',accountId:'S2002',currentBalanceMinor:8765}}});
    expect(replay.calls()).toBe(0);expect(replay.actions).toEqual(discovery.actions);
  });

  it('treats an unavailable model as a hard failure without inventing a resumable checkpoint',async()=>{
    const f=await fixture('M1001');f.context.plan=async()=>{throw new ExecutionError('MODEL_UNAVAILABLE');};
    await expect(f.discover()).rejects.toMatchObject({code:'MODEL_UNAVAILABLE'});expect(f.artifact()).toBeUndefined();
  });
  it('records explicit planner-help contributions and preserves the manual boundary during model-free replay',async()=>{
    const discovery=await fixture('M1001');const plan=discovery.context.plan;let first=true;
    discovery.context.plan=async data=>{const decision=await plan(data);if(first){first=false;return{...decision,action:'help',controlRef:'',inputName:'',outputs:blankOutputs,reason:'blocked'};}return decision;};
    const manual=(f:Awaited<ReturnType<typeof fixture>>)=>async(_blocked:unknown,validate:()=>Promise<boolean>)=>{
      const interventionId=randomUUID();await f.surface.dispatch('click',resolveTarget(role('Member Search'),{memberId:'M1001'},{}),configuration.policy as any);
      const eventSequence=await f.context.record({type:'ACTION_COMPLETED',actor:'human',stepId:'manual-search',interventionId,details:{code:'confirmed',operation:'click'}});
      expect(await validate()).toBe(true);return{interventionId,eventSequences:[eventSequence]};
    };
    discovery.context.intervene=manual(discovery);await discovery.discover();const artifact=discovery.artifact();
    expect(artifact.manualContributions).toMatchObject([{handling:'required_intervention'}]);expect(artifact.steps.some(step=>step.type==='intervene')).toBe(true);
    const replay=await fixture('M1002',artifact);replay.context.intervene=manual(replay);
    const result=await workflowWorker({mode:'replay',targetId:'demo-credit-union',capability:{id:artifact.capabilityId,version:artifact.version},inputs:{memberId:'M1002'}},replay.context);
    expect(result).toMatchObject({kind:'success',output:{values:{memberId:'M1002',currentBalanceMinor:8765}}});expect(replay.calls()).toBe(0);
  });

});
