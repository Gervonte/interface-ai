import { randomUUID } from 'node:crypto';
import { parseCapability, validateCapabilityResult, validateInvocation } from '@interface-ai/contracts';
import type { Capability, RunResult, Values } from '@interface-ai/contracts';
import type { StoredEventInput } from '../db/repository.js';
import { riskyControlNames } from '../db/repository.js';
import type { Configuration, WorkerContext } from './coordinator.js';
import { describeStepFailure, failureSummary } from './diagnostics.js';
import { ExecutionError, NeedsIntervention } from './errors.js';
import { EvidenceStore } from './evidence.js';
import { Executor } from './executor.js';
import { DispatchGate } from './gate.js';
import type { BrowserSurface } from './surface.js';
import { workflowWorker } from '../workflows/worker.js';

export interface LocalSurface { surface: BrowserSurface; close(): Promise<void> }
export interface LocalReplayOptions {
  configuration: Configuration;
  openSurface(): Promise<LocalSurface>;
  evidenceDirectory: string;
  signal?: AbortSignal;
}
export interface LocalReplayRecord {
  runId: string; mode: 'local-replay'; capability: { id: string; version: number }; inputNames: string[];
  binding: { targetId: string; targetVersion: number; entryPoint: string; recordedTargetVersions: number[] };
  result: RunResult; events: Array<StoredEventInput & { sequence: number }>; modelCalls: 0; inferenceAttempts: number; browserClosed: boolean;
}

/**
 * Replays a saved capability with the same worker, executor, rule engine and policy as the hosted path, against a
 * browser the caller opens (normally a local Chrome on a loopback target). There is no coordinator, database, hosted
 * browser or model: run records are returned to the caller instead of persisted, and inference is refused.
 */
export async function replayLocally(source: Capability, inputs: Values, options: LocalReplayOptions): Promise<LocalReplayRecord> {
  const artifact = parseCapability(source); validateInvocation(artifact, inputs);
  const { configuration } = options; const policy = configuration.policy;
  // A local binding is a different environment for the same application: the family must match, never the URL.
  if (artifact.surfaceRequirements.applicationFamily !== configuration.target.applicationFamily) throw new ExecutionError('UNSUPPORTED_SURFACE');
  const runId = randomUUID(); const events: LocalReplayRecord['events'] = []; let inferenceAttempts = 0;
  const record = async (event: StoredEventInput) => { events.push({ ...event, sequence: events.length + 1 }); return events.length; };
  const abort = new AbortController(); options.signal?.addEventListener('abort', () => abort.abort(), { once: true });
  const evidence = new EvidenceStore(options.evidenceDirectory);
  let executor: Executor | undefined; let opened: LocalSurface | undefined;
  const context: WorkerContext = { runId, signal: abort.signal, configuration, record,
    capability: async () => artifact,
    plan: async () => { inferenceAttempts++; throw new ExecutionError('INFERENCE_FORBIDDEN'); },
    publish: async () => { throw new ExecutionError('INFERENCE_FORBIDDEN'); },
    executor: async (targets, variables = {}) => {
      if (executor) throw new ExecutionError('CONTROL_CHANGED');
      opened = await options.openSurface();
      executor = new Executor({ runId, entryPoint: configuration.target.entryPoint, surface: opened.surface, gate: new DispatchGate(2), revision: 2, signal: abort.signal,
        policy: { ...policy, allowedClickNames: policy.allowedClickNames ?? [], allowedFillNames: policy.allowedFillNames ?? [], riskyControlNames: riskyControlNames(policy) },
        targets, inputs, variables, routes: { 'fresh-session': 'about:blank', 'target-entry': configuration.target.entryPoint },
        authorize: async () => { if (abort.signal.aborted) throw new ExecutionError('CANCELLED'); }, record, evidence });
      return executor;
    } };
  const reference = { id: artifact.capabilityId, version: artifact.version };
  let result: RunResult;
  try {
    await record({ type: 'RUN_STARTED', actor: 'system', stepId: null, details: { code: 'started' } });
    const output = await workflowWorker({ mode: 'replay', targetId: configuration.target.id, capability: reference, inputs }, context);
    if (!output) throw new ExecutionError('READ_FAILED');
    result = validateCapabilityResult(artifact, output);
    const applied = new Map<string, number>();
    for (const event of events) if (event.type === 'RECOVERY_STARTED' && event.details.ruleId) applied.set(event.details.ruleId, (applied.get(event.details.ruleId) ?? 0) + 1);
    if (applied.size && (result.kind === 'success' || result.kind === 'business_outcome'))
      result = { ...result, recoveries: [...applied].slice(0, 8).map(([ruleId, attempts]) => ({ ruleId, attempts: Math.min(10, attempts) })) };
  } catch (error) {
    // Local mode has no operator, so a requested intervention ends the run with its blocked context.
    if (error instanceof NeedsIntervention) result = { kind: 'failure', code: 'HUMAN_HELP_REQUIRED', blocked: error.blocked, summary: failureSummary('HUMAN_HELP_REQUIRED') + ' Local replay has no operator; use the hosted path for handoff.', evidenceIds: error.blocked.evidenceIds };
    else {
      const code = error instanceof ExecutionError ? error.code : 'WORKER_FAILED'; const last = executor?.lastFailure;
      result = { kind: 'failure', code, summary: failureSummary(code), blocked: null, evidenceIds: [] };
      if (last) result = { ...result, summary: (failureSummary(last.code) + ' Step: ' + last.stepId + '.').slice(0, 500), evidenceIds: last.evidenceIds,
        blocked: { stepId: last.stepId, actionIndex: null, ...describeStepFailure(last.code, last.ruleId), dispatchState: last.dispatchState, effectState: last.effectState, checkpointId: null, evidenceIds: last.evidenceIds } };
    }
  }
  let browserClosed = !opened;
  if (opened) { try { await opened.close(); browserClosed = true; } catch { browserClosed = false; } }
  await record({ type: result.kind === 'failure' ? 'RUN_FAILED' : 'RUN_COMPLETED', actor: 'system', stepId: null, details: { code: result.kind === 'failure' ? 'failed' : result.kind } });
  return { runId, mode: 'local-replay', capability: reference, inputNames: Object.keys(inputs), result, events, modelCalls: 0, inferenceAttempts, browserClosed,
    binding: { targetId: configuration.target.id, targetVersion: configuration.target.version, entryPoint: configuration.target.entryPoint, recordedTargetVersions: artifact.surfaceRequirements.compatibleTargetVersions } };
}
