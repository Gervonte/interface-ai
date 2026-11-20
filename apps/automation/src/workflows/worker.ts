import { accountGuard, attachBalanceRules, balanceRules } from './rule-profile.js';
import type { RuleSet } from './rule-profile.js';
import { BusinessOutcome, RuleEngine } from './rules.js';
import { randomUUID } from 'node:crypto';
import { DataSchemaSchema, parseCapability, validateData, validateInvocation, validateOutput } from '@interface-ai/contracts';
import type { Capability, Predicate, Target, Values } from '@interface-ai/contracts';
import type { Worker, WorkerContext } from '../execution/coordinator.js';
import { ExecutionError, NeedsIntervention } from '../execution/errors.js';
import type { Executor, ExecutorOperation } from '../execution/executor.js';
import { balanceInputSchema, balanceOutputSchema, DecisionSchema, outputLabels } from './contracts.js';
import type { Observation } from './contracts.js';

const inputSchema = DataSchemaSchema.parse(balanceInputSchema);
const outputSchema = DataSchemaSchema.parse(balanceOutputSchema);
const visible = (target: string): Predicate => ({ kind: 'visible', target });
const sourceValue = (target: string, transform: 'trim' | 'savings-type' | 'usd-minor' = 'trim') => ({ target, read: 'text' as const, transform });
const same = (target: string, value: { kind: 'input' | 'variable'; name: string } | { kind: 'literal'; value: string }): Predicate => ({ kind: 'equals', source: sourceValue(target), value });
function problem(reason: 'MANUAL_PREREQUISITE' | 'POLICY_BLOCKED' | 'AMBIGUOUS_TARGET', stepId: string | null = null) {
  return new NeedsIntervention({ stepId, actionIndex: null, reason, dispatchState: 'not_sent', effectState: 'not_checked', checkpointId: null,
    expected: { code: 'SAFE_CONTINUATION', description: 'A current, permitted next action or verified completion.' },
    observed: { code: reason, description: 'Discovery could not establish a safe continuation.' }, evidenceIds: [] });
}
class Builder {
  readonly targets: Record<string, Target> = {};
  readonly steps: Capability['steps'] = [];
  readonly variables: Capability['variables'] = {};
  readonly values: Values = {};
  private registry = new Map<string, string>();
  private index = 0;
  readonly rules: RuleSet | undefined; runtime: RuleEngine | undefined;
  constructor(readonly context: WorkerContext) { this.rules=context.configuration.policy.allowedClickNames?.includes('Acknowledge notice')?balanceRules(this.targets):undefined; }
  id() { return 'step-' + String(++this.index).padStart(3, '0'); }
  target(value: Target) {
    const encoded = JSON.stringify(value); const previous = this.registry.get(encoded); if (previous) return previous;
    const id = 'target' + (this.registry.size + 1); this.registry.set(encoded, id); this.targets[id] = value; return id;
  }
  anchor(observation: Observation): Predicate {
    const heading = observation.headings.at(-1); if (!heading) throw problem('MANUAL_PREREQUISITE');
    const conditions = [visible(this.target(heading.target))];
    const row = observation.controls.find(control => control.target.within.some(scope => scope.kind === 'tableRow'));
    const table = row?.target.within.find(scope => scope.kind === 'tableRow');
    if (table?.kind === 'tableRow') conditions.push(visible(this.target({ scope: row!.target.scope, within: [], locator: { kind: 'caption', text: table.tableCaption, exact: true }, expectedMatches: 1 })));
    return conditions.length === 1 ? conditions[0]! : { kind: 'all', conditions };
  }
  async record(executor: Executor, operation: ExecutorOperation, before: Predicate, after: Predicate | (() => Promise<Predicate>), capture?: { variable: string; field: Capability['variables'][string] }) {
    const id = this.id(); const deadline=Date.now()+this.context.configuration.policy.budgets.stepTimeoutMs;const remaining=()=>Math.max(1,deadline-Date.now()); if(this.runtime && operation.type!=='navigate')await this.runtime.guard(before,id,remaining(),'not_sent');else await executor.assert(before, id + '-before'); const output = await executor.execute(operation, id,remaining()); const sequence = executor.lastEventSequence;
    if (!sequence) throw new ExecutionError('ARTIFACT_INVALID');
    if (capture) {
      this.variables[capture.variable] = capture.field;
      const values = validateData({ type: 'object', properties: { [capture.variable]: capture.field }, required: [capture.variable], additionalProperties: false }, { [capture.variable]: output });
      this.values[capture.variable] = values[capture.variable]!;
    }
    let postcondition = typeof after === 'function' ? await after() : after;
    if(this.runtime){await this.runtime.guard(postcondition,id,remaining());if(typeof after==='function')postcondition=await after();}else await executor.assert(postcondition, id + '-after');
    const base = { id, before, after: postcondition, timeoutMs: this.context.configuration.policy.budgets.stepTimeoutMs,
      outcomeRuleIds: [], recoveryRuleIds: [], source: { kind: 'discovery' as const, runId: this.context.runId, eventSequence: sequence } };
    if (operation.type === 'capture') {
      if (!capture) throw new ExecutionError('ARTIFACT_INVALID');
      this.steps.push({ ...base, ...operation, variable: capture.variable });
    } else this.steps.push({ ...base, ...operation });
    return output;
  }
}
function modelGoal(goal: string, inputs: Values) {
  let prepared = goal;
  for (const [name, value] of Object.entries(inputs)) if (typeof value === 'string' && value.length) prepared = prepared.replaceAll(value, '{{input.' + name + '}}');
  return prepared.replace(/(?:sk-|bb_live_|Bearer\s+)[A-Za-z0-9_-]{12,}/g, '[REDACTED]');
}
async function discover(request: Extract<Parameters<Worker>[0], { mode: 'discovery' }>, context: WorkerContext) {
  if (!/primary/i.test(request.goal) || !/savings/i.test(request.goal) || !/balance/i.test(request.goal)) throw new ExecutionError('UNSUPPORTED_GOAL');
  let inputs: Values; try { inputs = validateData(inputSchema, request.inputs); } catch { throw new ExecutionError('INVALID_BINDING'); }
  const builder = new Builder(context); const executor = await context.executor(builder.targets, builder.values);
  if(builder.rules)builder.runtime=new RuleEngine(builder.rules,executor,context,true);
  let observation: Observation | undefined;
  await builder.record(executor, { type: 'navigate', destination: 'target-entry' }, { kind: 'location', routeKey: 'fresh-session' }, async () => {
    observation = await executor.observe(); return builder.anchor(observation);
  });
  const initialCondition = builder.steps[0]!.after;
  const history: Array<{ action: string; label: string }> = [];
  let selectedAccount: string | undefined;
  for (let call = 0; call < context.configuration.policy.budgets.maxModelCalls; call++) {
    observation = await executor.observe();
    if(builder.runtime)await builder.runtime.guard(builder.anchor(observation),'discovery-state');
    const response = await context.plan({ goal: modelGoal(request.goal, inputs), inputNames: Object.keys(inputs), observation, history });
    const parsedDecision = DecisionSchema.safeParse(response); if (!parsedDecision.success) throw new ExecutionError('ARTIFACT_INVALID');
    const decision = parsedDecision.data;
    if (decision.observationId !== observation.observationId) throw problem('POLICY_BLOCKED');
    const current = await executor.observe();
    if (current.fingerprint !== observation.fingerprint) { await context.record({ type: 'MODEL_DECISION_STALE', actor: 'system', stepId: null, details: { code: 'state_changed' } }); continue; }
    if (decision.action === 'help') throw problem('MANUAL_PREREQUISITE');
    if (decision.action === 'finish') {
      if (!selectedAccount || decision.controlRef || decision.inputName) throw problem('POLICY_BLOCKED');
      const outputs: Capability['outputs'] = {};
      for (const [name, expectedLabel] of Object.entries(outputLabels)) {
        const ref = decision.outputs[name as keyof typeof outputLabels];
        const field = observation.fields.find(item => item.ref === ref);
        if (!field || field.label !== expectedLabel || field.region !== 'Account Details') throw problem('POLICY_BLOCKED');
        const target = builder.target(field.target);
        outputs[name] = sourceValue(target, name === 'accountType' ? 'savings-type' : name === 'currentBalanceMinor' ? 'usd-minor' : 'trim');
      }
      const designation = observation.fields.find(field => field.label === 'Designation' && field.region === 'Account Details');
      const status = observation.fields.find(field => field.label === 'Status' && field.region === 'Account Details');
      if (!designation || !status) throw problem('MANUAL_PREREQUISITE');
      const conditions: Predicate[] = [builder.anchor(observation), same(outputs.memberId!.target, { kind: 'input', name: 'memberId' }),
        same(outputs.accountId!.target, { kind: 'variable', name: selectedAccount }), same(builder.target(designation.target), { kind: 'literal', value: 'Primary' }),
        same(builder.target(status.target), { kind: 'literal', value: 'ACTIVE' })];
      await executor.assert({ kind: 'all', conditions }, 'verify-terminal');
      const values: Values = {};
      for (const [name, extraction] of Object.entries(outputs)) {
        values[name] = (await builder.record(executor, { type: 'capture', sourceValue: extraction }, visible(extraction.target), visible(extraction.target),
          { variable: 'output_' + name, field: outputSchema.properties[name]! }))!;
      }
      validateData(outputSchema, values);
      await executor.assert({ kind: 'all', conditions }, 'verify-captured-identity');
      if (values.memberId !== inputs.memberId || values.accountId !== builder.values[selectedAccount]) throw new ExecutionError('INVALID_EXTRACTION');
      let artifact = parseCapability({ schemaVersion: 1, capabilityId: 'balance-' + randomUUID().replaceAll('-', ''), version: 1,
        name: 'Primary savings current balance', description: 'Constructed from confirmed model-selected browser actions and verified UI reads.', sourceDiscoveryRunId: context.runId,
        surfaceRequirements: { kind: 'browser', applicationFamily: context.configuration.target.applicationFamily, compatibleTargetVersions: [context.configuration.target.version], features: ['frames', 'labels', 'roles', 'table-rows', 'dom-text'] },
        inputSchema, outputSchema, variables: builder.variables, targets: builder.targets, preconditions: { entryReady: initialCondition }, steps: builder.steps, outputs,
        successCondition: { conditions, identity: [{ target: outputs.memberId!.target, input: 'memberId' }] }, outcomeRules: [], recoveryRules: [], manualContributions: [] });
      if(builder.rules){artifact=attachBalanceRules(artifact);for(const rule of artifact.recoveryRules){const events=builder.rules.recoveryRules.find(item=>item.id===rule.id)?.source.observedEventSequences;if(events)rule.source.observedEventSequences=[...events];}artifact=parseCapability(artifact);}
      validateInvocation(artifact, inputs); validateOutput(artifact, values);
      await context.publish(artifact, values); return;
    }
    if (Object.values(decision.outputs).some(Boolean)) throw problem('POLICY_BLOCKED');
    const control = observation.controls.find(item => item.ref === decision.controlRef);
    if (!control || !control.enabled || control.kind !== decision.action) throw problem('POLICY_BLOCKED');
    if (decision.action === 'fill') {
      if (!(decision.inputName in inputs) || typeof inputs[decision.inputName] !== 'string') throw problem('POLICY_BLOCKED');
      const target = builder.target(control.target);
      await builder.record(executor, { type: 'fill', target, value: { kind: 'input', name: decision.inputName } }, { kind: 'editable', target },
        { kind: 'equals', source: { target, read: 'value', transform: 'identity' }, value: { kind: 'input', name: decision.inputName } });
    } else {
      if (decision.inputName) throw problem('POLICY_BLOCKED');
      let descriptor = control.target;
      if (control.accountIdTarget) {
        selectedAccount = 'selectedAccount' + (Object.keys(builder.variables).length + 1);
        const target = builder.target(control.accountIdTarget);
        await builder.record(executor, { type: 'capture', sourceValue: sourceValue(target) }, visible(target), visible(target),
          { variable: selectedAccount, field: { type: 'string', format: 'account-id', maxLength: 5 } });
        if(builder.rules)builder.rules.runtimeGuards!.push(accountGuard(selectedAccount));
        descriptor = { ...descriptor, within: descriptor.within.map(scope => scope.kind === 'tableRow' ? { ...scope, cells: [...scope.cells, { columnHeader: 'Account ID', equals: { kind: 'variable' as const, name: selectedAccount! } }] } : scope) };
      }
      const target = builder.target(descriptor);
      await builder.record(executor, { type: 'click', target }, { kind: 'enabled', target }, async () => builder.anchor(await executor.observe()));
    }
    history.push({ action: decision.action, label: control.label });
  }
  throw new ExecutionError('MODEL_BUDGET_EXHAUSTED');
}

async function replay(request: Extract<Parameters<Worker>[0], { mode: 'replay' }>, context: WorkerContext) {
  const artifact = parseCapability(await context.capability()); validateInvocation(artifact, request.inputs);
  if (artifact.manualContributions.length) throw problem('MANUAL_PREREQUISITE');
  if (artifact.steps[0]?.type !== 'navigate' || artifact.steps.slice(1).some(step => step.type === 'navigate')) throw new ExecutionError('ARTIFACT_INVALID');
  const variables: Values = {}; const executor = await context.executor(artifact.targets, variables);
  const runtime=new RuleEngine(artifact,executor,context);
  let first = true;
  for (const step of artifact.steps) {
    const deadline=Date.now()+Math.min(step.timeoutMs,context.configuration.policy.budgets.stepTimeoutMs);const remaining=()=>Math.max(1,deadline-Date.now());
    if (step.type === 'intervene') throw problem(step.reason === 'MANUAL_PREREQUISITE' ? 'MANUAL_PREREQUISITE' : 'POLICY_BLOCKED', step.id);
    if(step.type==='navigate')await executor.assert(step.before,step.id+'-before',remaining());else await runtime.guard(step.before,step.id,remaining(),'not_sent');
    const output = await executor.execute(step, step.id, remaining());
    if (step.type === 'capture') {
      if (Object.hasOwn(variables, step.variable)) throw new ExecutionError('ARTIFACT_INVALID');
      const field = artifact.variables[step.variable]; if (!field) throw new ExecutionError('ARTIFACT_INVALID');
      variables[step.variable] = validateData({ type: 'object', properties: { [step.variable]: field }, required: [step.variable], additionalProperties: false }, { [step.variable]: output })[step.variable]!;
    }
    await runtime.guard(step.after,step.id,remaining());
    if (first) { for (const condition of Object.values(artifact.preconditions)) await executor.assert(condition, 'initial-precondition'); first = false; }
  }
  await executor.assert({ kind: 'all', conditions: [...artifact.successCondition.conditions,
    ...artifact.successCondition.identity.map(check => same(check.target, { kind: 'input', name: check.input }))] }, 'verify-terminal');
  const outputs: Values = {};
  for (const [name, extraction] of Object.entries(artifact.outputs)) outputs[name] = (await executor.execute({ type: 'capture', sourceValue: extraction }, 'output-' + name))!;
  validateOutput(artifact, outputs);
  await executor.assert({kind:'all',conditions:artifact.successCondition.conditions}, 'verify-output-context');
  for (const identity of artifact.successCondition.identity) for (const [name, extraction] of Object.entries(artifact.outputs)) if (extraction.target === identity.target && outputs[name] !== request.inputs[identity.input]) throw new ExecutionError('INVALID_EXTRACTION');
  return { kind: 'success' as const, capability: request.capability, output: { availability: 'available' as const, values: outputs } };
}
export const workflowWorker: Worker = async (request, context) => {
  try { return await (request.mode === 'discovery' ? discover(request, context) : replay(request, context)); } catch (error) {
    if(error instanceof BusinessOutcome)return{kind:'business_outcome',code:error.code,summary:'A declared business outcome was verified in the live UI.',evidenceIds:[]};
    if (request.mode === 'discovery' && error instanceof ExecutionError && ['TARGET_NOT_FOUND','AMBIGUOUS_TARGET','STATE_TIMEOUT','TARGET_NOT_ACTIONABLE','MODEL_UNAVAILABLE','POLICY_BLOCKED'].includes(error.code)) { const intervention = problem(error.code === 'AMBIGUOUS_TARGET' ? 'AMBIGUOUS_TARGET' : error.code === 'POLICY_BLOCKED' ? 'POLICY_BLOCKED' : 'MANUAL_PREREQUISITE'); intervention.blocked.observed.code = error.code; throw intervention; }
    throw error;
  }
};
