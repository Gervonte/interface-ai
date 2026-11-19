import { setTimeout as delay } from 'node:timers/promises';
import { IdentifierSchema, TargetSchema } from '@interface-ai/contracts';
import type { Capability, Predicate, RuntimeBudgets, Target, Values } from '@interface-ai/contracts';
import type { StoredEventInput } from '../db/repository.js';
import type { BrowserSurface, SurfacePolicy, TargetState } from './surface.js';
import { resolveTarget } from './surface.js';
import { DispatchGate } from './gate.js';
import { ExecutionError, safeExecutionError } from './errors.js';
import type { EvidenceStore } from './evidence.js';

type Extraction = Capability['outputs'][string];
export type ExecutorOperation = { type: 'navigate'; destination: 'target-entry' } | { type: 'click'; target: string }
  | { type: 'fill'; target: string; value: { kind: 'input'; name: string } } | { type: 'wait'; condition: Predicate }
  | { type: 'capture'; sourceValue: Extraction };
export interface ExecutorOptions {
  runId: string; entryPoint: string; policy: SurfacePolicy & { allowedActions: readonly string[]; budgets: RuntimeBudgets };
  surface: BrowserSurface; gate: DispatchGate; signal: AbortSignal; revision: number; startedAt?: number;
  targets: Record<string, Target>; inputs: Values; variables?: Values; routes?: Record<string, string>;
  record(event: StoredEventInput): Promise<unknown>;
  authorize(): Promise<void>;
  evidence: EvidenceStore;
}
export function transform(value: string | boolean, name: Extraction['transform']) {
  if (name === 'identity') return value;
  if (typeof value !== 'string') throw new ExecutionError('INVALID_EXTRACTION');
  if (name === 'trim') return value.trim();
  if (name === 'savings-type') { if (!['Savings', 'Primary Savings'].includes(value)) throw new ExecutionError('INVALID_EXTRACTION'); return 'savings'; }
  let amount: bigint;
  if (name === 'integer') {
    if (!/^-?(0|[1-9]\d*)$/.test(value)) throw new ExecutionError('INVALID_EXTRACTION'); amount = BigInt(value);
  } else {
    if (!/^\$(?:0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)\.\d{2}$/.test(value)) throw new ExecutionError('INVALID_EXTRACTION');
    amount = BigInt(value.slice(1).replaceAll(',', '').replace('.', ''));
  }
  if (amount < BigInt(Number.MIN_SAFE_INTEGER) || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new ExecutionError('INVALID_EXTRACTION');
  return Number(amount);
}
export class Executor {
  private readonly startedAt: number;
  private admissions = 0;
  lastEventSequence: number | undefined;
  lastFailure: { stepId: string; code: string; evidenceIds: string[]; dispatchState: 'not_sent' | 'sent' | 'settled' | 'unknown'; effectState: 'not_checked' | 'confirmed' | 'not_applied' | 'unknown' } | undefined;
  lastState: { dispatchState: 'not_sent' | 'sent' | 'settled' | 'unknown'; effectState: 'not_checked' | 'confirmed' | 'not_applied' | 'unknown' } = { dispatchState: 'not_sent', effectState: 'not_checked' };
  constructor(private readonly options: ExecutorOptions) { this.startedAt = options.startedAt ?? Date.now(); }
  private check() {
    this.options.gate.check(this.options.revision);
    if (this.options.signal.aborted) throw new ExecutionError('CANCELLED');
    const budgets = this.options.policy.budgets;
    if (Date.now() - this.startedAt >= Math.min(budgets.activeTimeoutMs, budgets.overallTimeoutMs)) throw new ExecutionError('BUDGET_EXHAUSTED');
  }
  private locationsOnly(condition: Predicate): boolean { return condition.kind === 'location' || ((condition.kind === 'all' || condition.kind === 'any') && condition.conditions.every(child => this.locationsOnly(child))); }
  async assert(condition: Predicate, stepId: string, timeoutMs?: number) { await this.execute({ type: 'wait', condition }, stepId, timeoutMs); }
  async observe() {
    if (!this.options.surface.observe) throw new ExecutionError('UNSUPPORTED_SURFACE');
    if (++this.admissions > this.options.policy.budgets.maxActions) throw new ExecutionError('BUDGET_EXHAUSTED');
    return this.options.gate.dispatch(this.options.revision, async () => {
      const deadline = Date.now() + this.options.policy.budgets.stepTimeoutMs; let previous: string | undefined;
      while (true) {
        this.check(); await this.options.authorize(); await this.origin();
        const observation = await this.options.surface.observe!(this.options.inputs, this.options.policy);
        if (observation.ready && observation.fingerprint === previous) return observation;
        previous = observation.ready ? observation.fingerprint : undefined;
        if (Date.now() >= deadline) throw new ExecutionError('STATE_TIMEOUT');
        await delay(this.options.policy.budgets.pollIntervalMs, undefined, { signal: this.options.signal });
      }
    });
  }
  private async origin(navigation = false) {
    const location = await this.options.surface.location();
    if (navigation && location === 'about:blank') return;
    let origin: string; try { origin = new URL(location).origin; } catch { throw new ExecutionError('POLICY_BLOCKED'); }
    if (!this.options.policy.allowedOrigins.includes(origin)) throw new ExecutionError('POLICY_BLOCKED');
  }
  private definition(id: string) {
    const target = this.options.targets[IdentifierSchema.parse(id)];
    if (!target) throw new ExecutionError('INVALID_BINDING');
    try { return resolveTarget(TargetSchema.parse(target), this.options.inputs, this.options.variables ?? {}); }
    catch { throw new ExecutionError('INVALID_BINDING'); }
  }
  private async inspect(id: string) { return this.options.surface.inspect(this.definition(id), this.options.policy); }
  private unique(state: TargetState) {
    if (state.count !== 1) throw new ExecutionError(state.count ? 'AMBIGUOUS_TARGET' : 'TARGET_NOT_FOUND');
  }
  private async extract(source: Extraction) {
    const state = await this.inspect(source.target); this.unique(state);
    if (!state.visible || ['password', 'hidden', 'file'].includes(state.inputType)) throw new ExecutionError('POLICY_BLOCKED');
    if (source.read === 'checked' && state.inputType !== 'checkbox') throw new ExecutionError('INVALID_EXTRACTION');
    if (source.read === 'value' && !['input', 'textarea', 'select'].includes(state.tag)) throw new ExecutionError('INVALID_EXTRACTION');
    return transform(source.read === 'text' ? state.text : source.read === 'value' ? state.value : state.checked, source.transform);
  }
  private async predicate(condition: Predicate): Promise<boolean> {
    if (condition.kind === 'all' || condition.kind === 'any') {
      const results: boolean[] = [];
      // Evaluate every child. An evaluation error is never hidden by boolean short-circuiting.
      for (const child of condition.conditions) results.push(await this.predicate(child));
      return condition.kind === 'all' ? results.every(Boolean) : results.some(Boolean);
    }
    if (condition.kind === 'location') {
      const expected = this.options.routes?.[condition.routeKey]; if (!expected) throw new ExecutionError('INVALID_BINDING');
      return await this.options.surface.location() === expected;
    }
    if (condition.kind === 'equals') {
      const ref = condition.value; const value = ref.kind === 'literal' ? ref.value : (ref.kind === 'input' ? this.options.inputs : this.options.variables ?? {})[ref.name];
      if (value === undefined) throw new ExecutionError('INVALID_BINDING');
      return await this.extract(condition.source) === value;
    }
    if (!('target' in condition)) throw new ExecutionError('INVALID_BINDING');
    const state = await this.inspect(condition.target);
    if (state.count > 1) throw new ExecutionError('AMBIGUOUS_TARGET');
    if (condition.kind === 'absent') return state.count === 0;
    if (condition.kind === 'present') return state.count === 1;
    return state.count === 1 && (condition.kind === 'visible' ? state.visible : condition.kind === 'enabled' ? state.enabled : state.editable);
  }
  async execute(operation: ExecutorOperation, stepId: string, requestedTimeoutMs = this.options.policy.budgets.stepTimeoutMs) {
    IdentifierSchema.parse(stepId);
    if (!this.options.policy.allowedActions.includes(operation.type)) throw new ExecutionError('POLICY_BLOCKED');
    if (++this.admissions > this.options.policy.budgets.maxActions) throw new ExecutionError('BUDGET_EXHAUSTED');
    this.check();
    if (!Number.isFinite(requestedTimeoutMs) || requestedTimeoutMs < 1) throw new ExecutionError('BUDGET_EXHAUSTED');
    const budgets = this.options.policy.budgets;
    const timeout = Math.max(1, Math.min(requestedTimeoutMs, budgets.stepTimeoutMs, Math.min(budgets.activeTimeoutMs, budgets.overallTimeoutMs) - (Date.now() - this.startedAt)));
    let sent = false; let timer: ReturnType<typeof setTimeout> | undefined;
    this.lastState = { dispatchState: 'not_sent', effectState: 'not_checked' };
    const work = this.options.gate.dispatch(this.options.revision, async () => {
      this.check(); await this.options.authorize(); this.check(); await this.origin(operation.type === 'navigate' || (operation.type === 'wait' && this.locationsOnly(operation.condition)));
      await this.options.record({ type: 'ACTION_INTENT', actor: 'automation', stepId, details: { code: 'admitted', operation: operation.type, ...('target' in operation ? { targetRef: operation.target } : {}) } });
      this.check();
      let output: string | number | boolean | undefined;
      if (operation.type === 'click' || operation.type === 'fill') {
        const target = this.definition(operation.target); const state = await this.options.surface.inspect(target, this.options.policy); this.unique(state);
        if (!state.visible || !state.enabled || (operation.type === 'fill' && !state.editable)) throw new ExecutionError('TARGET_NOT_ACTIONABLE');
        if (!(operation.type === 'click' ? this.options.policy.allowedClickNames : this.options.policy.allowedFillNames).includes(state.name)) throw new ExecutionError('POLICY_BLOCKED');
        const value = operation.type === 'fill' ? this.options.inputs[operation.value.name] : undefined;
        if (operation.type === 'fill' && (typeof value !== 'string' || operation.value.kind !== 'input')) throw new ExecutionError('INVALID_BINDING');
        this.check(); await this.options.authorize(); this.check();
        // Persist the uncertainty boundary BEFORE crossing into the browser.
        await this.options.record({ type: 'ACTION_DISPATCHED', actor: 'automation', stepId, details: { code: 'dispatching', targetRef: operation.target } });
        this.check(); sent = true; this.lastState = { dispatchState: 'sent', effectState: 'not_checked' };
        await this.options.surface.dispatch(operation.type, target, this.options.policy, value as string | undefined);
        this.lastState = { dispatchState: 'settled', effectState: 'not_checked' };
        await this.origin();
      } else if (operation.type === 'navigate') {
        if (operation.destination !== 'target-entry' || !this.options.policy.allowedOrigins.includes(new URL(this.options.entryPoint).origin)) throw new ExecutionError('POLICY_BLOCKED');
        await this.options.record({ type: 'ACTION_DISPATCHED', actor: 'automation', stepId, details: { code: 'dispatching' } });
        this.check(); sent = true; this.lastState = { dispatchState: 'sent', effectState: 'not_checked' };
        await this.options.surface.navigate(this.options.entryPoint, timeout); await this.origin();
        this.lastState = { dispatchState: 'settled', effectState: 'not_checked' };
      } else if (operation.type === 'capture') output = await this.extract(operation.sourceValue);
      else {
        const deadline = Date.now() + timeout;
        while (!await this.predicate(operation.condition)) {
          this.check(); await this.options.authorize(); await this.origin();
          if (Date.now() >= deadline) throw new ExecutionError('STATE_TIMEOUT');
          await delay(Math.min(budgets.pollIntervalMs, Math.max(1, deadline - Date.now())), undefined, { signal: this.options.signal });
        }
      }
      this.check();
      const sequence = await this.options.record({ type: operation.type === 'capture' ? 'READ_COMPLETED' : 'ACTION_COMPLETED', actor: 'automation', stepId, details: { code: 'confirmed', operation: operation.type, ...('target' in operation ? { targetRef: operation.target } : {}) } });
      this.lastEventSequence = typeof sequence === 'number' && Number.isInteger(sequence) && sequence > 0 ? sequence : undefined;
      return output;
    });
    const aborted = new Promise<never>((_resolve, reject) => {
      const stop = () => reject(new ExecutionError(sent ? 'ACTION_OUTCOME_UNKNOWN' : 'CANCELLED', sent ? 'unknown' : 'not_sent', sent ? 'unknown' : 'not_checked'));
      this.options.signal.addEventListener('abort', stop, { once: true });
      work.finally(() => this.options.signal.removeEventListener('abort', stop)).catch(() => {});
    });
    try {
      return await Promise.race([work, aborted, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ExecutionError(sent ? 'ACTION_OUTCOME_UNKNOWN' : 'STATE_TIMEOUT', sent ? 'unknown' : 'not_sent', sent ? 'unknown' : 'not_checked')), timeout); })]);
    } catch (error) {
      const failure = safeExecutionError(error, sent); this.lastState = { dispatchState: failure.dispatchState, effectState: failure.effectState };
      // Even a timed-out READ keeps the gate occupied until its real promise settles.
      this.options.gate.close();
      let evidenceId: string | undefined;
      try { evidenceId = await Promise.race([this.options.evidence.capture(this.options.runId, stepId, this.options.surface, this.options.policy), delay(2000).then(() => undefined)]); } catch { /* Fail closed: never persist raw capture/error data. */ }
      this.lastFailure = { stepId, code: failure.code, evidenceIds: evidenceId ? [evidenceId] : [], dispatchState: failure.dispatchState, effectState: failure.effectState };
      await this.options.record({ type: 'ACTION_FAILED', actor: 'automation', stepId, details: { code: failure.code, dispatchState: failure.dispatchState, effectState: failure.effectState,
        ...(evidenceId ? { evidenceId } : {}) } }).catch(() => {});
      throw failure;
    } finally { clearTimeout(timer); }
  }
}
