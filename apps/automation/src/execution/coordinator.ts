import { discoveryModelName } from '../workflows/model.js';
import { ControlRepository } from '../db/control-repository.js';
import { randomUUID } from 'node:crypto';
import type { Observation } from '../workflows/contracts.js';
import type { BlockedContextSchema } from '@interface-ai/contracts';
import type { z } from 'zod';
import type { StoredEventInput } from '../db/repository.js';
import type { Planner, SessionStatistics } from '../workflows/contracts.js';
import { RunRequestSchema, outputSchemaFor, validateCapabilityResult, validateOutput } from '@interface-ai/contracts';
import type { Capability, RunRequest, RunResult, Target, Values } from '@interface-ai/contracts';
import type { AutomationRepository, loadConfigurations } from '../db/repository.js';
import { RepositoryError, canonical, riskyControlNames, targetSchema, policySchema } from '../db/repository.js';
import { RuntimeRepository } from '../db/runtime-repository.js';
import { DispatchGate } from './gate.js';
import { describeStepFailure, failureSummary, startCategories } from './diagnostics.js';
import type { StartCategory } from './diagnostics.js';
import { Executor } from './executor.js';
import type { BrowserSurface } from './surface.js';
import { EvidenceStore } from './evidence.js';
import { ExecutionError, NeedsIntervention, failureCodes } from './errors.js';

export type Configuration = Awaited<ReturnType<typeof loadConfigurations>>;
export interface SessionResource { id: string; surface: BrowserSurface; close(): Promise<boolean>; planner?: Planner; statistics?(): SessionStatistics }
export interface SessionFactory {
  validate?(configuration: Configuration, mode: 'discovery' | 'replay'): void;
  open(configuration: Configuration, onCreated: (id: string) => Promise<void>, signal: AbortSignal, mode?: 'discovery' | 'replay'): Promise<SessionResource>;
  reconcile(id: string): Promise<boolean>;
}
export interface WorkerContext {
  runId: string; signal: AbortSignal; configuration: Configuration;
  plan(context: Parameters<Planner['decide']>[0]): Promise<Awaited<ReturnType<Planner['decide']>>['decision']>;
  capability(): Promise<Capability>;
  record(event: StoredEventInput): Promise<number>;
  executor(targets: Record<string, Target>, variables?: Values): Promise<Executor>;
  publish(capability: Capability, outputs: Values): Promise<void>;
  activeNow?(): number;
  intervene?(blocked: z.infer<typeof BlockedContextSchema>, validate: () => Promise<boolean>, timeoutMs?:number): Promise<{interventionId:string;eventSequences:number[]}>;
}
export type Worker = (request: RunRequest, context: WorkerContext) => Promise<RunResult | void>;
const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status);
const failure = (code: string, category?: string): Extract<RunResult, { kind: 'failure' }> => ({ kind: 'failure', code, summary: failureSummary(code, category), blocked: null, evidenceIds: [] });
/** What the model chose and why, in the observation's closed vocabulary. Unknown references are omitted, not guessed. */
export function decisionSummary(prepared: Parameters<Planner['decide']>[0], decision: Awaited<ReturnType<Planner['decide']>>['decision']) {
  const control = prepared.observation.controls.find(item => item.ref === decision.controlRef);
  const fields = [...new Set(Object.values(decision.outputs).map(ref => prepared.observation.fields.find(item => item.ref === ref)?.label).filter(label => label !== undefined))];
  return { action: decision.action, decisionReason: decision.reason, ...(control ? { controlLabel: control.label } : {}),
    ...(decision.action === 'fill' && prepared.inputNames.includes(decision.inputName) ? { inputName: decision.inputName } : {}),
    ...(decision.action === 'finish' && fields.length ? { fieldLabels: fields.slice(0, 8) } : {}) };
}
const unavailableWorker: Worker = async request => failure(request.mode === 'discovery' ? 'DISCOVERY_NOT_IMPLEMENTED' : 'REPLAY_NOT_IMPLEMENTED');
interface Pause { id:string; validate:()=>Promise<boolean>; resolve:(value:{interventionId:string;eventSequences:number[]})=>void; reject:(error:Error)=>void; startedAt:number; accountedMs:number; sequences:number[]; observation?:Observation|undefined }
interface Job { revision:number; pausedMs:number; controlBusy:boolean; inputs:Values; goal:string|undefined; resource?:SessionResource; pause?:Pause|undefined; validation?:{id:string;principal:string}|undefined; runId: string; gate: DispatchGate; abort: AbortController; task: Promise<void>; executor?: Executor }
export class Coordinator {
  readonly repository: RuntimeRepository;
  private readonly controls: ControlRepository;
  private job: Job | undefined;
  private releaseLock: (() => Promise<void>) | undefined;
  private readonly outputTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private storeOutputs(runId: string, values: Values) {
    while (this.outputs.size >= 32) { const id = this.outputs.keys().next().value!; this.outputs.delete(id); clearTimeout(this.outputTimers.get(id)); this.outputTimers.delete(id); }
    clearTimeout(this.outputTimers.get(runId));
    this.outputs.set(runId, { values, expiresAt: Date.now() + 300_000 });
    const timer = setTimeout(() => { this.outputs.delete(runId); this.outputTimers.delete(runId); }, 300_000); timer.unref(); this.outputTimers.set(runId, timer);
  }
  private ready = false;
  private stopping = false;
  private readonly outputs = new Map<string, { values: Values; expiresAt: number }>();
  constructor(readonly base: AutomationRepository, fingerprintKey: string, readonly configuration: Configuration,
    readonly evidence: EvidenceStore, private readonly sessions?: SessionFactory, private readonly worker: Worker = unavailableWorker) {
    const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
    this.configuration = freeze({ target: targetSchema.parse(configuration.target), policy: policySchema.parse(configuration.policy) });
    this.repository = new RuntimeRepository(base, fingerprintKey);
    this.controls = new ControlRepository(this.repository,fingerprintKey);
  }
  async start() {
    this.releaseLock = await this.repository.lock(() => { this.ready = false; this.job?.gate.close(); this.job?.abort.abort(); });
    try { await this.reconcile(); this.ready = true; }
    catch (error) { await this.releaseLock(); this.releaseLock = undefined; throw error; }
  }
  async reconcile() {
    if (this.job) throw new RepositoryError('RUN_STATE_CONFLICT');
    for (const row of await this.repository.sessions()) {
      let closed = row.session_state === 'none' || row.session_state === 'closed';
      if (!closed && row.provider_session_id && this.sessions) {
        try { closed = await this.sessions.reconcile(row.provider_session_id); } catch { /* Keep capacity occupied. */ }
      }
      if (!closed && row.session_expires_at && row.session_expires_at.getTime() <= Date.now()) closed = true;
      if (row.session_state !== 'none') await this.repository.sessionState(row.run_id, closed ? 'closed' : 'uncertain');
      if (!terminal(row.status)) await this.repository.finish(row.run_id, { kind: 'cancelled', reason: 'INTERRUPTED',
        dispatchState: row.dispatch_state === 'sent' ? 'unknown' : row.dispatch_state, effectState: row.dispatch_state === 'sent' ? 'unknown' : row.effect_state });
    }
  }
  async accept(value: unknown, principal: string, key: string) {
    if (!this.ready || this.stopping) throw new RepositoryError('COORDINATOR_UNAVAILABLE');
    const request = RunRequestSchema.parse(value);
    const accepted = await this.base.acceptRun(request, { principal, idempotencyKey: key }, this.configuration);
    if (!accepted.reused) {
      // Acceptance commits before background work. The raw goal/values are volatile and never redispatched after restart.
      const job: Job = { revision:2,pausedMs:0,controlBusy:false,goal:request.mode==='discovery'?request.goal:undefined,inputs:request.inputs,runId: accepted.runId, gate: new DispatchGate(2), abort: new AbortController(), task: Promise.resolve() };
      if (this.job) await this.job.task;
      this.job = job;
      job.task = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.run(job, request)).catch(() => {
        this.ready = false; job.gate.close(); job.abort.abort(); console.error('Run coordinator stopped safely after a persistence failure. Restart and reconcile before continuing.');
      }).finally(() => { if (this.job === job) this.job = undefined; });
    }
    return { runId: accepted.runId, status: 'pending' as const, statusUrl: `/v1/runs/${accepted.runId}`, operationUrl: `/v1/runs/${accepted.runId}/operations/${accepted.receiptId}` };
  }
  private async run(job: Job, request: RunRequest) {
    let resource: SessionResource | undefined; let opening: Promise<SessionResource> | undefined; let notCreated: ExecutionError | undefined;
    let result: RunResult | undefined;
    const time = Date.now(); const budgets = this.configuration.policy.budgets;
    const getSession = async () => {
      if (!this.sessions) throw new ExecutionError('SESSION_LOST');
      job.gate.check(job.revision); if (job.abort.signal.aborted) throw new ExecutionError('CANCELLED');
      if (!opening) { this.sessions.validate?.(this.configuration, request.mode); opening = (async () => {
        // Covers provider request timeout, admitted lifetime, and a conservative expiry margin.
        await this.repository.sessionIntent(job.runId, new Date(Date.now() + budgets.overallTimeoutMs + 120_000));
        const session = await this.sessions!.open(this.configuration, id => this.repository.sessionCreated(job.runId, id), job.abort.signal, request.mode);
        resource = session; job.resource=session;
        if (job.abort.signal.aborted || job.gate.snapshot().closed) { await session.close().catch(() => false); throw new ExecutionError('CANCELLED'); }
        return session;
      })();
      // A definitive provider refusal means no session exists, so there is nothing to clean up or hold.
      opening.catch(error => { if (error instanceof ExecutionError && error.code === 'SESSION_NOT_CREATED') notCreated = error; }); }
      return opening;
    };
    let modelCalls = 0;
    const context: WorkerContext = { runId: job.runId, signal: job.abort.signal, configuration: this.configuration,
      record: event => this.repository.record(job.runId, job.revision, event),
      activeNow:()=>Date.now()-job.pausedMs,
      intervene: async (blocked,validate,requestedTimeoutMs=budgets.interventionTimeoutMs)=>{
        if(!resource || !job.executor || !this.configuration.policy.allowedActions.includes('intervene') || blocked.dispatchState==='unknown' || blocked.dispatchState==='sent')throw new NeedsIntervention(blocked);
        if(job.pause)throw new ExecutionError('CONTROL_CHANGED');
        if(!Number.isFinite(requestedTimeoutMs)||requestedTimeoutMs<1)throw new ExecutionError('BUDGET_EXHAUSTED');
        clearTimeout(timeout);job.gate.close();
        if(!await job.gate.drain(budgets.stepTimeoutMs))throw new ExecutionError('ACTION_OUTCOME_UNKNOWN','unknown','unknown');
        if(job.abort.signal.aborted)throw new ExecutionError('CANCELLED');
        if(!blocked.evidenceIds.length){try{blocked.evidenceIds.push(await this.evidence.capture(job.runId,blocked.stepId,resource.surface,this.automatedPolicy()));}catch{}}
        const lifetime=Math.max(1,Math.min(requestedTimeoutMs,budgets.interventionTimeoutMs,budgets.overallTimeoutMs-(Date.now()-time)));
        const id=await this.repository.openIntervention(job.runId,blocked,new Date(Date.now()+lifetime));
        job.revision=(await this.base.getRun(job.runId)).control.revision;
        let timer:ReturnType<typeof setTimeout>|undefined;let aborted:()=>void=()=>{};
        try{return await new Promise<{interventionId:string;eventSequences:number[]}>((resolve,reject)=>{
          job.pause={id,validate,resolve,reject,startedAt:Date.now(),accountedMs:0,sequences:[]};
          aborted=()=>reject(new ExecutionError('CANCELLED'));
          job.abort.signal.addEventListener('abort',aborted,{once:true});if(job.abort.signal.aborted)aborted();
          timer=setTimeout(()=>reject(new ExecutionError('INTERVENTION_TIMEOUT')),lifetime);
        });}finally{clearTimeout(timer);job.abort.signal.removeEventListener('abort',aborted);job.pause=undefined;job.validation=undefined;armActive();}
      },
      capability: async () => { if (request.mode !== 'replay') throw new RepositoryError('RUN_STATE_CONFLICT'); return this.base.getCapability(request.capability.id, request.capability.version); },
      plan: async prepared => {
        if (request.mode !== 'discovery') throw new ExecutionError('INFERENCE_FORBIDDEN');
        if (++modelCalls > budgets.maxModelCalls) throw new ExecutionError('MODEL_BUDGET_EXHAUSTED');
        const session = await getSession(); if (!session.planner) throw new ExecutionError('MODEL_UNAVAILABLE');
        return job.gate.dispatch(job.revision, async () => {
          await this.repository.assertRunning(job.runId, job.revision);
          await this.repository.record(job.runId, job.revision, { type: 'MODEL_REQUESTED', actor: 'automation', stepId: null, details: { code: 'requesting', modelCalls, modelName: discoveryModelName } });
          const remaining = Math.min(budgets.activeTimeoutMs-(Date.now()-time-job.pausedMs),budgets.overallTimeoutMs-(Date.now()-time));
          if (remaining <= 0 || job.abort.signal.aborted) throw new ExecutionError('BUDGET_EXHAUSTED');
          let proposed; try { proposed = await session.planner!.decide(prepared, Math.min(120_000, remaining)); } catch { throw new ExecutionError('MODEL_UNAVAILABLE'); }
          job.gate.check(job.revision);
          await this.repository.record(job.runId, job.revision, { type: 'MODEL_COMPLETED', actor: 'automation', stepId: null, details: { code: 'proposed', modelCalls, modelName: discoveryModelName, inputTokens: proposed.usage.inputTokens, outputTokens: proposed.usage.outputTokens, ...decisionSummary(prepared, proposed.decision) } });
          return proposed.decision;
        });
      },
      executor: async (targets, variables = {}) => {
        if (job.executor) throw new ExecutionError('CONTROL_CHANGED');
        const session = await getSession();
        job.executor = new Executor({ runId: job.runId, entryPoint: this.configuration.target.entryPoint,
          policy: this.automatedPolicy(),
          surface: session.surface, gate: job.gate, signal: job.abort.signal, revision: job.revision, startedAt: time, targets, inputs: request.inputs, variables, routes: { 'fresh-session': 'about:blank', 'target-entry': this.configuration.target.entryPoint },
          authorize: () => job.validation?this.controls.authorize(job.validation.id,job.validation.principal,job.revision,'validating_resume'):this.repository.assertRunning(job.runId, job.revision),
          record: event => job.validation?this.controls.record(job.validation.id,job.validation.principal,job.revision,{...event,actor:'system'}):this.repository.record(job.runId, job.revision, event), evidence: this.evidence });
        return job.executor;
      },
      publish: async (capability, outputs) => {
        job.gate.check(job.revision); if (job.abort.signal.aborted) throw new ExecutionError('CANCELLED');
        if (request.mode !== 'discovery') throw new RepositoryError('RUN_STATE_CONFLICT');
        if(canonical({...capability.outputSchema,required:[...capability.outputSchema.required].sort()})!==canonical(outputSchemaFor(request.outputContract)))throw new ExecutionError('ARTIFACT_INVALID');
        const safe = validateOutput(capability, outputs);
        await this.base.publishCapability(job.runId, capability, safe, 'transient', 'model-driven');
        this.storeOutputs(job.runId, safe);
      },
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    let overallTimer: ReturnType<typeof setTimeout> | undefined;
    let budgetReject: ((error:Error)=>void)|undefined;
    const armActive=()=>{clearTimeout(timeout);if(job.abort.signal.aborted)return;const remaining=budgets.activeTimeoutMs-(Date.now()-time-job.pausedMs);timeout=setTimeout(()=>budgetReject?.(new ExecutionError('BUDGET_EXHAUSTED')),Math.max(1,remaining));};
    try {
      if (job.abort.signal.aborted || (await this.repository.state(job.runId)).status === 'cancelling') return;
      await this.base.markRunning(job.runId);
      if (job.abort.signal.aborted) throw new ExecutionError('CANCELLED');
      const work = this.worker(request, context);
      const aborted = new Promise<never>((_resolve, reject) => { abortListener = () => reject(new ExecutionError('CANCELLED')); if (job.abort.signal.aborted) abortListener(); else job.abort.signal.addEventListener('abort', abortListener, { once: true }); });
      const output = await Promise.race([work, aborted, new Promise<never>((_resolve,reject)=>{budgetReject=reject;armActive();overallTimer=setTimeout(()=>reject(new ExecutionError('BUDGET_EXHAUSTED')),Math.max(1,budgets.overallTimeoutMs-(Date.now()-time)));})]);
      if(output?.kind==='business_outcome' && request.mode==='discovery'){
        const recorded=await this.base.pool.query("SELECT 1 FROM automation.run_events WHERE run_id=$1 AND event_type='BUSINESS_OUTCOME' AND details->>'code'=$2",[job.runId,output.code]);
        if(!['MEMBER_NOT_FOUND','NO_PRIMARY_SAVINGS_ACCOUNT','ACCESS_DENIED'].includes(output.code)||!recorded.rowCount)throw new RepositoryError('INVALID_OUTPUT');
        result={...output,summary:'A declared business outcome was verified in the live UI.'};
      } else if (output?.kind === 'success' || output?.kind === 'business_outcome') {
        if (request.mode !== 'replay') throw new RepositoryError('RUN_STATE_CONFLICT');
        const capability = await this.repository.capability(request.capability.id, request.capability.version, (await this.base.pool.query('SELECT principal_ref FROM automation.runs WHERE run_id=$1', [job.runId])).rows[0].principal_ref);
        if (output.kind === 'success' && output.output.availability !== 'available') throw new RepositoryError('INVALID_OUTPUT');
        const checked = validateCapabilityResult(capability, output);
        if (checked.kind === 'success' && checked.output.availability === 'available') {
          this.storeOutputs(job.runId, checked.output.values);
          result = { ...checked, output: { availability: 'not_retained', reason: 'OUTPUTS_NOT_RETAINED' } };
        } else result = checked.kind === 'business_outcome' ? { ...checked, summary: 'A declared business outcome was confirmed in the target UI.' } : checked;
      } else if (output?.kind === 'failure') {
        const allowed: readonly string[] = [...failureCodes, 'DISCOVERY_NOT_IMPLEMENTED', 'REPLAY_NOT_IMPLEMENTED'];
        result = failure(allowed.includes(output.code) ? output.code : 'WORKER_FAILED');
      } else if (output?.kind === 'cancelled') result = { ...output, reason: 'INTERRUPTED' };
      else if (!terminal((await this.repository.state(job.runId)).status)) result = failure('WORKER_FAILED');
    } catch (error) {
      if (error instanceof NeedsIntervention) {
        job.gate.close();
        const safe = error.blocked;
        const previous = job.executor?.lastFailure;
        if (previous) { safe.stepId = previous.stepId; safe.dispatchState = previous.dispatchState; safe.effectState = previous.effectState; safe.evidenceIds = previous.evidenceIds; }
        if (resource && !safe.evidenceIds.length) {
          try { const id = await this.evidence.capture(job.runId, safe.stepId, resource.surface, this.automatedPolicy()); safe.evidenceIds.push(id); } catch { /* Suppress unsafe captures. */ }
        }
        result = { ...failure('HUMAN_HELP_REQUIRED'), kind: 'failure', blocked: safe, evidenceIds: safe.evidenceIds };
        if (resource && await job.gate.drain(budgets.stepTimeoutMs)) {
          const lifetime = Math.max(1, Math.min(budgets.interventionTimeoutMs, budgets.overallTimeoutMs - (Date.now() - time)));
          await this.repository.openIntervention(job.runId, safe, new Date(Date.now() + lifetime));
          await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); job.abort.signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, lifetime); if (job.abort.signal.aborted) done(); else job.abort.signal.addEventListener('abort', done, { once: true }); });
          if (!job.abort.signal.aborted) result = { ...result, code: 'INTERVENTION_TIMEOUT' };
        }
      } else result = failure(error instanceof ExecutionError ? error.code : 'WORKER_FAILED', error instanceof ExecutionError ? error.category : undefined);
      const context = job.executor?.lastFailure;
      // An intervention already carries its own blocked context (merged with the last failure above); do not replace it.
      if (context && result.kind === 'failure' && !(error instanceof NeedsIntervention)) {
        // Describe the condition that actually failed (code and authored rule ID only), not a generic timeout.
        result.evidenceIds = context.evidenceIds; result.blocked = { stepId: context.stepId, actionIndex: null, ...describeStepFailure(context.code, context.ruleId),
          dispatchState: context.dispatchState, effectState: context.effectState, checkpointId: null, evidenceIds: context.evidenceIds };
        if (result.code === context.code) result.summary = (failureSummary(context.code) + ' Step: ' + context.stepId + '.').slice(0, 500);
      }
    } finally {
      clearTimeout(timeout); clearTimeout(overallTimer); if (abortListener) job.abort.signal.removeEventListener('abort', abortListener);
      job.gate.close(); job.abort.abort();
      const drained = await job.gate.drain(budgets.stepTimeoutMs + 1000);
      let closed = !opening;
      if (opening && notCreated && !resource) {
        closed = true; await this.repository.sessionState(job.runId, 'closed');
        await this.base.appendEvent(job.runId, { type: 'SESSION_FINISHED', actor: 'system', stepId: null, details: { code: 'not_created', ...((startCategories as readonly string[]).includes(notCreated.category ?? '') ? { category: notCreated.category as StartCategory } : {}), modelCalls: 0, inferenceAttempts: 0, inputTokens: 0, outputTokens: 0 } });
      } else if (opening) {
        await this.repository.sessionState(job.runId, 'close_requested');
        if (resource) { try { closed = await resource.close(); } catch { closed = false; } }
        const row = await this.repository.state(job.runId);
        if (!closed && row.provider_session_id && this.sessions) { try { closed = await this.sessions.reconcile(row.provider_session_id); } catch { closed = false; } }
        await this.repository.sessionState(job.runId, closed ? 'closed' : 'uncertain');
        const statistics = resource?.statistics?.();
        await this.base.appendEvent(job.runId, { type: 'SESSION_FINISHED', actor: 'system', stepId: null, details: { code: closed ? 'closed' : 'uncertain', ...(statistics ? { modelCalls: statistics.modelCalls, inferenceAttempts: statistics.inferenceAttempts, inputTokens: statistics.inputTokens, outputTokens: statistics.outputTokens, ...(statistics.mode === 'discovery' ? { modelName: discoveryModelName } : {}) } : {}) } });
      }
      const row = await this.repository.state(job.runId);
      if (!terminal(row.status)) {
        if (row.status === 'cancelling' || this.stopping) result = { kind: 'cancelled', reason: this.stopping ? 'INTERRUPTED' : 'USER_REQUESTED',
          dispatchState: !drained || row.dispatch_state === 'sent' ? 'unknown' : row.dispatch_state,
          effectState: !drained || row.dispatch_state === 'sent' ? 'unknown' : row.effect_state };
        if (!closed && result?.kind !== 'cancelled') {
          // Keep a specific failure cause visible; cleanup uncertainty is reported alongside it, never instead of it.
          if (result?.kind === 'failure' && result.code !== 'WORKER_FAILED') result = { ...result, summary: (result.summary + ' Browser session closure is also unconfirmed; reconcile before retrying.').slice(0, 500) };
          else result = failure('SESSION_CLEANUP_UNCONFIRMED');
        }
        if (result?.kind === 'success' || result?.kind === 'business_outcome') {
          // Report declared recoveries in the result itself, so a caller can tell a clean run from a recovered one.
          const applied = (await this.base.pool.query("SELECT details->>'ruleId' AS rule_id, count(*)::int AS attempts FROM automation.run_events WHERE run_id=$1 AND event_type='RECOVERY_STARTED' AND details ? 'ruleId' GROUP BY 1 ORDER BY min(sequence)", [job.runId])).rows;
          if (applied.length) result = { ...result, recoveries: applied.slice(0, 8).map(row => ({ ruleId: row.rule_id as string, attempts: Math.min(10, row.attempts as number) })) };
        }
        await this.repository.finish(job.runId, result ?? failure('WORKER_FAILED'));
      }
    }
  }
  private async controlJob(id:string,principal:string) {
    const intervention=await this.repository.intervention(id,principal);
    const job=this.job;
    if(!job || job.runId!==intervention.runId || job.pause?.id!==id || !job.resource || !job.executor || job.abort.signal.aborted)throw new RepositoryError('CONTROL_CONFLICT');
    return job;
  }
  private async exclusive<T>(job:Job,work:()=>Promise<T>):Promise<T>{
    if(job.controlBusy)throw new RepositoryError('CONTROL_CONFLICT');job.controlBusy=true;
    try{return await work();}catch(error){if(error instanceof ExecutionError&&error.code==='SESSION_LOST'){job.gate.close();job.pause?.reject(error);}throw error;}finally{job.controlBusy=false;}
  }
  async interventionContext(id:string,principal:string){
    const item=await this.repository.intervention(id,principal);const job=this.job;
    return{goal:job?.runId===item.runId?job.goal??null:null,resumable:job?.pause?.id===id};
  }
  async claim(id:string,principal:string,key:string,body:{expectedControlRevision:number}){
    const job=await this.controlJob(id,principal);
    return this.exclusive(job,async()=>{
      if(job.gate.snapshot().busy)throw new RepositoryError('CONTROL_CONFLICT');
      const receipt=await this.controls.admit(id,principal,key,body,body.expectedControlRevision,'claim');
      if(!receipt.reused){job.revision=receipt.revision;job.gate.reopen(job.revision);job.pause!.observation=undefined;}
      return receipt;
    });
  }
  // Both automated and human-controlled dispatch carry the risky-control list; operator ownership never lifts it.
  private automatedPolicy(){const p=this.configuration.policy;return{...p,allowedClickNames:p.allowedClickNames??[],allowedFillNames:p.allowedFillNames??[],riskyControlNames:riskyControlNames(p)};}
  private manualPolicy(){const p=this.configuration.policy;return{...p,allowedClickNames:[...new Set([...(p.allowedClickNames??[]),...(p.manualClickNames??[])])],allowedFillNames:p.allowedFillNames??[],riskyControlNames:riskyControlNames(p)};}
  async observeManual(id:string,principal:string,revision:number){
    const job=await this.controlJob(id,principal);
    return this.exclusive(job,async()=>{
      await this.controls.authorize(id,principal,revision,'human_controlled');
      const observation=await job.gate.dispatch(revision,async()=>{
        const surface=job.resource!.surface;if(!surface.observe)throw new ExecutionError('UNSUPPORTED_SURFACE');
        const result=await surface.observe(job.inputs,this.manualPolicy());job.gate.check(revision);await this.controls.authorize(id,principal,revision,'human_controlled');return result;
      });
      job.pause!.observation=observation;
      return{observationId:observation.observationId,controlRevision:revision,headings:observation.headings.map(item=>item.label),controls:observation.controls.map(({ref,kind,label,enabled})=>({ref,kind,label,enabled}))};
    });
  }
  async manualImage(id:string,principal:string,revision:number){
    const job=await this.controlJob(id,principal);
    return this.exclusive(job,()=>job.gate.dispatch(revision,async()=>{
      await this.controls.authorize(id,principal,revision,'human_controlled');
      if(!job.resource!.surface.image)throw new ExecutionError('UNSUPPORTED_SURFACE');
      const data=await job.resource!.surface.image();job.gate.check(revision);await this.controls.authorize(id,principal,revision,'human_controlled');return data;
    }));
  }
  async manual(id:string,principal:string,key:string,body:import('zod').infer<typeof import('@interface-ai/contracts').ManualActionRequestSchema>){
    const job=await this.controlJob(id,principal);
    return this.exclusive(job,async()=>{
      const receipt=await this.controls.admit(id,principal,key,body,body.expectedControlRevision,'manual');if(receipt.reused)return receipt;
      const pause=job.pause!,surface=job.resource!.surface,observation=pause.observation;
      if(pause.sequences.length>=32){await this.controls.settle(receipt.receiptId);throw new RepositoryError('CONTROL_CONFLICT');}pause.observation=undefined;
      if(!observation||observation.observationId!==body.observationId||body.action.type==='navigate'){await this.controls.settle(receipt.receiptId);throw new RepositoryError('STALE_OBSERVATION');}
      const action=body.action;
      const control=observation.controls.find(item=>item.ref===action.controlRef&&item.kind===action.type&&item.enabled);
      if(!control){await this.controls.settle(receipt.receiptId);throw new RepositoryError('STALE_OBSERVATION');}
      const revision=body.expectedControlRevision,stepId='manual-'+randomUUID().slice(0,8);
      try{
        // Freshness and dispatch share a single serialized gate slot. No cached element handles.
        const manualExecutor=new Executor({runId:job.runId,entryPoint:this.configuration.target.entryPoint,policy:this.manualPolicy(),surface,gate:job.gate,signal:job.abort.signal,revision,
          beforeDispatch:async()=>{
            if(!surface.observe)throw new ExecutionError('UNSUPPORTED_SURFACE');
            const current=await surface.observe(job.inputs,this.manualPolicy());
            if(current.fingerprint!==observation.fingerprint)throw new ExecutionError('STALE_OBSERVATION');
          },
          targets:{manualTarget:control.target},inputs:body.action.type==='fill'?{...job.inputs,manualValue:body.action.value}:job.inputs,
          authorize:()=>this.controls.authorize(id,principal,revision,'human_controlled'),
          record:event=>this.controls.record(id,principal,revision,{...event,actor:'human',details:{...event.details,controlName:control.label.toLowerCase().replaceAll(' ','-')}}),evidence:this.evidence});
        await manualExecutor.execute(body.action.type==='click'?{type:'click',target:'manualTarget'}:{type:'fill',target:'manualTarget',value:{kind:'input',name:'manualValue'}},stepId);
        if(!manualExecutor.lastEventSequence)throw new ExecutionError('READ_FAILED');pause.sequences.push(manualExecutor.lastEventSequence);
        await this.controls.settle(receipt.receiptId);return{...receipt,state:'settled'};
      }catch(error){await this.controls.settle(receipt.receiptId,job.gate.snapshot().closed);if(job.gate.snapshot().closed){pause.reject(error instanceof Error?error:new ExecutionError('READ_FAILED'));}throw error;}
    });
  }
  async resume(id:string,principal:string,key:string,body:{expectedControlRevision:number;resolutionNote?:string|undefined}){
    const job=await this.controlJob(id,principal);
    return this.exclusive(job,async()=>{
      // Do not admit resume while a browser command is still running, even after its HTTP timeout.
      if(job.gate.snapshot().busy)throw new RepositoryError('CONTROL_CONFLICT');
      const receipt=await this.controls.admit(id,principal,key,body,body.expectedControlRevision,'resume');if(receipt.reused)return receipt;
      const pause=job.pause!;pause.observation=undefined;job.gate.close();
      const elapsed=Date.now()-pause.startedAt-pause.accountedMs;pause.accountedMs+=elapsed;job.pausedMs+=elapsed;job.executor!.accountPause(elapsed);
      job.revision=receipt.revision;job.gate.reopen(job.revision);job.executor!.rebind(job.revision);job.validation={id,principal};
      let valid=false;
      try{valid=pause.sequences.length>0 && await pause.validate();}
      catch{valid=false;}
      job.gate.close();
      if(!await job.gate.drain(this.configuration.policy.budgets.stepTimeoutMs)){pause.reject(new ExecutionError('ACTION_OUTCOME_UNKNOWN','unknown','unknown'));await this.controls.settle(receipt.receiptId,true);throw new RepositoryError('CONTROL_CONFLICT');}
      const revision=await this.controls.finishResume(id,principal,job.revision,valid);job.validation=undefined;job.revision=revision;
      await this.controls.settle(receipt.receiptId);
      if(valid){job.gate.reopen(revision);job.executor!.rebind(revision);pause.resolve({interventionId:id,eventSequences:[...pause.sequences]});}
      if(!valid)throw new RepositoryError('RESUME_VALIDATION_FAILED');
      return{...receipt,revision,state:'settled'};
    });
  }
  async read(runId: string, principal: string) {
    const run = await this.repository.owned(runId, principal); const buffer = this.outputs.get(runId);
    if (buffer && buffer.expiresAt <= Date.now()) this.outputs.delete(runId);
    if (buffer && buffer.expiresAt > Date.now() && run.result?.kind === 'success') return { ...run, result: { ...run.result, output: { availability: 'available' as const, values: buffer.values } } };
    return run;
  }
  async cancel(runId: string, principal: string, key: string, body: unknown) {
    const receipt = await this.repository.cancel(runId, principal, key, body);
    if (this.job?.runId === runId) { this.job.gate.close(); this.job.abort.abort(); }
    return { ...receipt, run: await this.read(runId, principal) };
  }
  async evidenceFor(runId: string, id: string, principal: string) {
    await this.repository.owned(runId, principal);
    const link = await this.base.pool.query("SELECT 1 FROM automation.run_events WHERE run_id=$1 AND details->>'evidenceId'=$2", [runId, id]);
    if (!link.rowCount) throw new RepositoryError('EVIDENCE_NOT_FOUND');
    try { return await this.evidence.read(runId, id); } catch { throw new RepositoryError('EVIDENCE_NOT_FOUND'); }
  }
  async idle() { await this.job?.task; }
  async stop() {
    this.stopping = true; this.ready = false; this.outputs.clear(); for (const timer of this.outputTimers.values()) clearTimeout(timer); this.outputTimers.clear();
    this.job?.gate.close(); this.job?.abort.abort();
    await this.job?.task;
    await this.releaseLock?.(); this.releaseLock = undefined;
  }
  // Exposes no browser handles, provider links, raw request values, or unredacted captures.
  status() { return { ready: this.ready && !this.stopping, activeRunId: this.job?.runId ?? null }; }
}
