import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { outputSchemaFor, parseCapability, RunViewSchema } from '@interface-ai/contracts';
import type { Capability, RunRequest } from '@interface-ai/contracts';
import { canonical, loadConfigurations } from '../apps/automation/src/db/repository.js';
import { currentBalanceRequest, availableBalanceRequest } from '../examples/discovery-requests.js';

const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'apps/automation/runtime/int-023');
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let interrupted=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{interrupted=true;});
async function stop(child:ChildProcess){
  if(child.exitCode!==null||child.signalCode!==null)return;
  const exited=once(child,'exit');let timer:ReturnType<typeof setTimeout>|undefined;child.kill('SIGTERM');
  try{await Promise.race([exited,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CLEANUP_TIMEOUT'));},45000);})]);}finally{clearTimeout(timer);}
}
async function assertPortFree(){
  const server=createServer();await new Promise<void>((resolve,reject)=>{
    server.once('error',()=>reject(Error('API_PORT_IN_USE')));
    server.listen(3001,'127.0.0.1',()=>server.close(error=>error?reject(Error('API_PORT_IN_USE')):resolve()));
  });
}
async function baseline(){
  const directory=resolve(root,'apps/demo-api/runtime');await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(resolve(directory,'scenario.json'),JSON.stringify({name:'baseline',delayMs:0,failuresBeforeSuccess:1}),{mode:0o600});
}
async function main(){
  for(const key of ['DATABASE_URL','REQUEST_FINGERPRINT_KEY','AUTOMATION_API_TOKEN','BROWSERBASE_API_KEY','BROWSERBASE_PROJECT_ID'])if(!process.env[key])throw Error('CONFIGURATION_REQUIRED');
  const entry=new URL(process.env.BROWSERBASE_PORTAL_URL??'');
  if(entry.protocol!=='https:'||entry.pathname!=='/'||entry.search||entry.hash||entry.username||entry.password)throw Error('HTTPS_PORTAL_ROOT_REQUIRED');
  const health=await fetch(new URL('/healthz',entry),{signal:AbortSignal.timeout(10000)});
  if(!health.ok||(await health.json()).service!=='demo-target')throw Error('TARGET_UNREACHABLE');
  await assertPortFree();await mkdir(folder,{recursive:true,mode:0o700});
  const initial=await loadConfigurations({target:new URL('../apps/automation/config/target.v3.json',import.meta.url),policy:new URL('../apps/automation/config/policy.v4.json',import.meta.url)});
  const version=Math.floor(Date.now()/1000),targetFile=resolve(folder,'target.'+version+'.json'),policyFile=resolve(folder,'policy.'+version+'.json');
  await writeFile(targetFile,JSON.stringify({...initial.target,version,entryPoint:entry.toString()}),{mode:0o600});
  await writeFile(policyFile,JSON.stringify({...initial.policy,version,allowedOrigins:[entry.origin]}),{mode:0o600});
  const reports:Array<{goal:string;mode:string;processId:number|undefined;runId:string;capability:{id:string;version:number};output:unknown;session:unknown}>=[];
  const cases=[{name:'current',request:currentBalanceRequest,field:'currentBalanceMinor',label:'Current Balance',amounts:[125034,8765]},
    {name:'available',request:availableBalanceRequest,field:'availableBalanceMinor',label:'Available Balance',amounts:[120034,7600]}];
  const artifacts:Capability[]=[];
  try{for(const item of cases){
    const directory=resolve(folder,item.name);await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(resolve(directory,'request.json'),JSON.stringify(item.request,null,2)+'\n',{mode:0o600});
    let reference:{id:string;version:number}|undefined;
    for(const [index,mode]of(['discovery','replay'] as const).entries()){
      if(interrupted)throw Error('CHECK_INTERRUPTED');await assertPortFree();await baseline();
      const child=spawn(process.execPath,['--env-file-if-exists=.env','--import','tsx','src/index.ts'],{cwd:resolve(root,'apps/automation'),env:{...process.env,HOST:'127.0.0.1',PORT:'3001',AUTOMATION_TARGET_FILE:targetFile,AUTOMATION_POLICY_FILE:policyFile},stdio:['ignore','ignore','pipe']});
      child.stderr?.on('data',()=>{});
      const api=async(path:string,body?:unknown)=>{
        const response=await fetch('http://127.0.0.1:3001'+path,{headers:{Authorization:'Bearer '+process.env.AUTOMATION_API_TOKEN,...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':randomUUID()})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw Error('HTTP_'+response.status);return response.json();
      };
      let runId:string|undefined;
      try{
        let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null||child.signalCode!==null)throw Error('API_STARTUP_FAILED');try{await api('/healthz');ready=true;break;}catch{}await delay(100);}if(!ready)throw Error('API_NOT_READY');
        const request:RunRequest=mode==='discovery'?{...item.request,targetId:initial.target.id}:{mode,targetId:initial.target.id,capability:reference!,inputs:{memberId:'M1002'}};
        const accepted=await api('/v1/runs',request);runId=accepted.runId;
        console.info(JSON.stringify({goal:item.name,mode,runId,status:'started'}));
        const events:any[]=[];const interventions:any[]=[];const seen=new Set<string>();let run;let lastLog=0;
        for(let i=0;i<2400;i++){
          if(interrupted)throw Error('CHECK_INTERRUPTED');run=RunViewSchema.parse(await api('/v1/runs/'+runId));
          const page=await api(`/v1/runs/${runId}/events?afterSequence=${events.at(-1)?.sequence??0}&limit=200`);events.push(...page.events);
          if(run.activeInterventionId&&!seen.has(run.activeInterventionId)){
            seen.add(run.activeInterventionId);const intervention=await api('/v1/interventions/'+run.activeInterventionId);interventions.push(intervention);
            await writeFile(resolve(directory,mode+'-interventions.json'),JSON.stringify(interventions,null,2)+'\n',{mode:0o600});
            console.info(JSON.stringify({goal:item.name,mode,runId,status:run.status,reason:intervention.blocked.reason,operatorUrl:'http://127.0.0.1:5173'}));
          }
          if(['completed','failed','cancelled'].includes(run.status)&&events.some(event=>event.type==='SESSION_FINISHED'))break;
          if(Date.now()-lastLog>20000){console.info(JSON.stringify({goal:item.name,mode,runId,status:run.status,modelCalls:events.filter(event=>event.type==='MODEL_COMPLETED').length}));lastLog=Date.now();}await delay(500);
        }
        if(!run||!runId)throw Error('RUN_UNAVAILABLE');
        await writeFile(resolve(directory,mode+'.json'),JSON.stringify({goal:item.name,mode,processId:child.pid,run,interventions,events},null,2)+'\n',{mode:0o600});
        if(run.result?.kind!=='success'||run.result.output.availability!=='available')throw Error('RUN_NOT_SUCCESSFUL');
        const expected={memberId:index===0?'M1001':'M1002',accountId:index===0?'S2001':'S2002',accountType:'savings',currency:'USD',[item.field]:item.amounts[index]};
        if(canonical(run.result.output.values)!==canonical(expected))throw Error('WRONG_OUTPUT');
        const session=events.find(event=>event.type==='SESSION_FINISHED');if(session?.details.code!=='closed')throw Error('CLEANUP_UNCONFIRMED');
        if(mode==='discovery'){
          reference=run.result.capability;const artifact=parseCapability(await api(`/v1/capabilities/${reference.id}/versions/${reference.version}`));
          if(artifact.sourceDiscoveryRunId!==runId||/M1001|S2001|125034|120034/.test(JSON.stringify(artifact)))throw Error('INVALID_PROVENANCE');
          if(canonical(artifact.outputSchema)!==canonical(outputSchemaFor(item.request.outputContract)))throw Error('OUTPUT_CONTRACT_IGNORED');
          const extraction=artifact.outputs[item.field]!,target=artifact.targets[extraction.target]!;
          if(extraction.transform!=='usd-minor'||target.locator.kind!=='field'||target.locator.label!==item.label)throw Error('WRONG_SOURCE_FIELD');
          if(!events.some(event=>event.type==='MODEL_COMPLETED'&&event.details.inputTokens>0))throw Error('MODEL_EVIDENCE_MISSING');
          artifacts.push(artifact);await writeFile(resolve(directory,'capability.json'),JSON.stringify(artifact,null,2)+'\n',{mode:0o600});
        }else if(canonical(run.result.capability)!==canonical(reference)||events.some(event=>event.type.startsWith('MODEL_'))||['modelCalls','inferenceAttempts','inputTokens','outputTokens'].some(key=>session.details[key]!==0))throw Error('REPLAY_INFERENCE_DETECTED');
        reports.push({goal:item.name,mode,processId:child.pid,runId,capability:run.result.capability,output:run.result.output.values,session:session.details});console.info(JSON.stringify(reports.at(-1)));
      }finally{
        if(runId){try{const run=await api('/v1/runs/'+runId);if(!['completed','failed','cancelled'].includes(run.status))await api(`/v1/runs/${runId}/cancel`,{reason:'USER_REQUESTED'});}catch{}}
        await stop(child);
      }
    }
  }}finally{await baseline();}
  if(reports.length!==4||new Set(reports.map(report=>report.processId)).size!==4||artifacts[0]!.capabilityId===artifacts[1]!.capabilityId)throw Error('FRESH_PROCESS_REQUIRED');
  const result={task:'INT-023',finishedAt:new Date().toISOString(),configurationVersion:version,runs:reports,success:true};
  await writeFile(resolve(folder,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.info(JSON.stringify({success:true,reports:reports.length}));
}
main().catch(error=>{const code=error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'CHECK_FAILED';console.error('Goal verification stopped: '+code+'. Inspect private runtime reports.');process.exitCode=1;});
