import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { IdentifierSchema, MutationMetadataSchema, parseCapability, RunRequestSchema, RunViewSchema, RuntimeBudgetsSchema,
  validateOutput, validateReplayRequest } from '@interface-ai/contracts';
import type { Capability, RunRequest, Values } from '@interface-ai/contracts';
import { migrate, transaction } from '@interface-ai/postgres';
import type { Pool, PoolClient } from '@interface-ai/postgres';

export const automationMigrations = [new URL('../../migrations/001_initial.sql', import.meta.url), new URL('../../migrations/002_runtime.sql', import.meta.url), new URL('../../migrations/003_rule_revisions.sql', import.meta.url), new URL('../../migrations/004_revision_trigger.sql', import.meta.url)];
export const migrateAutomation = (pool: Pool) => migrate(pool, 'automation', automationMigrations);
export const targetSchema = z.strictObject({ id: IdentifierSchema, version: z.number().int().positive(),
  surface: z.literal('browser'), applicationFamily: IdentifierSchema,
  entryPoint: z.url().refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)));
  }, 'Target entry must be an HTTPS or loopback HTTP URL without credentials/query/fragment.') });
export const policySchema = z.strictObject({ id: IdentifierSchema, version: z.number().int().positive(),
  allowedOrigins: z.array(z.url().refine((value) => new URL(value).origin === value)).min(1).max(16),
  allowedActions: z.array(z.enum(['navigate', 'fill', 'click', 'wait', 'capture', 'intervene'])).min(1),
  allowRiskyActions: z.literal(false), manualClickNames: z.array(z.string().min(1).max(500)).max(16).optional(), allowedClickNames: z.array(z.string().min(1).max(500)).max(64).optional(), allowedFillNames: z.array(z.string().min(1).max(500)).max(32).optional(), budgets: RuntimeBudgetsSchema });
export async function loadConfigurations(files?: { target: URL; policy: URL }) {
  const target = targetSchema.parse(JSON.parse(await readFile(files?.target ?? new URL('../../config/target.v1.json', import.meta.url), 'utf8')));
  const policy = policySchema.parse(JSON.parse(await readFile(files?.policy ?? new URL('../../config/policy.v1.json', import.meta.url), 'utf8')));
  return { target, policy };
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export class RepositoryError extends Error {
  constructor(readonly code: string) { super(code); }
}
const eventSchema = z.strictObject({
  type: z.enum(['RUN_ACCEPTED', 'RUN_STARTED', 'ACTION_INTENT', 'ACTION_DISPATCHED', 'ACTION_COMPLETED', 'READ_COMPLETED', 'ACTION_FAILED', 'RUN_COMPLETED', 'RUN_FAILED', 'RUN_CANCELLED', 'CANCEL_REQUESTED', 'INTERVENTION_OPENED', 'MODEL_REQUESTED', 'MODEL_COMPLETED', 'MODEL_DECISION_STALE', 'SESSION_FINISHED','RULE_MATCHED','RECOVERY_STARTED','RECOVERY_COMPLETED','RECOVERY_EXHAUSTED','BUSINESS_OUTCOME','CAPABILITY_REVISED','CONTROL_CLAIMED','RESUME_STARTED','RESUME_REJECTED','CONTROL_RETURNED']),
  actor: z.enum(['system', 'caller', 'automation', 'human']), stepId: IdentifierSchema.nullable(), interventionId: z.uuid().optional(),
  details: z.strictObject({ code: IdentifierSchema, operatorId: IdentifierSchema.optional(), controlName:IdentifierSchema.optional(), controlRevision: z.number().int().positive().optional(), ruleId:IdentifierSchema.optional(), attempt:z.number().int().min(0).max(10).optional(), operation: z.enum(['navigate','click','fill','wait','capture']).optional(), inputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), outputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), modelCalls: z.number().int().min(0).max(100).optional(), inferenceAttempts: z.number().int().min(0).max(100).optional(), modelName: z.enum(['openai/gpt-5','openai/gpt-4.1']).optional(), targetRef: IdentifierSchema.optional(), evidenceId: z.uuid().optional(), dispatchState: z.enum(['not_sent','sent','settled','unknown']).optional(), effectState: z.enum(['not_checked','confirmed','not_applied','unknown']).optional(), bindingNames: z.array(IdentifierSchema).max(32).optional() }),
}).superRefine((event, ctx) => {
  if (event.actor === 'human' && !event.interventionId) ctx.addIssue({ code: 'custom', message: 'Human events require their intervention reference.' });
});
export type StoredEventInput = z.infer<typeof eventSchema>;
export async function append(client: PoolClient, runId: string, event: StoredEventInput) {
  const safe = eventSchema.parse(event);
  const updated = await client.query<{ sequence: number }>('UPDATE automation.runs SET next_event_sequence=next_event_sequence+1,updated_at=now() WHERE run_id=$1 RETURNING next_event_sequence-1 AS sequence', [runId]);
  const sequence = updated.rows[0]?.sequence;
  if (!sequence) throw new RepositoryError('RUN_NOT_FOUND');
  await client.query('INSERT INTO automation.run_events(event_id,run_id,sequence,event_type,actor,step_id,details,intervention_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(), runId, sequence, safe.type, safe.actor, safe.stepId, JSON.stringify(safe.details), safe.interventionId ?? null]);
  return sequence;
}
export class AutomationRepository {
  private readonly keyId: string;
  constructor(readonly pool: Pool, private readonly fingerprintKey: string) {
    if (!/^[0-9a-f]{64}$/.test(fingerprintKey)) throw new RepositoryError('INVALID_FINGERPRINT_KEY');
    this.keyId = this.digest('interface-ai:receipt-key-verifier:v1');
  }
  private digest(value: string) { return createHmac('sha256', this.fingerprintKey).update(value).digest('hex'); }
  async acceptRun(value: unknown, metadata: { principal: string; idempotencyKey: string }, configuration: Awaited<ReturnType<typeof loadConfigurations>>) {
    const request = RunRequestSchema.parse(value);
    const principal = IdentifierSchema.parse(metadata.principal);
    const { idempotencyKey } = MutationMetadataSchema.parse({ idempotencyKey: metadata.idempotencyKey });
    const target = targetSchema.parse(configuration.target); const policy = policySchema.parse(configuration.policy);
    const keyDigest = this.digest('key:' + principal + ':create-run:' + idempotencyKey);
    const fingerprint = this.digest('payload:' + canonical(request));
    try {
      return await transaction(this.pool, async (client) => {
        // Receipt lookup and capacity reservation serialize together; no browser work holds this lock.
        await client.query('SELECT pg_advisory_xact_lock(5002)');
        const wrongKey = await client.query('SELECT 1 FROM automation.request_receipts WHERE fingerprint_key_id<>$1 OR fingerprint_key_version<>1 LIMIT 1', [this.keyId]);
        if (wrongKey.rowCount) throw new RepositoryError('FINGERPRINT_KEY_MISMATCH');
        const found = await client.query<{ run_id: string; receipt_id: string; payload_fingerprint: string; expired: boolean; status: string }>(
          'SELECT q.run_id,q.receipt_id,q.payload_fingerprint,q.expires_at<now() AS expired,r.status FROM automation.request_receipts q JOIN automation.runs r USING(run_id) WHERE q.principal_ref=$1 AND q.operation_scope=$2 AND q.key_digest=$3', [principal, 'create-run', keyDigest]);
        const prior = found.rows[0];
        if (prior) {
          if (prior.payload_fingerprint !== fingerprint) throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');
          if (prior.expired && ['completed', 'failed', 'cancelled'].includes(prior.status)) throw new RepositoryError('IDEMPOTENCY_WINDOW_EXPIRED');
          return { runId: prior.run_id, receiptId: prior.receipt_id, reused: true };
        }
        if (request.targetId !== target.id) throw new RepositoryError('TARGET_NOT_FOUND');
        if (!policy.allowedOrigins.includes(new URL(target.entryPoint).origin)) throw new RepositoryError('INCOMPATIBLE_TARGET');
        const occupied = await client.query("SELECT 1 FROM automation.runs WHERE status NOT IN ('completed','failed','cancelled') OR session_state NOT IN ('none','closed') LIMIT 1");
        if (occupied.rowCount) throw new RepositoryError('RUN_CAPACITY_REACHED');
        if (request.mode === 'replay') {
          const artifact = await this.getCapability(request.capability.id, request.capability.version, client);
          const source = await client.query('SELECT principal_ref FROM automation.runs WHERE run_id=$1', [artifact.sourceDiscoveryRunId]);
          if (source.rows[0]?.principal_ref !== principal) throw new RepositoryError('CAPABILITY_NOT_FOUND');
          try { validateReplayRequest(artifact, request); } catch { throw new RepositoryError('INVALID_CAPABILITY_INPUTS'); }
          if (artifact.surfaceRequirements.applicationFamily !== target.applicationFamily || !artifact.surfaceRequirements.compatibleTargetVersions.includes(target.version)) throw new RepositoryError('INCOMPATIBLE_TARGET');
        }
        const runId = randomUUID(); const receiptId = randomUUID();
        const reference = request.mode === 'replay' ? request.capability : undefined;
        await client.query(`INSERT INTO automation.runs(run_id,mode,target_id,target_version,policy_id,policy_version,target_snapshot,policy_snapshot,target_checksum,policy_checksum,capability_id,capability_version,input_names,principal_ref)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [runId, request.mode, target.id, target.version, policy.id, policy.version, JSON.stringify(target), JSON.stringify(policy), hash(target), hash(policy), reference?.id ?? null, reference?.version ?? null, JSON.stringify(Object.keys(request.inputs)), principal]);
        await client.query(`INSERT INTO automation.request_receipts(receipt_id,principal_ref,operation_scope,key_digest,payload_fingerprint,fingerprint_key_id,fingerprint_key_version,run_id,state,result_reference,expires_at)
          VALUES($1,$2,'create-run',$3,$4,$5,1,$6,'settled',$7,now()+interval '24 hours')`,
          [receiptId, principal, keyDigest, fingerprint, this.keyId, runId, JSON.stringify({ kind: 'run', id: runId })]);
        await append(client, runId, { type: 'RUN_ACCEPTED', actor: 'caller', stepId: null, details: { code: 'accepted', bindingNames: Object.keys(request.inputs) } });
        return { runId, receiptId, reused: false };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'constraint' in error && error.constraint === 'one_active_run') throw new RepositoryError('RUN_CAPACITY_REACHED');
      throw error;
    }
  }
  async getCapability(id: string, version: number, connection: Pool | PoolClient = this.pool): Promise<Capability> {
    const response = await connection.query('SELECT artifact FROM automation.capabilities WHERE capability_id=$1 AND version=$2', [id, version]);
    if (!response.rows[0]) throw new RepositoryError('CAPABILITY_NOT_FOUND');
    return parseCapability(response.rows[0].artifact);
  }
  async appendEvent(runId: string, event: StoredEventInput) { return transaction(this.pool, (client) => append(client, runId, event)); }
  async markRunning(runId: string) {
    await transaction(this.pool, async (client) => {
      const updated = await client.query("UPDATE automation.runs SET status='running',controller='automation',control_revision=control_revision+1,updated_at=now() WHERE run_id=$1 AND status='pending'", [runId]);
      if (!updated.rowCount) throw new RepositoryError('RUN_STATE_CONFLICT');
      await append(client, runId, { type: 'RUN_STARTED', actor: 'system', stepId: null, details: { code: 'started' } });
    });
  }
  async publishCapability(runId: string, value: unknown, outputs: Values, retention: 'transient' | 'synthetic' = 'transient', provenance: 'confirmed' | 'model-driven' = 'confirmed') {
    const artifact = parseCapability(value); const validatedOutputs = validateOutput(artifact, outputs);
    if (artifact.sourceDiscoveryRunId !== runId) throw new RepositoryError('SOURCE_RUN_MISMATCH');
    await transaction(this.pool, async (client) => {
      const source = await client.query("SELECT target_snapshot,input_names FROM automation.runs WHERE run_id=$1 AND mode='discovery' AND status='running' FOR UPDATE", [runId]);
      if (!source.rows[0]) throw new RepositoryError('RUN_STATE_CONFLICT');
      if (canonical([...source.rows[0].input_names].sort()) !== canonical(Object.keys(artifact.inputSchema.properties).sort())) throw new RepositoryError('ARTIFACT_INPUT_MISMATCH');
      if (retention === 'synthetic' && source.rows[0].target_snapshot.applicationFamily !== 'demo-credit-union') throw new RepositoryError('OUTPUT_RETENTION_FORBIDDEN');
      const pinnedTarget = targetSchema.parse(source.rows[0].target_snapshot);
      if (artifact.surfaceRequirements.applicationFamily !== pinnedTarget.applicationFamily
        || !artifact.surfaceRequirements.compatibleTargetVersions.includes(pinnedTarget.version)) throw new RepositoryError('INCOMPATIBLE_TARGET');
      const sequences = [...new Set([
        ...artifact.steps.flatMap((step) => step.source.kind === 'authored' ? [] : [step.source.eventSequence]),
        ...artifact.manualContributions.flatMap((item) => item.eventSequences),
        ...artifact.recoveryRules.flatMap(rule=>rule.source.observedEventSequences??[]),
      ])];
      const recorded = await client.query<{ sequence: number; actor: string; event_type: string; step_id: string | null; details: {operation?:string}; intervention_id: string | null }>(
        'SELECT sequence,actor,event_type,step_id,details,intervention_id FROM automation.run_events WHERE run_id=$1 AND sequence=ANY($2::integer[])', [runId, sequences]);
      const events = new Map(recorded.rows.map((event) => [event.sequence, event]));
      for (const step of artifact.steps) if (step.source.kind !== 'authored') {
        const event = events.get(step.source.eventSequence);
        if (!event || event.step_id !== step.id || (event.details.operation && event.details.operation !== step.type) || !['ACTION_COMPLETED', 'READ_COMPLETED'].includes(event.event_type)
          || event.actor !== (step.source.kind === 'manual' ? 'human' : 'automation')
          || (step.source.kind === 'manual' && event.intervention_id !== step.source.interventionId)) throw new RepositoryError('UNCONFIRMED_ARTIFACT_SOURCE');
      }
      for (const item of artifact.manualContributions) for (const sequence of item.eventSequences) {
        const event = events.get(sequence);
        if (!event || event.actor !== 'human' || event.intervention_id !== item.interventionId
          || !['ACTION_COMPLETED', 'READ_COMPLETED'].includes(event.event_type)) throw new RepositoryError('UNCONFIRMED_MANUAL_SOURCE');
      }
      for(const rule of artifact.recoveryRules){const observed=rule.source.observedEventSequences??[];for(const [index,sequence] of observed.entries()){const event=events.get(sequence);const action=rule.actions[index%rule.actions.length]!;if(!event||event.actor!=='automation'||event.event_type!=='ACTION_COMPLETED'||event.details.operation!==action.type||('target' in action && (event.details as {targetRef?:string}).targetRef!==action.target))throw new RepositoryError('UNCONFIRMED_RECOVERY_SOURCE');}}
      for(const rule of artifact.recoveryRules)for(const sequence of rule.source.observedEventSequences??[]){
        const event=events.get(sequence)!;const parentIndex=artifact.steps.findIndex(step=>event.step_id?.startsWith(step.id+'-r')&&rule.appliesToStepIds.includes(step.id));
        const parent=artifact.steps[parentIndex];if(!parent||parent.source.kind==='authored')throw new RepositoryError('UNCONFIRMED_RECOVERY_SOURCE');
        const previous=artifact.steps[parentIndex-1],next=artifact.steps[parentIndex+1];
        const lower=rule.dispatchState==='settled'?parent.source.eventSequence:previous?.source.kind==='discovery'?previous.source.eventSequence:0;
        const upper=rule.dispatchState==='not_sent'?parent.source.eventSequence:next?.source.kind==='discovery'?next.source.eventSequence:Number.MAX_SAFE_INTEGER;
        if(sequence<=lower||sequence>=upper)throw new RepositoryError('UNCONFIRMED_RECOVERY_SOURCE');
      }
      const stepSequences = artifact.steps.flatMap(step => step.source.kind === 'authored' ? [] : [step.source.eventSequence]);
      if (new Set(stepSequences).size !== stepSequences.length) throw new RepositoryError('UNCONFIRMED_ARTIFACT_SOURCE');
      if (provenance === 'model-driven') {
        const models = await client.query("SELECT 1 FROM automation.run_events WHERE run_id=$1 AND event_type='MODEL_COMPLETED' AND (details->>'inputTokens')::bigint>0 LIMIT 1", [runId]);
        if (!models.rowCount) throw new RepositoryError('UNCONFIRMED_MODEL_SOURCE');
        const mutations = await client.query<{sequence:number}>("SELECT sequence FROM automation.run_events WHERE run_id=$1 AND event_type='ACTION_COMPLETED' AND actor IN ('automation','human') AND details->>'operation' IN ('navigate','click','fill') ORDER BY sequence", [runId]);
        const recoverySequences=artifact.recoveryRules.flatMap(rule=>(rule.source.observedEventSequences??[]).filter(sequence=>events.get(sequence)?.details.operation==='click'));
        const represented = artifact.steps.filter(step => ['navigate','click','fill'].includes(step.type)).map(step => step.source.kind === 'authored' ? -1 : step.source.eventSequence).concat(recoverySequences, artifact.manualContributions.filter(item=>(item.handling==='runtime_guard'||item.handling==='required_intervention')).flatMap(item=>item.eventSequences)).sort((a,b)=>a-b);
        if(new Set(represented).size!==represented.length)throw new RepositoryError('INCOMPLETE_DISCOVERY_HISTORY');
        if (canonical(represented) !== canonical(mutations.rows.map(row => row.sequence))) throw new RepositoryError('INCOMPLETE_DISCOVERY_HISTORY');
      }
      const capability = { id: artifact.capabilityId, version: artifact.version };
      const result = { kind: 'success', capability, output: retention === 'synthetic'
        ? { availability: 'available', values: validatedOutputs } : { availability: 'not_retained', reason: 'OUTPUTS_NOT_RETAINED' } };
      await client.query('INSERT INTO automation.capabilities(capability_id,version,schema_version,source_discovery_run_id,artifact) VALUES($1,$2,$3,$4,$5)', [artifact.capabilityId, artifact.version, artifact.schemaVersion, runId, JSON.stringify(artifact)]);
      await client.query("UPDATE automation.runs SET status='completed',controller='none',control_revision=control_revision+1,capability_id=$2,capability_version=$3,result=$4,updated_at=now() WHERE run_id=$1", [runId, artifact.capabilityId, artifact.version, JSON.stringify(result)]);
      await append(client, runId, { type: 'RUN_COMPLETED', actor: 'system', stepId: null, details: { code: 'capability_saved' } });
    });
  }
  // Setup/operator tool only: attach authored scenario rules without inventing a discovery run.
  async publishRuleRevision(value: unknown, baseVersion: number, principal: string) {
    const artifact=parseCapability(value);
    return transaction(this.pool,async client=>{
      const source=(await client.query("SELECT r.run_id FROM automation.runs r JOIN automation.capabilities c ON c.source_discovery_run_id=r.run_id WHERE c.capability_id=$1 AND c.version=$2 AND r.principal_ref=$3 AND r.status='completed' FOR UPDATE OF r",[artifact.capabilityId,baseVersion,principal])).rows[0];
      if(!source)throw new RepositoryError('CAPABILITY_NOT_FOUND');
      const original=await this.getCapability(artifact.capabilityId,baseVersion,client);
      const latest=(await client.query('SELECT max(version)::integer AS version FROM automation.capabilities WHERE capability_id=$1',[artifact.capabilityId])).rows[0].version;
      if(latest!==baseVersion||artifact.version!==baseVersion+1)throw new RepositoryError('CAPABILITY_VERSION_CONFLICT');
      const core=(cap:typeof artifact)=>({schemaVersion:cap.schemaVersion,capabilityId:cap.capabilityId,sourceDiscoveryRunId:cap.sourceDiscoveryRunId,inputSchema:cap.inputSchema,outputSchema:cap.outputSchema,variables:cap.variables,preconditions:cap.preconditions,outputs:cap.outputs,successCondition:cap.successCondition,manualContributions:cap.manualContributions,steps:cap.steps.map(({outcomeRuleIds:_outcomes,recoveryRuleIds:_recoveries,...step})=>step)});
      if(canonical(core(original))!==canonical(core(artifact))||Object.entries(original.targets).some(([key,target])=>canonical(target)!==canonical(artifact.targets[key]))||original.surfaceRequirements.applicationFamily!==artifact.surfaceRequirements.applicationFamily)throw new RepositoryError('INVALID_RULE_REVISION');
      for(const old of original.recoveryRules)if((old.source.observedEventSequences??[]).length&&canonical(old)!==canonical(artifact.recoveryRules.find(rule=>rule.id===old.id)))throw new RepositoryError('INVALID_RULE_REVISION');
      // Historical recovery executions belong to the source artifact, never a new authored rule.
      for(const rule of artifact.recoveryRules)if((rule.source.observedEventSequences??[]).length&&canonical(rule.source.observedEventSequences)!==canonical(original.recoveryRules.find(old=>old.id===rule.id)?.source.observedEventSequences))throw new RepositoryError('INVALID_RULE_REVISION');
      await client.query('INSERT INTO automation.capabilities(capability_id,version,schema_version,source_discovery_run_id,artifact,base_version) VALUES($1,$2,$3,$4,$5,$6)',[artifact.capabilityId,artifact.version,artifact.schemaVersion,artifact.sourceDiscoveryRunId,JSON.stringify(artifact),baseVersion]);
      await append(client,source.run_id,{type:'CAPABILITY_REVISED',actor:'system',stepId:null,details:{code:'authored_scenario_rules'}});
      return artifact;
    });
  }
  async getRun(runId: string) {
    const response = await this.pool.query('SELECT * FROM automation.runs WHERE run_id=$1', [runId]);
    const row = response.rows[0]; if (!row) throw new RepositoryError('RUN_NOT_FOUND');
    return RunViewSchema.parse({ runId: row.run_id, mode: row.mode, target: { id: row.target_id, version: row.target_version },
      policy: { id: row.policy_id, version: row.policy_version }, status: row.status,
      control: { owner: row.controller, revision: row.control_revision, ...(row.controller === 'human' ? { operatorId: row.operator_ref } : {}) },
      capability: row.capability_id ? { id: row.capability_id, version: row.capability_version } : null,
      currentStepId: row.current_step_id, activeInterventionId: row.active_intervention_id, result: row.result,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
  }
}
export type { RunRequest };
