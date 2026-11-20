import{randomUUID,createHash}from'node:crypto';
import{mkdir,writeFile}from'node:fs/promises';
import{resolve}from'node:path';
import type{Target}from'@interface-ai/contracts';
import{BrowserbaseSessions}from'../apps/automation/src/execution/provider.js';
import{Executor}from'../apps/automation/src/execution/executor.js';
import{DispatchGate}from'../apps/automation/src/execution/gate.js';
import{EvidenceStore}from'../apps/automation/src/execution/evidence.js';
import{loadConfigurations}from'../apps/automation/src/db/repository.js';
import type{StoredEventInput}from'../apps/automation/src/db/repository.js';
import{readBrowserbaseConfig}from'../apps/automation/src/browserbase/config.js';
import{ScenarioSchema}from'../apps/demo-api/src/scenarios.js';
async function main(){
  const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'apps/automation/runtime/int-012-013');await mkdir(folder,{recursive:true,mode:0o700});
  const entry=new URL(process.env.BROWSERBASE_PORTAL_URL??'');entry.pathname='/';const credentials=readBrowserbaseConfig({...process.env,BROWSERBASE_FIXTURE_URL:new URL('/compatibility',entry).toString()});
  let reachable=false;for(let attempt=0;attempt<5;attempt++){try{const response=await fetch(new URL('/healthz',entry),{signal:AbortSignal.timeout(5000),redirect:'error'});if(response.ok&&(await response.json()).service==='demo-target'){reachable=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}if(!reachable)throw Error('TARGET_UNREACHABLE');
  const initial=await loadConfigurations({target:new URL('../apps/automation/config/target.v3.json',import.meta.url),policy:new URL('../apps/automation/config/policy.v3.json',import.meta.url)});
  const configuration={target:{...initial.target,version:Math.floor(Date.now()/1000),entryPoint:entry.toString()},policy:{...initial.policy,allowedFillNames:initial.policy.allowedFillNames!,id:'demo-controls-qa',version:Math.floor(Date.now()/1000),allowedOrigins:[entry.origin],allowedClickNames:[...initial.policy.allowedClickNames!,'Restore staff session','Dismiss servicing review']}};
  const scope={kind:'frame' as const,frames:[{attribute:'title' as const,value:'Member servicing workspace'}]};
  const role=(name:string,kind:'button'|'heading'|'dialog'='button'):Target=>({scope,within:[],locator:{kind:'role',role:kind,name,exact:true},expectedMatches:1});
  const field=(label:string):Target=>({scope,within:[{kind:'container',locator:{kind:'role',role:'region',name:'Account Details',exact:true}}],locator:{kind:'field',label},expectedMatches:1});
  const row={kind:'tableRow' as const,tableCaption:'Member accounts',cells:[{columnHeader:'Account Type',equals:{kind:'literal' as const,value:'Primary Savings'}},{columnHeader:'Designation',equals:{kind:'literal' as const,value:'Primary'}}]};
  const targets:Record<string,Target>={staff:role('Staff workspace','heading'),start:role('Start Member Search'),searchHeading:role('Member Search','heading'),member:{scope,within:[],locator:{kind:'label',text:'Member ID',exact:true},expectedMatches:1},search:role('Search'),
    memberOpen:{...role('Open'),within:[{kind:'tableRow',tableCaption:'Member search results',cells:[{columnHeader:'Member ID',equals:{kind:'input',name:'memberId'}}]}]},overview:role('Member Overview','heading'),inquiry:role('Account Inquiry'),
    table:{scope,within:[],locator:{kind:'caption',text:'Member accounts',exact:true},expectedMatches:1},primary:{...role('Open'),within:[row]},accountCell:{scope,within:[row],locator:{kind:'cell',columnHeader:'Account ID'},expectedMatches:1},
    expired:role('Staff session expired','dialog'),restore:role('Restore staff session'),review:role('Servicing review required','dialog'),dismiss:role('Dismiss servicing review'),details:role('Account Details','heading'),identity:field('Member ID'),account:field('Account ID'),balance:field('Current Balance')};
  const setup=async(name:string)=>{const directory=resolve(root,'apps/demo-api/runtime');await mkdir(directory,{recursive:true,mode:0o700});await writeFile(resolve(directory,'scenario.json'),JSON.stringify(ScenarioSchema.parse({name})),{mode:0o600});};
  const results=[];
  try{for(const scenario of['session-expired','unexpected-modal']){
    await setup(scenario);const provider=new BrowserbaseSessions(credentials.apiKey,credentials.projectId);const resource=await provider.open(configuration,async()=>{},new AbortController().signal,'replay');
    const marker=createHash('sha256').update(resource.id).digest('hex');const runId=randomUUID();const evidence=new EvidenceStore(resolve(folder,'control-evidence'));const events:StoredEventInput[]=[];let index=0;
    try{
      const executor=new Executor({runId,entryPoint:entry.toString(),policy:{...configuration.policy,allowedFillNames:configuration.policy.allowedFillNames!},surface:resource.surface,targets,inputs:{memberId:'M1002'},gate:new DispatchGate(2),revision:2,signal:new AbortController().signal,authorize:async()=>{},record:async event=>{events.push(event);return events.length;},evidence});
      const click=async(target:string)=>{await executor.assert({kind:'enabled',target},'qa-'+ ++index);return executor.execute({type:'click',target},'qa-'+ ++index);};
      const wait=(target:string)=>executor.assert({kind:'visible',target},'qa-'+ ++index);
      const capture=(target:string,transform:'trim'|'usd-minor'='trim')=>executor.execute({type:'capture',sourceValue:{target,read:'text',transform}},'qa-'+ ++index);
      await executor.execute({type:'navigate',destination:'target-entry'},'qa-'+ ++index);await wait('staff');await click('start');await wait('searchHeading');await executor.assert({kind:'editable',target:'member'},'qa-'+ ++index);await executor.execute({type:'fill',target:'member',value:{kind:'input',name:'memberId'}},'qa-'+ ++index);await click('search');await wait('memberOpen');await click('memberOpen');await wait('overview');await click('inquiry');
      let beforeEvidence:string;
      if(scenario==='session-expired'){await wait('expired');beforeEvidence=await evidence.capture(runId,null,resource.surface,configuration.policy);await click('restore');await executor.assert({kind:'absent',target:'expired'},'qa-'+ ++index);await wait('table');}
      else{await wait('table');await click('primary');await wait('review');beforeEvidence=await evidence.capture(runId,null,resource.surface,configuration.policy);await click('dismiss');await executor.assert({kind:'absent',target:'review'},'qa-'+ ++index);}
      if(scenario==='session-expired'){const selected=await capture('accountCell');if(selected!=='S2002')throw Error('WRONG_ACCOUNT');await click('primary');}
      await wait('details');await wait('identity');const output={memberId:await capture('identity'),accountId:await capture('account'),currentBalanceMinor:await capture('balance','usd-minor')};
      const sameSession=marker===createHash('sha256').update(resource.id).digest('hex');const closed=await resource.close();const metrics=resource.statistics();
      const success=sameSession&&closed&&metrics.mode==='replay'&&metrics.modelCalls===0&&metrics.inferenceAttempts===0&&metrics.inputTokens===0&&metrics.outputTokens===0&&output.memberId==='M1002'&&output.accountId==='S2002'&&output.currentBalanceMinor===8765;
      const result={kind:'authored-target-control-qa',scenario,sessionCreations:1,sessionMarker:marker,sameSession,output,metrics,browserClosed:closed,before:await evidence.read(runId,beforeEvidence),events,success};results.push(result);await writeFile(resolve(folder,'control-'+scenario+'.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.info(JSON.stringify({scenario,sameSession,browserClosed:closed,success}));if(!success)throw Error('CONTROL_CHECK_FAILED');
    }catch(error){const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CHECK_FAILED';await writeFile(resolve(folder,'control-failure-'+scenario+'.json'),JSON.stringify({scenario,code,events,success:false},null,2)+'\n',{mode:0o600});throw error;}finally{await resource.close().catch(()=>false);}
  }}finally{await setup('baseline');}
  await writeFile(resolve(folder,'controls-result.json'),JSON.stringify({checks:results.map(result=>({scenario:result.scenario,sameSession:result.sameSession,browserClosed:result.browserClosed,success:result.success})),success:results.every(result=>result.success)},null,2)+'\n',{mode:0o600});
}
main().catch(error=>{const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CHECK_FAILED';console.error('Target-control verification stopped: '+code+'. Inspect the private QA reports.');process.exitCode=1;});
