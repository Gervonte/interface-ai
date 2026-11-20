import{describe,expect,it}from'vitest';
import{randomUUID}from'node:crypto';
import{mkdtemp,readFile}from'node:fs/promises';
import{tmpdir}from'node:os';
import{parseCapability}from'@interface-ai/contracts';
import type{Predicate}from'@interface-ai/contracts';
import{attachBalanceRules}from'../apps/automation/src/workflows/rule-profile.js';
import{RuleEngine}from'../apps/automation/src/workflows/rules.js';
import{Executor}from'../apps/automation/src/execution/executor.js';
import{DispatchGate}from'../apps/automation/src/execution/gate.js';
import{EvidenceStore}from'../apps/automation/src/execution/evidence.js';
import{loadConfigurations}from'../apps/automation/src/db/repository.js';
import type{StoredEventInput}from'../apps/automation/src/db/repository.js';
import type{WorkerContext}from'../apps/automation/src/execution/coordinator.js';
async function fixture(initial:Record<string,string|number|boolean>={},recoverySucceedsAfter=1,discovery=false){
  const artifact=parseCapability(attachBalanceRules(parseCapability(JSON.parse(await readFile(new URL('../evidence/int-009-011/capability.json',import.meta.url),'utf8')))));
  artifact.targets.ready={scope:{kind:'document'},within:[],locator:{kind:'role',role:'heading',name:'Ready',exact:true},expectedMatches:1};
  const state:Record<string,string|number|boolean>={'Active member:Member ID':'M1001','Member Search Results:Searched Member ID':'M1001','Account Inquiry':true,...initial};
  const actions:string[]=[];const events:StoredEventInput[]=[];let sequence=0;const gate=new DispatchGate(2);
  const config=await loadConfigurations({target:new URL('../apps/automation/config/target.v3.json',import.meta.url),policy:new URL('../apps/automation/config/policy.v3.json',import.meta.url)});
  config.target.entryPoint='https://portal.example/';config.policy.allowedOrigins=['https://portal.example'];config.policy.budgets.stepTimeoutMs=200;config.policy.budgets.pollIntervalMs=50;
  const record=async(event:StoredEventInput)=>{events.push(event);return++sequence;};
  const executor=new Executor({runId:randomUUID(),entryPoint:config.target.entryPoint,policy:{...config.policy,allowedClickNames:config.policy.allowedClickNames!,allowedFillNames:config.policy.allowedFillNames!},targets:artifact.targets,inputs:{memberId:'M1001'},gate,revision:2,signal:new AbortController().signal,authorize:async()=>{},record,evidence:new EvidenceStore(await mkdtemp(tmpdir()+'/rules-')),surface:{location:async()=>config.target.entryPoint,navigate:async()=>{},snapshot:async()=>({schemaVersion:1,kind:'structural-snapshot',redactedValues:true,documents:[],omittedFrames:0}),
    inspect:async target=>{const locator=target.locator;const container=target.within.find(item=>item.kind==='container');const region=container?.kind==='container'&&container.locator.kind==='attribute'?container.locator.value:'';let key=locator.kind==='field'?region+':'+locator.label:locator.kind==='role'?locator.name:locator.kind==='attribute'?locator.value:locator.kind==='caption'?locator.text:'';
      if(locator.kind==='role'&&locator.name==='Open')key=target.within.some(item=>item.kind==='tableRow'&&item.tableCaption==='Member accounts')?'Eligible savings':'Member Open';
      if(locator.kind==='attribute'&&locator.name==='aria-modal')key='Any dialog';
      if(key==='Acknowledge notice')key='Servicing notice';if(key==='Try again')key='Account inquiry unavailable';
      const value=state[key];const count=typeof value==='number'?value:value?1:0;
      return{count,visible:count>0,enabled:true,editable:false,text:typeof value==='string'?value:key,value:'',checked:false,tag:'button',name:locator.kind==='role'?locator.name:key,inputType:''};},
    dispatch:async(_type,target)=>{const name=target.locator.kind==='role'?target.locator.name:'';actions.push(name);if(actions.length>=recoverySucceedsAfter){state['Servicing notice']=false;state['Account inquiry unavailable']=false;state['Any dialog']=false;state['Member accounts']=true;state.Ready=true;}},}});
  const context:WorkerContext={runId:randomUUID(),signal:new AbortController().signal,configuration:config,record,executor:async()=>executor,plan:async()=>{throw Error('Inference forbidden');},capability:async()=>artifact,publish:async()=>{throw Error('Unexpected publication');}};
  return{artifact,state,actions,events,gate,executor,context,engine:new RuleEngine(artifact,executor,context,discovery),stepId:artifact.steps[1]!.id,condition:{kind:'visible',target:'ready'}as Predicate};
}
describe('declared business outcomes and bounded UI recovery',()=>{
  it('validates the rule-augmented real capability without changing its discovered actions',async()=>{const f=await fixture();expect(f.artifact.outcomeRules).toHaveLength(3);expect(f.artifact.recoveryRules).toHaveLength(2);expect(f.artifact.runtimeGuards!.length).toBeGreaterThan(0);});
  it.each([['No matching member','MEMBER_NOT_FOUND'],['No primary savings account','NO_PRIMARY_SAVINGS_ACCOUNT'],['Access denied','ACCESS_DENIED']])('returns %s only with explicit record-qualified evidence',async(label,code)=>{const f=await fixture({[label]:true,...(code==='NO_PRIMARY_SAVINGS_ACCOUNT'?{'Member accounts':true}:{})});await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({code});expect(f.actions).toEqual([]);expect(f.events.some(event=>event.type==='BUSINESS_OUTCOME')).toBe(true);});
  it('does not infer a business negative from a missing control',async()=>{const f=await fixture();await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({code:'STATE_TIMEOUT'});expect(f.events.some(event=>event.type==='BUSINESS_OUTCOME')).toBe(false);});
  it('rejects wrong-member negative signals before considering an outcome',async()=>{const f=await fixture({'Active member:Member ID':'M1002','Access denied':true});await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({code:'IDENTITY_MISMATCH'});expect(f.events.some(event=>event.type==='BUSINESS_OUTCOME')).toBe(false);});
  it('rejects contradictory no-primary evidence when an eligible account is visible',async()=>{const f=await fixture({'No primary savings account':true,'Eligible savings':true,'Member accounts':true});await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({code:'CONFLICTING_SIGNALS'});});
  it('rejects multiple matching outcomes',async()=>{const f=await fixture({'No matching member':true,'Access denied':true});await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({code:'CONFLICTING_SIGNALS'});});
  it('waits for a delayed transition without dispatching another action',async()=>{const f=await fixture();const timer=setTimeout(()=>{f.state.Ready=true;},60);try{await f.engine.guard(f.condition,f.stepId);expect(f.actions).toEqual([]);}finally{clearTimeout(timer);}});
  it('acknowledges one known notice and verifies the recovered screen without a model',async()=>{const f=await fixture({'Servicing notice':true,'Any dialog':true},1,true);await f.engine.guard(f.condition,f.stepId);expect(f.actions).toEqual(['Acknowledge notice']);expect(f.events.some(event=>event.type==='RECOVERY_COMPLETED')).toBe(true);expect(f.artifact.recoveryRules[0]!.source.observedEventSequences).toHaveLength(1);});
  it('bounds persistent notice dismissal to two attempts',async()=>{const f=await fixture({'Servicing notice':true,'Any dialog':true},100);await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({code:'RECOVERY_EXHAUSTED'});expect(f.actions).toEqual(['Acknowledge notice','Acknowledge notice']);});
  it('retries only the declared inquiry control and preserves a run-wide attempt budget',async()=>{const f=await fixture({'Account inquiry unavailable':true},2);await f.engine.guard(f.condition,f.stepId);expect(f.actions).toEqual(['Try again','Try again']);f.state['Account inquiry unavailable']=true;f.state.Ready=false;await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({code:'RECOVERY_EXHAUSTED'});expect(f.actions).toHaveLength(2);});
  it.each([['Staff session expired','SESSION_EXPIRED'],['Servicing review required','UNEXPECTED_DIALOG']])('pauses on %s before dispatch',async(label,reason)=>{const f=await fixture({[label]:true,'Any dialog':true});await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({blocked:{reason,stepId:f.stepId}});expect(f.actions).toEqual([]);});
  it('stops target validation instead of repeatedly submitting Search',async()=>{const f=await fixture({'Member search validation error':true});await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({code:'TARGET_VALIDATION_ERROR'});expect(f.actions).toEqual([]);});
  it('cannot recover after dispatch admissions were closed',async()=>{const f=await fixture({'Account inquiry unavailable':true});f.gate.close();await expect(f.engine.guard(f.condition,f.stepId)).rejects.toMatchObject({code:'CONTROL_CHANGED'});expect(f.actions).toEqual([]);});
  it('resumes a blocked rule at its checkpoint and preserves explicit manual contribution provenance',async()=>{
    const f=await fixture({'Staff session expired':true,'Any dialog':true},1,true);let validations=0;
    f.context.intervene=async(_blocked,validate)=>{
      f.state['Staff session expired']=false;f.state['Any dialog']=false;f.state.Ready=true;
      expect(await validate()).toBe(true);validations++;return{interventionId:randomUUID(),eventSequences:[100]};
    };
    await f.engine.guard(f.condition,f.stepId);expect(validations).toBe(1);expect(f.engine.manualContributions).toMatchObject([{handling:'runtime_guard',guardId:'staff-session-expired',eventSequences:[100]}]);expect(f.actions).toEqual([]);
  });
  it('refuses hand-back when manual resolution changes the selected member identity',async()=>{
    const f=await fixture({'Staff session expired':true,'Any dialog':true});
    f.context.intervene=async(_blocked,validate)=>{f.state['Staff session expired']=false;f.state['Any dialog']=false;f.state.Ready=true;f.state['Active member:Member ID']='M1002';expect(await validate()).toBe(false);throw Error('HAND_BACK_REFUSED');};
    await expect(f.engine.guard(f.condition,f.stepId)).rejects.toThrow('HAND_BACK_REFUSED');expect(f.actions).toEqual([]);
  });

});
