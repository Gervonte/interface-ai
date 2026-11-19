import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { GatewayPlanner } from '../apps/automation/src/workflows/planner.js';
import type { Observation } from '../apps/automation/src/workflows/contracts.js';
type Stagehand = ConstructorParameters<typeof GatewayPlanner>[0];
type Page = Awaited<ReturnType<ConstructorParameters<typeof GatewayPlanner>[1]>>;
const observation: Observation = { observationId:randomUUID(),fingerprint:'a'.repeat(64),ready:true,headings:[],controls:[{ref:'c1',kind:'fill',label:'Member ID',target:{scope:{kind:'document'},within:[],locator:{kind:'label',text:'Member ID',exact:true},expectedMatches:1},enabled:true,filled:false,row:{},matchesInputs:[]}],fields:[] };
const decision = { observationId:observation.observationId,action:'fill',controlRef:'c1',inputName:'memberId',outputs:{memberId:'',accountId:'',accountType:'',currentBalanceMinor:'',currency:''},reason:'continue' };
describe('sanitized model boundary',()=>{
  it('actually renders the prepared view, sends no target descriptors/freshness hashes, and validates locally',async()=>{
    let rendered='';let calls=0;
    const helper={evaluate:async(expression:string)=>{ runInNewContext(expression,{document:{createElement:()=>({textContent:''}),body:{replaceChildren:(pre:{textContent:string})=>{rendered=pre.textContent;}}}}); }} as unknown as Page;
    const stagehand={extract:async(_prompt:string,schema:{toJSONSchema():unknown},options:{page:Page;screenshot:boolean;cache:boolean})=>{calls++;expect(options).toMatchObject({page:helper,screenshot:false,cache:false});expect(rendered).toContain('memberId');expect(rendered).not.toContain(observation.fingerprint);expect(rendered).not.toContain('expectedMatches');expect(JSON.stringify(schema.toJSONSchema())).not.toContain('allOf');return{data:decision,metadata:{usage:{inputTokens:100,outputTokens:30},cache:{status:'DISABLED'}}};}} as unknown as Stagehand;
    const planner=new GatewayPlanner(stagehand,async()=>helper);expect(await planner.decide({goal:'Find the primary savings balance.',inputNames:['memberId'],observation,history:[]},1000)).toMatchObject({decision,usage:{inputTokens:100}});expect(calls).toBe(1);
  });
  it('rejects model-shaped data with an invalid observation UUID',async()=>{
    const stagehand={extract:async()=>({data:{...decision,observationId:'invalid'},metadata:{usage:{inputTokens:100,outputTokens:30},cache:{status:'DISABLED'}}})}as unknown as Stagehand;
    const planner=new GatewayPlanner(stagehand,async()=>({evaluate:async()=>{}}as unknown as Page));await expect(planner.decide({goal:'Primary savings balance.',inputNames:['memberId'],observation,history:[]},1000)).rejects.toBeTruthy();
  });
});
