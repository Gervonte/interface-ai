import { createHmac, randomUUID } from 'node:crypto';
import { transaction } from '@interface-ai/postgres';
import type { PoolClient } from '@interface-ai/postgres';
import { IdentifierSchema, MutationMetadataSchema } from '@interface-ai/contracts';
import { append, canonical, RepositoryError } from './repository.js';
import type { StoredEventInput } from './repository.js';
import type { RuntimeRepository } from './runtime-repository.js';

type Operation = 'claim' | 'manual' | 'resume';
export class ControlRepository {
  constructor(private readonly runtime: RuntimeRepository, private readonly fingerprintKey: string) {}
  private digest(value: string) { return createHmac('sha256',this.fingerprintKey).update(value).digest('hex'); }
  private async row(client: PoolClient, id: string, principal: string) {
    const row=(await client.query(`SELECT r.*,i.status AS intervention_status,i.control_revision AS intervention_revision,i.expires_at,i.blocked,i.operator_ref AS intervention_operator
      FROM automation.runs r JOIN automation.interventions i ON i.intervention_id=r.active_intervention_id
      WHERE i.intervention_id=$1 AND r.principal_ref=$2 FOR UPDATE OF r,i`,[id,principal])).rows[0];
    if(!row)throw new RepositoryError('INTERVENTION_NOT_FOUND');
    return row;
  }
  async admit(id:string,principal:string,key:string,body:unknown,revision:number,operation:Operation) {
    IdentifierSchema.parse(principal);MutationMetadataSchema.parse({idempotencyKey:key});
    const scope=operation+':'+id, digest=this.digest('key:'+principal+':'+scope+':'+key), fingerprint=this.digest('payload:'+canonical(body));
    return transaction(this.runtime.base.pool,async client=>{
      // Serialize with run cancellation/other mutations; only safe references enter receipts.
      await client.query('SELECT pg_advisory_xact_lock(5002)');
      const owned=(await client.query('SELECT r.run_id FROM automation.runs r JOIN automation.interventions i USING(run_id) WHERE i.intervention_id=$1 AND r.principal_ref=$2',[id,principal])).rows[0];
      if(!owned)throw new RepositoryError('INTERVENTION_NOT_FOUND');
      const prior=(await client.query('SELECT receipt_id,payload_fingerprint,state,result_reference,expires_at FROM automation.request_receipts WHERE principal_ref=$1 AND operation_scope=$2 AND key_digest=$3',[principal,scope,digest])).rows[0];
      if(prior){if(prior.payload_fingerprint!==fingerprint)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');if(prior.expires_at.getTime()<=Date.now())throw new RepositoryError('IDEMPOTENCY_WINDOW_EXPIRED');return{receiptId:prior.receipt_id as string,reused:true,runId:owned.run_id as string,revision:prior.result_reference.controlRevision as number,state:prior.state as string};}
      const row=await this.row(client,id,principal);
      if(row.control_revision!==revision || row.expires_at.getTime()<=Date.now() || row.session_state!=='live')throw new RepositoryError('CONTROL_CONFLICT');
      if(operation==='claim' ? row.status!=='waiting_for_human' || row.intervention_status!=='open' : row.status!=='human_controlled' || row.controller!=='human' || row.intervention_operator!==principal || row.intervention_status!=='claimed')throw new RepositoryError('CONTROL_CONFLICT');
      const next=operation==='manual'?revision:revision+1,receiptId=randomUUID();
      if(operation!=='manual'){
        const claiming=operation==='claim';
        await client.query('UPDATE automation.runs SET status=$2,controller=$3,operator_ref=$4,control_revision=$5,updated_at=now() WHERE run_id=$1',[row.run_id,claiming?'human_controlled':'validating_resume',claiming?'human':'none',claiming?principal:null,next]);
        await client.query('UPDATE automation.interventions SET status=$2,operator_ref=$3,control_revision=$4 WHERE intervention_id=$1',[id,claiming?'claimed':'validating',principal,next]);
        await append(client,row.run_id,{type:claiming?'CONTROL_CLAIMED':'RESUME_STARTED',actor:'human',stepId:row.blocked.stepId,interventionId:id,details:{code:claiming?'claimed':'validating',operatorId:principal,controlRevision:next}});
      }
      await client.query(`INSERT INTO automation.request_receipts(receipt_id,principal_ref,operation_scope,key_digest,payload_fingerprint,fingerprint_key_id,fingerprint_key_version,run_id,intervention_id,state,result_reference,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,now()+interval '24 hours')`,[receiptId,principal,scope,digest,fingerprint,this.digest('interface-ai:receipt-key-verifier:v1'),row.run_id,id,operation==='claim'?'settled':'executing',JSON.stringify({kind:'intervention',id,controlRevision:next})]);
      return{receiptId,reused:false,runId:row.run_id as string,revision:next,state:operation==='claim'?'settled':'executing'};
    });
  }
  async authorize(id:string,principal:string,revision:number,phase:'human_controlled'|'validating_resume'){
    const row=await this.runtime.base.pool.query(`SELECT 1 FROM automation.runs r JOIN automation.interventions i ON i.intervention_id=r.active_intervention_id
      WHERE i.intervention_id=$1 AND r.principal_ref=$2 AND i.operator_ref=$2 AND r.control_revision=$3 AND r.status=$4 AND i.expires_at>now() AND r.session_state='live'`,[id,principal,revision,phase]);
    if(!row.rowCount)throw new RepositoryError('CONTROL_CONFLICT');
  }
  async record(id:string,principal:string,revision:number,event:StoredEventInput){
    return transaction(this.runtime.base.pool,async client=>{
      const row=await this.row(client,id,principal);
      if(row.control_revision!==revision||row.intervention_operator!==principal||!['human_controlled','validating_resume'].includes(row.status)||row.expires_at.getTime()<=Date.now())throw new RepositoryError('CONTROL_CONFLICT');
      const sequence=await append(client,row.run_id,{...event,interventionId:id,details:{...event.details,operatorId:principal,controlRevision:revision}});
      if(event.type==='ACTION_DISPATCHED')await client.query("UPDATE automation.runs SET dispatch_state='sent',effect_state='not_checked' WHERE run_id=$1",[row.run_id]);
      if(event.type==='ACTION_COMPLETED')await client.query("UPDATE automation.runs SET dispatch_state='settled',effect_state='not_checked' WHERE run_id=$1",[row.run_id]);
      if(event.type==='ACTION_FAILED')await client.query('UPDATE automation.runs SET dispatch_state=$2,effect_state=$3 WHERE run_id=$1',[row.run_id,event.details.dispatchState??'unknown',event.details.effectState??'unknown']);
      return sequence;
    });
  }
  async settle(receiptId:string,unknown=false){await this.runtime.base.pool.query('UPDATE automation.request_receipts SET state=$2 WHERE receipt_id=$1',[receiptId,unknown?'outcome_unknown':'settled']);}
  async finishResume(id:string,principal:string,revision:number,valid:boolean){
    return transaction(this.runtime.base.pool,async client=>{
      const row=await this.row(client,id,principal);
      if(row.control_revision!==revision||row.status!=='validating_resume'||row.intervention_operator!==principal||row.expires_at.getTime()<=Date.now())throw new RepositoryError('CONTROL_CONFLICT');
      const next=revision+1;
      await client.query('UPDATE automation.interventions SET status=$2,operator_ref=$3,control_revision=$4 WHERE intervention_id=$1',[id,valid?'resolved':'open',valid?principal:null,next]);
      await client.query('UPDATE automation.runs SET status=$2,controller=$3,operator_ref=NULL,control_revision=$4,active_intervention_id=$5,updated_at=now() WHERE run_id=$1',[row.run_id,valid?'running':'waiting_for_human',valid?'automation':'none',next,valid?null:id]);
      await append(client,row.run_id,{type:valid?'CONTROL_RETURNED':'RESUME_REJECTED',actor:'human',interventionId:id,stepId:row.blocked.stepId,details:{code:valid?'validated':'checkpoint_not_met',operatorId:principal,controlRevision:next}});
      return next;
    });
  }
}
