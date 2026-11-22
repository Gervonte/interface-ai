import { currentBalanceRequest } from '../examples/discovery-requests.js';
import { describe, expect, it } from 'vitest';
import { ActionProposalSchema, BlockedContextSchema, ClaimRequestSchema, DEFAULT_RUNTIME_BUDGETS, ManualActionRequestSchema, MutationMetadataSchema,
  RunAcceptedSchema, RunRequestSchema, RunResultSchema, RunViewSchema, RuntimeBudgetsSchema } from '@interface-ai/contracts';

const id = '11111111-1111-4111-8111-111111111111';
const capability = { id: 'lookup-primary-savings-balance', version: 1 };
const blocked = {
  stepId: 'open-primary-savings', actionIndex: null, reason: 'UNEXPECTED_DIALOG', dispatchState: 'not_sent', effectState: 'not_checked',
  checkpointId: 'account-inquiry', expected: { code: 'DETAILS_READY', description: 'Account Details for the requested member.' },
  observed: { code: 'BLOCKING_DIALOG', description: 'Unexpected servicing dialog.' }, evidenceIds: [id],
} as const;
describe('run request, result, and control contracts', () => {
  it('accepts distinct discovery/replay bodies while rejecting mixed fields and permission overrides', () => {
    expect(RunRequestSchema.parse({ mode: 'discovery', outputContract: currentBalanceRequest.outputContract, targetId: 'demo-credit-union', goal: 'Look up savings balance.', inputs: { memberId: 'M1001' } }).mode).toBe('discovery');
    const replay = { mode: 'replay', targetId: 'demo-credit-union', capability, inputs: { memberId: 'M1002' } };
    expect(RunRequestSchema.parse(replay).mode).toBe('replay');
    for (const invalid of [{ ...replay, goal: 'extra' }, { ...replay, capability: { id: capability.id, version: 'latest' } },
      { ...replay, policyOverride: 'allow-all' }, { ...replay, providerSessionId: id }, { ...replay, mode: 'unknown' }]) {
      expect(RunRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it('returns only an internal status URL tied to the accepted run', () => {
    expect(RunAcceptedSchema.parse({ runId: id, status: 'pending', statusUrl: `/v1/runs/${id}` }).runId).toBe(id);
    expect(() => RunAcceptedSchema.parse({ runId: id, status: 'pending', statusUrl: 'https://provider.example/secret' })).toThrow();
  });
  it('separates business outcomes, failures, cancellation, and explicitly non-retained outputs', () => {
    expect(RunResultSchema.parse({ kind: 'business_outcome', code: 'MEMBER_NOT_FOUND', summary: 'No matching member.', evidenceIds: [] }).kind).toBe('business_outcome');
    expect(RunResultSchema.parse({ kind: 'failure', code: 'STATE_TIMEOUT', blocked, summary: 'State deadline expired.', evidenceIds: [id] }).kind).toBe('failure');
    expect(RunResultSchema.parse({ kind: 'cancelled', reason: 'USER_REQUESTED', dispatchState: 'unknown', effectState: 'unknown' }).kind).toBe('cancelled');
    expect(RunResultSchema.parse({ kind: 'success', capability, output: { availability: 'not_retained', reason: 'OUTPUTS_NOT_RETAINED' } }).kind).toBe('success');
    expect(() => RunResultSchema.parse({ kind: 'success', capability })).toThrow();
  });
  it('rejects conflicting lifecycle, controller, result, and capability references', () => {
    const completed = { runId: id, mode: 'replay', target: { id: 'demo-credit-union', version: 1 }, policy: { id: 'demo-policy', version: 1 },
      status: 'completed', control: { owner: 'none', revision: 5 }, capability, currentStepId: null, activeInterventionId: null,
      result: { kind: 'success', capability, output: { availability: 'available', values: { memberId: 'M1001' } } },
      createdAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:01:00Z' };
    expect(RunViewSchema.parse(completed).status).toBe('completed');
    for (const invalid of [{ ...completed, result: null }, { ...completed, control: { owner: 'automation', revision: 5 } },
      { ...completed, status: 'running' }, { ...completed, activeInterventionId: id },
      { ...completed, capability: { ...capability, version: 2 } }, { ...completed, capability: null },
      { ...completed, updatedAt: '2026-11-17T09:00:00Z' }]) expect(RunViewSchema.safeParse(invalid).success).toBe(false);
  });
  it('keeps manual input scoped to an observed control and current revision, with identity supplied by the server', () => {
    expect(ManualActionRequestSchema.parse({ expectedControlRevision: 3, observationId: id, action: { type: 'fill', controlRef: 'member-field', value: 'M1001' } }).action.type).toBe('fill');
    expect(() => ManualActionRequestSchema.parse({ expectedControlRevision: 3, observationId: id, action: { type: 'evaluate', code: 'execute()' } })).toThrow();
    expect(() => ClaimRequestSchema.parse({ expectedControlRevision: 3, operatorId: 'client-claimed-admin' })).toThrow();
    expect(() => ActionProposalSchema.parse({ type: 'fill', observationId: id, controlRef: 'member-field', value: { kind: 'literal', value: 'M1001' } })).toThrow();
    expect(BlockedContextSchema.parse(blocked).dispatchState).toBe('not_sent');
    expect(MutationMetadataSchema.parse({ idempotencyKey: id }).idempotencyKey).toBe(id);
    expect(() => MutationMetadataSchema.parse({ idempotencyKey: 'invalid key\n' })).toThrow();
  });
});
describe('finite adjustable runtime budgets', () => {
  it('publishes bounded defaults with no implicit model allowance for replay', () => {
    expect(RuntimeBudgetsSchema.parse(DEFAULT_RUNTIME_BUDGETS).maxActions).toBe(100);
    expect(RuntimeBudgetsSchema.parse({ ...DEFAULT_RUNTIME_BUDGETS, maxModelCalls: 0 }).maxModelCalls).toBe(0);
    for (const invalid of [{ ...DEFAULT_RUNTIME_BUDGETS, maxActions: Infinity }, { ...DEFAULT_RUNTIME_BUDGETS, stepTimeoutMs: 0 },
      { ...DEFAULT_RUNTIME_BUDGETS, pollIntervalMs: 5000, stepTimeoutMs: 1000 }, { ...DEFAULT_RUNTIME_BUDGETS, overallTimeoutMs: 1000 }]) {
      expect(RuntimeBudgetsSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
