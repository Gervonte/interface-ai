import { RunRequestSchema, validateCapabilityResult, validateOutput } from '@interface-ai/contracts';
import type { Capability, RunRequest, RunResult, Target, Values } from '@interface-ai/contracts';
import type { AutomationRepository, loadConfigurations } from '../db/repository.js';
import { RepositoryError, targetSchema, policySchema } from '../db/repository.js';
import { RuntimeRepository } from '../db/runtime-repository.js';
import { DispatchGate } from './gate.js';
import { Executor } from './executor.js';
import type { BrowserSurface } from './surface.js';
import { EvidenceStore } from './evidence.js';
import { ExecutionError, failureCodes } from './errors.js';

export type Configuration = Awaited<ReturnType<typeof loadConfigurations>>;
export interface SessionResource { id: string; surface: BrowserSurface; close(): Promise<boolean> }
export interface SessionFactory {
  open(configuration: Configuration, onCreated: (id: string) => Promise<void>, signal: AbortSignal): Promise<SessionResource>;
  reconcile(id: string): Promise<boolean>;
}
export interface WorkerContext {
  runId: string; signal: AbortSignal;
  executor(targets: Record<string, Target>): Promise<Executor>;
  publish(capability: Capability, outputs: Values): Promise<void>;
}
export type Worker = (request: RunRequest, context: WorkerContext) => Promise<RunResult | void>;
const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status);
const failure = (code: string): RunResult => ({ kind: 'failure', code, summary: 'Execution stopped. Inspect the sanitized run events for context.', blocked: null, evidenceIds: [] });
const unavailableWorker: Worker = async request => failure(request.mode === 'discovery' ? 'DISCOVERY_NOT_IMPLEMENTED' : 'REPLAY_NOT_IMPLEMENTED');
interface Job { runId: string; gate: DispatchGate; abort: AbortController; task: Promise<void>; executor?: Executor }
export class Coordinator {
  readonly repository: RuntimeRepository;
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
      const job: Job = { runId: accepted.runId, gate: new DispatchGate(2), abort: new AbortController(), task: Promise.resolve() };
      if (this.job) await this.job.task;
      this.job = job;
      job.task = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.run(job, request)).catch(() => {
        this.ready = false; job.gate.close(); job.abort.abort(); console.error('Run coordinator stopped safely after a persistence failure. Restart and reconcile before continuing.');
      }).finally(() => { if (this.job === job) this.job = undefined; });
    }
    return { runId: accepted.runId, status: 'pending' as const, statusUrl: `/v1/runs/${accepted.runId}`, operationUrl: `/v1/runs/${accepted.runId}/operations/${accepted.receiptId}` };
  }
  private async run(job: Job, request: RunRequest) {
    let resource: SessionResource | undefined; let opening: Promise<SessionResource> | undefined;
    let result: RunResult | undefined;
    const time = Date.now(); const budgets = this.configuration.policy.budgets;
    const getSession = async () => {
      if (!this.sessions) throw new ExecutionError('SESSION_LOST');
      job.gate.check(2); if (job.abort.signal.aborted) throw new ExecutionError('CANCELLED');
      if (!opening) opening = (async () => {
        // Covers provider request timeout, admitted lifetime, and a conservative expiry margin.
        await this.repository.sessionIntent(job.runId, new Date(Date.now() + budgets.overallTimeoutMs + 120_000));
        const session = await this.sessions!.open(this.configuration, id => this.repository.sessionCreated(job.runId, id), job.abort.signal);
        resource = session;
        if (job.abort.signal.aborted || job.gate.snapshot().closed) { await session.close().catch(() => false); throw new ExecutionError('CANCELLED'); }
        return session;
      })();
      return opening;
    };
    const context: WorkerContext = { runId: job.runId, signal: job.abort.signal,
      executor: async targets => {
        if (job.executor) throw new ExecutionError('CONTROL_CHANGED');
        const session = await getSession();
        const policy = this.configuration.policy;
        job.executor = new Executor({ runId: job.runId, entryPoint: this.configuration.target.entryPoint,
          policy: { ...policy, allowedClickNames: policy.allowedClickNames ?? [], allowedFillNames: policy.allowedFillNames ?? [] },
          surface: session.surface, gate: job.gate, signal: job.abort.signal, revision: 2, startedAt: time, targets, inputs: request.inputs,
          authorize: () => this.repository.assertRunning(job.runId, 2), record: event => this.repository.record(job.runId, 2, event), evidence: this.evidence });
        return job.executor;
      },
      publish: async (capability, outputs) => {
        job.gate.check(2); if (job.abort.signal.aborted) throw new ExecutionError('CANCELLED');
        if (request.mode !== 'discovery') throw new RepositoryError('RUN_STATE_CONFLICT');
        const safe = validateOutput(capability, outputs);
        await this.base.publishCapability(job.runId, capability, safe);
        this.storeOutputs(job.runId, safe);
      },
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    try {
      if (job.abort.signal.aborted || (await this.repository.state(job.runId)).status === 'cancelling') return;
      await this.base.markRunning(job.runId);
      if (job.abort.signal.aborted) throw new ExecutionError('CANCELLED');
      const work = this.worker(request, context);
      const aborted = new Promise<never>((_resolve, reject) => { abortListener = () => reject(new ExecutionError('CANCELLED')); if (job.abort.signal.aborted) abortListener(); else job.abort.signal.addEventListener('abort', abortListener, { once: true }); });
      const output = await Promise.race([work, aborted, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new ExecutionError('BUDGET_EXHAUSTED')), Math.min(budgets.activeTimeoutMs, budgets.overallTimeoutMs)); })]);
      if (output?.kind === 'success' || output?.kind === 'business_outcome') {
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
      result = failure(error instanceof ExecutionError ? error.code : 'WORKER_FAILED');
      const context = job.executor?.lastFailure;
      if (context && result.kind === 'failure') {
        const reasons = ['AMBIGUOUS_TARGET','TARGET_NOT_FOUND','STATE_TIMEOUT','ACTION_OUTCOME_UNKNOWN','POLICY_BLOCKED','SESSION_LOST'] as const;
        const reason = reasons.find(value => value === context.code) ?? 'STATE_TIMEOUT';
        result.evidenceIds = context.evidenceIds; result.blocked = { stepId: context.stepId, actionIndex: null, reason, dispatchState: context.dispatchState, effectState: context.effectState, checkpointId: null,
          expected: { code: 'UNIQUE_READY_TARGET', description: 'One permitted actionable target and a satisfied UI condition.' }, observed: { code: context.code, description: 'The required UI condition was not confirmed.' }, evidenceIds: context.evidenceIds };
      }
    } finally {
      clearTimeout(timeout); if (abortListener) job.abort.signal.removeEventListener('abort', abortListener);
      job.gate.close(); job.abort.abort();
      const drained = await job.gate.drain(budgets.stepTimeoutMs + 1000);
      let closed = !opening;
      if (opening) {
        await this.repository.sessionState(job.runId, 'close_requested');
        if (resource) { try { closed = await resource.close(); } catch { closed = false; } }
        const row = await this.repository.state(job.runId);
        if (!closed && row.provider_session_id && this.sessions) { try { closed = await this.sessions.reconcile(row.provider_session_id); } catch { closed = false; } }
        await this.repository.sessionState(job.runId, closed ? 'closed' : 'uncertain');
      }
      const row = await this.repository.state(job.runId);
      if (!terminal(row.status)) {
        if (row.status === 'cancelling' || this.stopping) result = { kind: 'cancelled', reason: this.stopping ? 'INTERRUPTED' : 'USER_REQUESTED',
          dispatchState: !drained || row.dispatch_state === 'sent' ? 'unknown' : row.dispatch_state,
          effectState: !drained || row.dispatch_state === 'sent' ? 'unknown' : row.effect_state };
        if (!closed && result?.kind !== 'cancelled') result = failure('SESSION_CLEANUP_UNCONFIRMED');
        await this.repository.finish(job.runId, result ?? failure('WORKER_FAILED'));
      }
    }
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
