import { randomUUID, createHmac } from 'node:crypto';
import { z } from 'zod';
import { transaction } from '@interface-ai/postgres';
import type { PoolClient } from '@interface-ai/postgres';
import { BlockedContextSchema, InterventionSchema, CancelRequestSchema, MutationMetadataSchema, RunResultSchema } from '@interface-ai/contracts';
import type { RunResult } from '@interface-ai/contracts';
import { AutomationRepository, RepositoryError, append, canonical } from './repository.js';
import type { StoredEventInput } from './repository.js';

export class RuntimeRepository {
  constructor(readonly base: AutomationRepository, private readonly fingerprintKey: string) {}
  private digest(value: string) { return createHmac('sha256', this.fingerprintKey).update(value).digest('hex'); }
  async owned(runId: string, principal: string) {
    const row = (await this.base.pool.query('SELECT principal_ref FROM automation.runs WHERE run_id=$1', [z.uuid().parse(runId)])).rows[0];
    if (!row || row.principal_ref !== principal) throw new RepositoryError('RUN_NOT_FOUND');
    return this.base.getRun(runId);
  }
  async capability(id: string, version: number, principal: string) {
    const allowed = await this.base.pool.query('SELECT 1 FROM automation.capabilities c JOIN automation.runs r ON r.run_id=c.source_discovery_run_id WHERE c.capability_id=$1 AND c.version=$2 AND r.principal_ref=$3', [id, version, principal]);
    if (!allowed.rowCount) throw new RepositoryError('CAPABILITY_NOT_FOUND');
    return this.base.getCapability(id, version);
  }
  async events(runId: string, principal: string, after: number, limit: number) {
    await this.owned(runId, principal);
    const rows = await this.base.pool.query('SELECT event_id,sequence,event_type,actor,step_id,intervention_id,details,created_at FROM automation.run_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3', [runId, after, limit]);
    return { events: rows.rows.map(row => ({ eventId: row.event_id, sequence: row.sequence, type: row.event_type, actor: row.actor, stepId: row.step_id, ...(row.intervention_id?{interventionId:row.intervention_id}:{}),
      details: row.details, createdAt: row.created_at.toISOString() })), nextSequence: rows.rows.at(-1)?.sequence ?? after };
  }
  async operation(runId: string, receiptId: string, principal: string) {
    await this.owned(runId, principal);
    const row = (await this.base.pool.query('SELECT receipt_id,state,result_reference,accepted_at,expires_at FROM automation.request_receipts WHERE run_id=$1 AND receipt_id=$2 AND principal_ref=$3', [runId, receiptId, principal])).rows[0];
    if (!row) throw new RepositoryError('OPERATION_NOT_FOUND');
    return { receiptId: row.receipt_id, state: row.state, resultReference: row.result_reference, acceptedAt: row.accepted_at.toISOString(), expiresAt: row.expires_at.toISOString() };
  }
  async assertRunning(runId: string, revision: number) {
    const row = await this.base.pool.query("SELECT 1 FROM automation.runs WHERE run_id=$1 AND status='running' AND controller='automation' AND control_revision=$2", [runId, revision]);
    if (!row.rowCount) throw new RepositoryError('RUN_STATE_CONFLICT');
  }
  async record(runId: string, revision: number, event: StoredEventInput) {
    return transaction(this.base.pool, async client => {
      const lock = await client.query('SELECT status,control_revision FROM automation.runs WHERE run_id=$1 FOR UPDATE', [runId]);
      if (!lock.rows[0] || lock.rows[0].status !== 'running' || lock.rows[0].control_revision !== revision) throw new RepositoryError('RUN_STATE_CONFLICT');
      const sequence = await append(client, runId, event);
      if (event.type === 'ACTION_INTENT') await client.query('UPDATE automation.runs SET current_step_id=$2 WHERE run_id=$1', [runId, event.stepId]);
      if (event.type === 'ACTION_DISPATCHED') await client.query("UPDATE automation.runs SET dispatch_state='sent',effect_state='not_checked',current_step_id=$2 WHERE run_id=$1", [runId, event.stepId]);
      else if (event.type === 'ACTION_COMPLETED') await client.query("UPDATE automation.runs SET dispatch_state='settled',effect_state='not_checked' WHERE run_id=$1", [runId]);
      else if (event.type === 'ACTION_FAILED') await client.query('UPDATE automation.runs SET dispatch_state=$2,effect_state=$3 WHERE run_id=$1', [runId, event.details.dispatchState ?? 'unknown', event.details.effectState ?? 'unknown']);
      return sequence;
    });
  }
  async openIntervention(runId: string, context: unknown, expiresAt: Date) {
    const blocked = BlockedContextSchema.parse(context);
    return transaction(this.base.pool, async client => {
      const row = (await client.query("SELECT session_ref,control_revision FROM automation.runs WHERE run_id=$1 AND status='running' FOR UPDATE", [runId])).rows[0];
      if (!row?.session_ref) throw new RepositoryError('RUN_STATE_CONFLICT');
      const id = randomUUID(); const revision = row.control_revision + 1;
      await client.query("INSERT INTO automation.interventions(intervention_id,run_id,status,blocked,control_revision,session_ref,expires_at) VALUES($1,$2,'open',$3,$4,$5,$6)", [id,runId,JSON.stringify(blocked),revision,row.session_ref,expiresAt]);
      await client.query("UPDATE automation.runs SET status='waiting_for_human',controller='none',control_revision=$2,active_intervention_id=$3,updated_at=now() WHERE run_id=$1", [runId,revision,id]);
      await append(client,runId,{type:'INTERVENTION_OPENED',actor:'system',stepId:blocked.stepId,details:{code:blocked.reason,...(blocked.evidenceIds[0]?{evidenceId:blocked.evidenceIds[0]}:{})}});
      return id;
    });
  }
  async intervention(id: string, principal: string) {
    const row = (await this.base.pool.query('SELECT i.* FROM automation.interventions i JOIN automation.runs r USING(run_id) WHERE i.intervention_id=$1 AND r.principal_ref=$2',[id,principal])).rows[0];
    if (!row) throw new RepositoryError('INTERVENTION_NOT_FOUND');
    return InterventionSchema.parse({interventionId:row.intervention_id,runId:row.run_id,status:row.status,controlRevision:row.control_revision,sessionRef:row.session_ref,blocked:row.blocked,createdAt:row.created_at.toISOString(),expiresAt:row.expires_at.toISOString()});
  }
  async finish(runId: string, result: RunResult) {
    const safe = RunResultSchema.parse(result);
    const status = safe.kind === 'failure' ? 'failed' : safe.kind === 'cancelled' ? 'cancelled' : 'completed';
    await transaction(this.base.pool, async client => {
      await client.query("UPDATE automation.interventions SET status='closed' WHERE run_id=$1 AND status IN ('open','claimed','validating')", [runId]);
      const updated = await client.query("UPDATE automation.runs SET status=$2,result=$3,controller='none',operator_ref=NULL,active_intervention_id=NULL,control_revision=control_revision+1,updated_at=now() WHERE run_id=$1 AND status NOT IN ('completed','failed','cancelled') RETURNING run_id", [runId, status, JSON.stringify(safe)]);
      if (!updated.rowCount) throw new RepositoryError('RUN_STATE_CONFLICT');
      await append(client, runId, { type: status === 'cancelled' ? 'RUN_CANCELLED' : status === 'failed' ? 'RUN_FAILED' : 'RUN_COMPLETED', actor: 'system', stepId: null, details: { code: status } });
      await client.query("UPDATE automation.request_receipts SET state='settled' WHERE run_id=$1 AND operation_scope LIKE 'cancel:%'", [runId]);
    });
  }
  async sessionIntent(runId: string, expiresAt: Date) {
    const sessionRef = randomUUID();
    const row = await this.base.pool.query("UPDATE automation.runs SET session_ref=$2,browser_provider='browserbase',session_state='creating',session_expires_at=$3 WHERE run_id=$1 AND status='running' AND session_state='none' RETURNING run_id", [runId, sessionRef, expiresAt]);
    if (!row.rowCount) throw new RepositoryError('RUN_STATE_CONFLICT');
    return sessionRef;
  }
  async sessionCreated(runId: string, providerId: string) {
    // Save a late launch handle even if cancellation has already closed run admissions.
    const row = await this.base.pool.query("UPDATE automation.runs SET provider_session_id=$2,session_state=CASE WHEN status='running' THEN 'live' ELSE 'uncertain' END WHERE run_id=$1 AND session_state IN ('creating','uncertain') AND provider_session_id IS NULL RETURNING run_id", [runId, z.uuid().parse(providerId)]);
    if (!row.rowCount) throw new RepositoryError('RUN_STATE_CONFLICT');
  }
  async sessionState(runId: string, state: 'close_requested' | 'closed' | 'uncertain') {
    await this.base.pool.query("UPDATE automation.runs SET session_state=$2 WHERE run_id=$1 AND session_state NOT IN ('none','closed')", [runId, state]);
  }
  async sessions() {
    return (await this.base.pool.query("SELECT run_id,provider_session_id,session_state,session_expires_at,status,dispatch_state,effect_state FROM automation.runs WHERE session_state NOT IN ('none','closed') OR status NOT IN ('completed','failed','cancelled') ORDER BY created_at")).rows;
  }
  async state(runId: string) { return (await this.base.pool.query('SELECT status,session_state,provider_session_id,session_expires_at,dispatch_state,effect_state FROM automation.runs WHERE run_id=$1', [runId])).rows[0]; }
  async cancel(runId: string, principal: string, key: string, value: unknown) {
    const body = CancelRequestSchema.parse(value); MutationMetadataSchema.parse({ idempotencyKey: key });
    const digest = this.digest('key:' + principal + ':cancel:' + runId + ':' + key); const fingerprint = this.digest('payload:' + canonical(body));
    return transaction(this.base.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(5002)');
      const row = (await client.query('SELECT status,principal_ref FROM automation.runs WHERE run_id=$1 FOR UPDATE', [runId])).rows[0];
      if (!row || row.principal_ref !== principal) throw new RepositoryError('RUN_NOT_FOUND');
      const wrongKey = await client.query('SELECT 1 FROM automation.request_receipts WHERE fingerprint_key_id<>$1 OR fingerprint_key_version<>1 LIMIT 1', [this.digest('interface-ai:receipt-key-verifier:v1')]);
      if (wrongKey.rowCount) throw new RepositoryError('FINGERPRINT_KEY_MISMATCH');
      const prior = (await client.query('SELECT receipt_id,expires_at FROM automation.request_receipts WHERE principal_ref=$1 AND operation_scope=$2 AND key_digest=$3 AND payload_fingerprint=$4', [principal, 'cancel:' + runId, digest, fingerprint])).rows[0];
      if (prior) { if (prior.expires_at.getTime() <= Date.now() && row.status === 'cancelled') throw new RepositoryError('IDEMPOTENCY_WINDOW_EXPIRED'); return { receiptId: prior.receipt_id as string, reused: true }; }
      if (['completed', 'failed'].includes(row.status)) throw new RepositoryError('RUN_STATE_CONFLICT');
      const receiptId = randomUUID();
      await client.query(`INSERT INTO automation.request_receipts(receipt_id,principal_ref,operation_scope,key_digest,payload_fingerprint,fingerprint_key_id,fingerprint_key_version,run_id,state,result_reference,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,now()+interval '24 hours')`, [receiptId, principal, 'cancel:' + runId, digest, fingerprint,
        this.digest('interface-ai:receipt-key-verifier:v1'), runId, row.status === 'cancelled' ? 'settled' : 'accepted', JSON.stringify({ kind: 'run', id: runId })]);
      if (!['cancelling', 'cancelled'].includes(row.status)) {
        await client.query("UPDATE automation.runs SET status='cancelling',controller='none',operator_ref=NULL,control_revision=control_revision+1,updated_at=now() WHERE run_id=$1", [runId]);
        await append(client, runId, { type: 'CANCEL_REQUESTED', actor: 'caller', stepId: null, details: { code: 'user_requested' } });
      }
      return { receiptId, reused: false };
    });
  }
  async lock(onLost: () => void) {
    const client: PoolClient = await this.base.pool.connect();
    const held = await client.query('SELECT pg_try_advisory_lock(5003) AS held');
    if (!held.rows[0]?.held) { client.release(); throw new RepositoryError('COORDINATOR_ALREADY_RUNNING'); }
    let lost = false; let pinging = false;
    const fail = () => { if (!lost) { lost = true; onLost(); } };
    client.on('error', fail); client.on('end', fail);
    const heartbeat = setInterval(() => { if (pinging || lost) return; pinging = true; void client.query('SELECT 1').catch(fail).finally(() => { pinging = false; }); }, 5000); heartbeat.unref();
    return async () => { clearInterval(heartbeat); client.removeListener('error', fail); client.removeListener('end', fail); try { if (!lost) await client.query('SELECT pg_advisory_unlock(5003)'); } finally { client.release(lost); } };
  }
}
