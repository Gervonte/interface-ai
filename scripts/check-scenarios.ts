import{randomUUID}from'node:crypto';
import{mkdir,readFile,writeFile}from'node:fs/promises';
import{resolve}from'node:path';
import{createPool}from'@interface-ai/postgres';
import{parseCapability}from'@interface-ai/contracts';
import{AutomationRepository,loadConfigurations}from'../apps/automation/src/db/repository.js';
import{Coordinator}from'../apps/automation/src/execution/coordinator.js';
import{BrowserbaseSessions}from'../apps/automation/src/execution/provider.js';
import{EvidenceStore}from'../apps/automation/src/execution/evidence.js';
import{workflowWorker}from'../apps/automation/src/workflows/worker.js';
import{attachBalanceRules}from'../apps/automation/src/workflows/rule-profile.js';
import{readBrowserbaseConfig}from'../apps/automation/src/browserbase/config.js';
import{ScenarioSchema}from'../apps/demo-api/src/scenarios.js';

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const root=resolve(import.meta.dirname,'..');const folder=resolve(root,'apps/automation/runtime/int-012-013');await mkdir(folder,{recursive:true,mode:0o700});
  const portal=new URL(process.env.BROWSERBASE_PORTAL_URL??'');const credentials=readBrowserbaseConfig({...process.env,BROWSERBASE_FIXTURE_URL:new URL('/compatibility',portal).toString()});portal.pathname='/';portal.search='';portal.hash='';
  let reachable=false;for(let attempt=0;attempt<5;attempt++){try{const response=await fetch(new URL('/healthz',portal),{signal:AbortSignal.timeout(5000),redirect:'error'});if(response.ok&&(await response.json()).service==='demo-target'){reachable=true;break;}}catch{}await pause(1000);}
  if(!reachable)throw Error('TARGET_UNREACHABLE');
  if(!process.env.DATABASE_URL||!process.env.REQUEST_FINGERPRINT_KEY)throw Error('CONFIGURATION_REQUIRED');
  const baseConfiguration=await loadConfigurations({target:new URL('../apps/automation/config/target.v3.json',import.meta.url),policy:new URL('../apps/automation/config/policy.v3.json',import.meta.url)});
  const version=Math.floor(Date.now()/1000);let configuration={target:{...baseConfiguration.target,version,entryPoint:portal.toString()},policy:{...baseConfiguration.policy,version,allowedOrigins:[portal.origin]}};
  const resume=process.env.SCENARIO_RESUME==='1';
  if(resume){configuration=JSON.parse(await readFile(resolve(folder,'configuration.json'),'utf8'));if(configuration.target.entryPoint!==portal.toString())throw Error('ORIGINAL_BINDING_REQUIRED');}
  const pool=createPool(process.env.DATABASE_URL);const base=new AutomationRepository(pool,process.env.REQUEST_FINGERPRINT_KEY);const provider=new BrowserbaseSessions(credentials.apiKey,credentials.projectId);
  let currentCase='baseline';
  const sessions={reconcile:(id:string)=>provider.reconcile(id),validate:(config:typeof configuration)=>provider.validate(config),open:async(...args:Parameters<typeof provider.open>)=>{const resource=await provider.open(...args);if(currentCase==='browser-destroyed')await resource.close();return resource;}};
  const coordinator=new Coordinator(base,process.env.REQUEST_FINGERPRINT_KEY,configuration,new EvidenceStore(resolve(folder,'evidence')),sessions,workflowWorker);
  const setup=async(name:string,delayMs=1000,failuresBeforeSuccess=1)=>{const directory=resolve(root,'apps/demo-api/runtime');await mkdir(directory,{recursive:true,mode:0o700});await writeFile(resolve(directory,'scenario.json'),JSON.stringify(ScenarioSchema.parse({name,delayMs,failuresBeforeSuccess})),{mode:0o600});};
  const prior=resume?JSON.parse(await readFile(resolve(folder,'result.json'),'utf8')):undefined;
  const reports:Array<{scenario:string;delayMs:number;runId:string;expected:string;actual:string;recoveryAttempts:number;passed:boolean;file:string}>=prior?prior.reports.filter((item:{passed:boolean})=>item.passed):[];
  try{
    await coordinator.start();
    let artifact:ReturnType<typeof parseCapability>;
    if(resume){artifact=await coordinator.repository.capability(prior.capability.id,prior.capability.version,'demo-operator');}
    else{
      const available=await pool.query("SELECT c.capability_id FROM automation.capabilities c JOIN automation.runs r ON r.run_id=c.source_discovery_run_id WHERE r.principal_ref=$1 AND r.status='completed' AND c.artifact->'outputSchema'->'properties' ? 'currentBalanceMinor' ORDER BY c.created_at DESC,c.version DESC LIMIT 1",['demo-operator']);
      const id=process.env.SCENARIO_CAPABILITY_ID??available.rows[0]?.capability_id;if(!id)throw Error('SUCCESSFUL_DISCOVERY_REQUIRED');
      const owned=await pool.query('SELECT max(c.version)::integer AS version FROM automation.capabilities c JOIN automation.runs r ON r.run_id=c.source_discovery_run_id WHERE c.capability_id=$1 AND r.principal_ref=$2',[id,'demo-operator']);
      const original=await coordinator.repository.capability(id,owned.rows[0]?.version??0,'demo-operator');
      const revised=attachBalanceRules(original);revised.version=original.version+1;revised.surfaceRequirements.compatibleTargetVersions=[version];
      artifact=parseCapability(await base.publishRuleRevision(revised,original.version,'demo-operator'));
    }
    await writeFile(resolve(folder,'capability.json'),JSON.stringify(artifact,null,2)+'\n',{mode:0o600});
    await writeFile(resolve(folder,'configuration.json'),JSON.stringify(configuration,null,2)+'\n',{mode:0o600});
    const cases=[
      ['baseline','success',0,0],['member-not-found','MEMBER_NOT_FOUND',0,0],['no-primary-savings','NO_PRIMARY_SAVINGS_ACCOUNT',0,0],['access-denied','ACCESS_DENIED',0,0],
      ['slow-search','success',1200,0],['slow-inquiry','success',1200,0],['servicing-notice','success',0,1],['transient-inquiry','success',0,1],
      ['persistent-notice','RECOVERY_EXHAUSTED',0,2],['failed-inquiry','RECOVERY_EXHAUSTED',0,2],['validation-error','TARGET_VALIDATION_ERROR',0,0],
      ['wrong-member','IDENTITY_MISMATCH',0,0],['wrong-account','IDENTITY_MISMATCH',0,0],['duplicate-account','AMBIGUOUS_TARGET',0,0],['conflicting-outcomes','CONFLICTING_SIGNALS',0,0],
      ['browser-destroyed','SESSION_LOST',0,0],['unexpected-modal','UNEXPECTED_DIALOG',0,0],['session-expired','SESSION_EXPIRED',0,0],['slow-inquiry','STATE_TIMEOUT',15000,0],
    ]as const;
    const selected=process.env.SCENARIO_CASES?.split(',');
    for(const[name,expected,delayMs,recoveryCount]of cases){
      if(selected&&!selected.includes(name))continue;
      if(resume&&reports.some(report=>report.scenario===name&&report.delayMs===delayMs&&report.passed))continue;
      currentCase=name;await setup(name==='browser-destroyed'?'baseline':name,delayMs||1000);const accepted=await coordinator.accept({mode:'replay',targetId:configuration.target.id,capability:{id:artifact.capabilityId,version:artifact.version},inputs:{memberId:'M1002'}},'demo-operator',randomUUID());
      let intervention:unknown;let interventionReason:string|undefined;let sameSession=true;let originalSession:string|null=null;let lastLog=0;
      for(let attempt=0;attempt<700;attempt++){
        const run=await coordinator.read(accepted.runId,'demo-operator');const state=await coordinator.repository.state(accepted.runId);
        if(state.session_ref){if(originalSession&&originalSession!==state.session_ref)sameSession=false;originalSession=state.session_ref;}
        if(Date.now()-lastLog>20_000){console.info(JSON.stringify({scenario:name,runId:run.runId,status:run.status}));lastLog=Date.now();}
        if(run.status==='waiting_for_human'){
          intervention=await coordinator.repository.intervention(run.activeInterventionId!,'demo-operator');interventionReason=(intervention as{blocked:{reason:string}}).blocked.reason;
          if(state.session_state!=='live')throw Error('PAUSED_SESSION_NOT_LIVE');await coordinator.cancel(run.runId,'demo-operator',randomUUID(),{reason:'USER_REQUESTED'});
        }
        if(['completed','failed','cancelled'].includes(run.status))break;await pause(200);
      }
      await coordinator.idle();const run=await coordinator.read(accepted.runId,'demo-operator');const state=await coordinator.repository.state(run.runId);const events:Awaited<ReturnType<typeof coordinator.repository.events>>['events']=[];let after=0;
      while(true){const page=await coordinator.repository.events(run.runId,'demo-operator',after,200);events.push(...page.events);if(page.events.length<200)break;after=page.nextSequence;}
      const result=run.result;const actual=interventionReason??(result?.kind==='success'?'success':result&&'code'in result?result.code:result?.kind??'missing');
      const recoveries=events.filter(event=>event.type==='RECOVERY_STARTED');const stats=events.find(event=>event.type==='SESSION_FINISHED')?.details;
      const normalDispatches=artifact.steps.map(step=>({id:step.id,count:events.filter(event=>event.type==='ACTION_DISPATCHED'&&event.stepId===step.id).length}));
      const passed=actual===expected&&recoveries.length===recoveryCount&&normalDispatches.every(step=>step.count<=1)&&state.session_state==='closed'&&stats?.code==='closed'&&stats.modelCalls===0&&stats.inferenceAttempts===0&&stats.inputTokens===0&&stats.outputTokens===0&&sameSession
        &&(expected!=='success'||(result?.kind==='success'&&result.output.availability==='available'&&result.output.values.memberId==='M1002'&&result.output.values.accountId==='S2002'&&result.output.values.currentBalanceMinor===8765));
      const report={scenario:name,delayMs,run,intervention,sameSession,sessionState:state.session_state,events,normalDispatches,expected,actual,recoveryAttempts:recoveries.length,passed};
      const file=name+'-'+delayMs+'-'+run.runId+'.json';await writeFile(resolve(folder,file),JSON.stringify(report,null,2)+'\n',{mode:0o600});
      for(const event of events)if(typeof event.details.evidenceId==='string'){try{const evidence=await coordinator.evidenceFor(run.runId,event.details.evidenceId,'demo-operator');await writeFile(resolve(folder,event.details.evidenceId+'.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});}catch{}}
      reports.push({scenario:name,delayMs,runId:run.runId,expected,actual,recoveryAttempts:recoveries.length,passed,file});console.info(JSON.stringify(reports.at(-1)));
      await writeFile(resolve(folder,'result.json'),JSON.stringify({capability:{id:artifact.capabilityId,version:artifact.version},configurationVersion:configuration.target.version,finishedAt:new Date().toISOString(),reports,success:reports.every(report=>(report as{passed:boolean}).passed)},null,2)+'\n',{mode:0o600});
      if(!passed)throw Error('SCENARIO_MISMATCH');
    }
  }finally{await setup('baseline');await coordinator.stop();await pool.end();}
}
main().catch(error=>{const diagnostic=error as {name?:string;code?:string;issues?:Array<{path:unknown[];code:string}>};console.error(JSON.stringify({errorType:diagnostic.name,code:diagnostic.code,issues:diagnostic.issues?.map(issue=>({path:issue.path,code:issue.code}))}));console.error('Scenario verification stopped: '+(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CHECK_FAILED')+'. Inspect the private runtime reports; no raw provider errors were printed.');process.exitCode=1;});
