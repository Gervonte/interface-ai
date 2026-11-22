import { currentBalanceRequest } from '../examples/discovery-requests.js';
import {createPool} from '@interface-ai/postgres';
import {AutomationRepository} from '../apps/automation/src/db/repository.js';
import {attachBalanceRules} from '../apps/automation/src/workflows/rule-profile.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCapability,RunViewSchema } from '@interface-ai/contracts';
import { loadConfigurations } from '../apps/automation/src/db/repository.js';

const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'apps/automation/runtime/int-014-015');
let interrupted=false;process.once('SIGINT',()=>{interrupted=true;});process.once('SIGTERM',()=>{interrupted=true;});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([exited,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CLEANUP_TIMEOUT'));},30000);})]);}finally{clearTimeout(timer);}}
async function main(){
  for(const key of ['DATABASE_URL','REQUEST_FINGERPRINT_KEY','AUTOMATION_API_TOKEN','BROWSERBASE_API_KEY','BROWSERBASE_PROJECT_ID'])if(!process.env[key])throw Error('CONFIGURATION_REQUIRED');
  const entry=new URL(process.env.BROWSERBASE_PORTAL_URL??'');if(entry.protocol!=='https:'||entry.pathname!=='/')throw Error('HTTPS_PORTAL_ROOT_REQUIRED');
  const health=await fetch(new URL('/healthz',entry),{signal:AbortSignal.timeout(10000)});if(!health.ok||(await health.json()).service!=='demo-target')throw Error('TARGET_UNREACHABLE');
  await mkdir(folder,{recursive:true,mode:0o700});
  const initial=await loadConfigurations({target:new URL('../apps/automation/config/target.v3.json',import.meta.url),policy:new URL('../apps/automation/config/policy.v4.json',import.meta.url)});
  const version=Math.floor(Date.now()/1000),targetFile=resolve(folder,'target.'+version+'.json'),policyFile=resolve(folder,'policy.'+version+'.json');
  await writeFile(targetFile,JSON.stringify({...initial.target,version,entryPoint:entry.toString()}),{mode:0o600});await writeFile(policyFile,JSON.stringify({...initial.policy,version,allowedOrigins:[entry.origin]}),{mode:0o600});
  const setup=async(name:string)=>{const directory=resolve(root,'apps/demo-api/runtime');await mkdir(directory,{recursive:true,mode:0o700});await writeFile(resolve(directory,'scenario.json'),JSON.stringify({name,delayMs:0,failuresBeforeSuccess:1}),{mode:0o600});};
  const reports=[];let reference:{id:string;version:number}|undefined;
  const replayOnly=process.env.HANDOFF_REPLAY_ONLY==='1';
  if(replayOnly){
    const pool=createPool(process.env.DATABASE_URL!);
    try{
      const id='balance-0f6a7df9b43f44aeb45fad5ad53ca6d1';
      const row=(await pool.query('SELECT c.artifact FROM automation.capabilities c JOIN automation.runs r ON r.run_id=c.source_discovery_run_id WHERE c.capability_id=$1 AND r.principal_ref=$2 ORDER BY c.version DESC LIMIT 1',[id,'demo-operator'])).rows[0];
      if(!row)throw Error('PRIOR_GENUINE_DISCOVERY_REQUIRED');
      const base=parseCapability(row.artifact),artifact=attachBalanceRules(base);artifact.version=base.version+1;artifact.surfaceRequirements.compatibleTargetVersions=[...new Set([...base.surfaceRequirements.compatibleTargetVersions,version])];
      await new AutomationRepository(pool,process.env.REQUEST_FINGERPRINT_KEY!).publishRuleRevision(artifact,base.version,'demo-operator');reference={id:artifact.capabilityId,version:artifact.version};
      await writeFile(resolve(folder,'capability.json'),JSON.stringify(artifact,null,2)+'\n',{mode:0o600});
      console.info(JSON.stringify({mode:'replay-only',sourceDiscoveryRunId:artifact.sourceDiscoveryRunId,capability:reference,authoredRuleRevision:true}));
    }finally{await pool.end();}
  }
  for(const mode of (replayOnly?['replay']:['discovery','replay']) as Array<'discovery'|'replay'>){
    // Use separate processes, the same exact saved artifact, and a changed member.
    await setup(mode==='discovery'?'unexpected-modal':'session-expired');
    const child=spawn(process.execPath,['--env-file-if-exists=.env','--import','tsx','src/index.ts'],{cwd:resolve(root,'apps/automation'),env:{...process.env,HOST:'127.0.0.1',PORT:'3001',AUTOMATION_TARGET_FILE:targetFile,AUTOMATION_POLICY_FILE:policyFile},stdio:['ignore','ignore','pipe']});
    child.stderr?.on('data',()=>{});
    const api=async(path:string,body?:unknown)=>{const response=await fetch('http://127.0.0.1:3001'+path,{headers:{Authorization:'Bearer '+process.env.AUTOMATION_API_TOKEN,...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':randomUUID()})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP_'+response.status);return response.json();};
    let runId:string|undefined;
    try{
      let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null||child.signalCode!==null)throw Error('API_STARTUP_FAILED');try{await api('/healthz');ready=true;break;}catch{}await delay(100);}if(!ready)throw Error('API_NOT_READY');
      const accepted=await api('/v1/runs',mode==='discovery'?{mode,outputContract:currentBalanceRequest.outputContract,targetId:initial.target.id,goal:'Find the current balance and currency of the primary savings account for memberId. Verify member and account identity.',inputs:{memberId:'M1001'}}:{mode,targetId:initial.target.id,capability:reference,inputs:{memberId:'M1002'}});runId=accepted.runId;
      console.info(JSON.stringify({mode,runId,operatorUrl:'http://127.0.0.1:5173',status:'started'}));
      const events:any[]=[];const interventions:any[]=[];let run;let last=0;const seenInterventions=new Set<string>();const sessionRefs=new Set<string>();
      for(let i=0;i<1800;i++){
        if(interrupted)throw Error('CHECK_INTERRUPTED');
        run=RunViewSchema.parse(await api('/v1/runs/'+runId));const page=await api(`/v1/runs/${runId}/events?afterSequence=${events.at(-1)?.sequence??0}&limit=200`);events.push(...page.events);
        if(run.activeInterventionId){const item=await api('/v1/interventions/'+run.activeInterventionId);sessionRefs.add(item.sessionRef);if(!seenInterventions.has(item.interventionId)){seenInterventions.add(item.interventionId);interventions.push(item);if(interventions.length===1)await writeFile(resolve(folder,mode+'-intervention.json'),JSON.stringify(item,null,2),{mode:0o600});await writeFile(resolve(folder,mode+'-interventions.json'),JSON.stringify(interventions,null,2),{mode:0o600});console.info(JSON.stringify({mode,runId,interventionId:item.interventionId,status:run.status,reason:item.blocked.reason,operatorUrl:'http://127.0.0.1:5173'}));}}
        if(['completed','failed','cancelled'].includes(run.status)&&events.some(event=>event.type==='SESSION_FINISHED'))break;
        if(Date.now()-last>20000){console.info(JSON.stringify({mode,runId,status:run.status,modelCalls:events.filter(event=>event.type==='MODEL_COMPLETED').length}));last=Date.now();}
        await delay(500);
      }
      if(!run)throw Error('RUN_UNAVAILABLE');
      const savedIntervention=JSON.parse(await readFile(resolve(folder,mode+'-intervention.json'),'utf8').catch(()=>'null'));const intervention=savedIntervention?.runId===runId?savedIntervention:null;
      const report={mode,processId:child.pid,run,intervention,interventions,events};await writeFile(resolve(folder,mode+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
      const session=events.find(event=>event.type==='SESSION_FINISHED'),manual=events.filter(event=>event.actor==='human'&&event.type==='ACTION_COMPLETED');
      if(run.result?.kind!=='success'||run.result.output.availability!=='available')throw Error('RUN_NOT_SUCCESSFUL');
      const out=run.result.output.values,member=mode==='discovery'?'M1001':'M1002';if(out.memberId!==member||out.accountId!==(mode==='discovery'?'S2001':'S2002')||out.currentBalanceMinor!==(mode==='discovery'?125034:8765))throw Error('WRONG_OUTPUT');
      if(session?.details.code!=='closed'||!manual.length||!events.some(event=>event.type==='CONTROL_CLAIMED')||!events.some(event=>event.type==='CONTROL_RETURNED')||sessionRefs.size!==1||!intervention)throw Error('HANDOFF_EVIDENCE_MISSING');
      if(mode==='discovery'){
        reference=run.result.capability;const artifact=parseCapability(await api(`/v1/capabilities/${reference.id}/versions/${reference.version}`));
        if(!artifact.manualContributions.length||!events.some(event=>event.type==='MODEL_COMPLETED'&&event.details.inputTokens>0))throw Error('DISCOVERY_PROVENANCE_MISSING');
        await writeFile(resolve(folder,'capability.json'),JSON.stringify(artifact,null,2)+'\n',{mode:0o600});
      }else if(session.details.modelCalls!==0||session.details.inferenceAttempts!==0||events.some(event=>event.type.startsWith('MODEL_')))throw Error('REPLAY_INFERENCE_DETECTED');
      const summary={mode,processId:child.pid,runId,capability:run.result.capability,output:out,session:session.details,manualActions:manual.length,sessionRef:intervention.sessionRef};reports.push(summary);console.info(JSON.stringify(summary));
    }finally{
      if(runId){try{const run=await api('/v1/runs/'+runId);if(!['completed','failed','cancelled'].includes(run.status))await api(`/v1/runs/${runId}/cancel`,{reason:'USER_REQUESTED'});}catch{}}
      await stop(child);await setup('baseline');
    }
  }
  if(!replayOnly&&reports[0]?.processId===reports[1]?.processId)throw Error('FRESH_PROCESS_REQUIRED');
  const result={tasks:['INT-014','INT-015'],verificationScope:replayOnly?'replay-handoff-only':'discovery-and-replay-handoff',configurationVersion:version,finishedAt:new Date().toISOString(),runs:reports,success:true};await writeFile(resolve(folder,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.info(JSON.stringify({success:true,reports:reports.length}));
}
main().catch(error=>{const code=error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'CHECK_FAILED';console.error('Handoff verification stopped: '+code+'. Inspect private runtime reports.');process.exitCode=1;});
