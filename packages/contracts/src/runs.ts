import { OutputContractSchema } from './discovery.js';
import { z } from 'zod';
import { BoundedJsonSchema, IdentifierSchema as Id, ValuesSchema } from './data.js';
import { parseCapability, validateInvocation, validateOutput } from './capability.js';
import type { Capability } from './capability.js';

const version = z.number().int().positive();
const revision = z.number().int().positive();
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
export const VersionReferenceSchema = z.strictObject({ id: Id, version });
export const RunRequestSchema = BoundedJsonSchema.pipe(z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('discovery'), targetId: Id, goal: z.string().trim().min(1).max(4000), outputContract: OutputContractSchema, inputs: ValuesSchema }),
  z.strictObject({ mode: z.literal('replay'), targetId: Id, capability: VersionReferenceSchema, inputs: ValuesSchema }),
]));
export type RunRequest = z.infer<typeof RunRequestSchema>;
export const RunAcceptedSchema = z.strictObject({ runId: z.uuid(), status: z.literal('pending'), statusUrl: z.string(), operationUrl: z.string().optional() })
  .refine((value) => value.statusUrl === `/v1/runs/${value.runId}` && (!value.operationUrl || (value.operationUrl.startsWith(`/v1/runs/${value.runId}/operations/`) && z.uuid().safeParse(value.operationUrl.split('/').at(-1)).success)), 'URLs must refer to the accepted run.');
export const ControlSchema = z.discriminatedUnion('owner', [
  z.strictObject({ owner: z.literal('none'), revision }),
  z.strictObject({ owner: z.literal('automation'), revision }),
  z.strictObject({ owner: z.literal('human'), revision, operatorId: Id }),
]);
export const ClaimRequestSchema = z.strictObject({ expectedControlRevision: revision });
export const ResumeRequestSchema = z.strictObject({ expectedControlRevision: revision, resolutionNote: z.string().max(1000).optional() });
export const CancelRequestSchema = z.strictObject({ reason: z.literal('USER_REQUESTED') });
// Parsed from the Idempotency-Key header by the later HTTP adapter, not a permission override.
export const MutationMetadataSchema = z.strictObject({ idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/) });
const observedBase = { observationId: z.uuid(), controlRef: Id };
export const ActionProposalSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...observedBase, type: z.literal('click') }),
  z.strictObject({ ...observedBase, type: z.literal('fill'), value: z.strictObject({ kind: z.literal('input'), name: Id }) }),
]);
export const ManualActionRequestSchema = z.strictObject({
  expectedControlRevision: revision, observationId: z.uuid(),
  action: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('click'), controlRef: Id }),
    z.strictObject({ type: z.literal('fill'), controlRef: Id, value: z.string().max(4096) }),
    z.strictObject({ type: z.literal('navigate'), destination: z.literal('target-entry') }),
  ]),
});
export const DispatchStateSchema = z.enum(['not_sent', 'sent', 'settled', 'unknown']);
export const EffectStateSchema = z.enum(['not_checked', 'confirmed', 'not_applied', 'unknown']);
const summary = z.strictObject({ code, description: z.string().max(500) });
export const BlockedContextSchema = z.strictObject({
  stepId: Id.nullable(), actionIndex: z.number().int().min(0).nullable(), reason: z.enum(['UNEXPECTED_DIALOG', 'SESSION_EXPIRED', 'TARGET_NOT_FOUND', 'AMBIGUOUS_TARGET',
    'STATE_TIMEOUT', 'ACTION_OUTCOME_UNKNOWN', 'MANUAL_PREREQUISITE', 'SESSION_LOST', 'POLICY_BLOCKED']),
  dispatchState: DispatchStateSchema, effectState: EffectStateSchema, checkpointId: Id.nullable(),
  expected: summary, observed: summary, evidenceIds: z.array(z.uuid()).max(16),
});
export const InterventionSchema = z.strictObject({
  interventionId: z.uuid(), runId: z.uuid(), status: z.enum(['open', 'claimed', 'validating', 'resolved', 'closed']),
  controlRevision: revision, sessionRef: z.uuid(), blocked: BlockedContextSchema,
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
}).refine((value) => Date.parse(value.expiresAt) > Date.parse(value.createdAt), 'Intervention deadline must follow creation.');
const output = z.discriminatedUnion('availability', [
  z.strictObject({ availability: z.literal('available'), values: ValuesSchema }),
  z.strictObject({ availability: z.literal('not_retained'), reason: z.literal('OUTPUTS_NOT_RETAINED') }),
]);
export const RunResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('success'), capability: VersionReferenceSchema, output }),
  z.strictObject({ kind: z.literal('business_outcome'), code, summary: z.string().max(500), evidenceIds: z.array(z.uuid()).max(16) }),
  z.strictObject({ kind: z.literal('failure'), code, blocked: BlockedContextSchema.nullable(), summary: z.string().max(500), evidenceIds: z.array(z.uuid()).max(16) }),
  z.strictObject({ kind: z.literal('cancelled'), reason: z.enum(['USER_REQUESTED', 'INTERRUPTED']), dispatchState: DispatchStateSchema, effectState: EffectStateSchema }),
]);
export type RunResult = z.infer<typeof RunResultSchema>;
export const RunViewSchema = z.strictObject({
  runId: z.uuid(), mode: z.enum(['discovery', 'replay']), target: VersionReferenceSchema, policy: VersionReferenceSchema,
  status: z.enum(['pending', 'running', 'pausing', 'waiting_for_human', 'human_controlled', 'validating_resume', 'cancelling', 'completed', 'failed', 'cancelled']),
  control: ControlSchema, capability: VersionReferenceSchema.nullable(), currentStepId: Id.nullable(),
  activeInterventionId: z.uuid().nullable(), result: RunResultSchema.nullable(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).superRefine((run, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const terminal = ['completed', 'failed', 'cancelled'].includes(run.status);
  if (terminal !== (run.result !== null)) issue('Terminal state and result must agree.');
  if (run.status === 'completed' && run.result?.kind !== 'success' && run.result?.kind !== 'business_outcome') issue('Completed run requires success or business outcome.');
  if (run.status === 'failed' && run.result?.kind !== 'failure') issue('Failed run requires failure result.');
  if (run.status === 'cancelled' && run.result?.kind !== 'cancelled') issue('Cancelled run requires cancelled result.');
  const expectedOwner = run.status === 'running' ? 'automation' : run.status === 'human_controlled' ? 'human' : 'none';
  if (run.control.owner !== expectedOwner) issue('Controller does not match lifecycle.');
  if (['waiting_for_human', 'human_controlled', 'validating_resume'].includes(run.status) && !run.activeInterventionId) issue('Paused run requires an intervention.');
  if (terminal && run.activeInterventionId) issue('Terminal run cannot expose an active intervention.');
  if (run.mode === 'replay' && !run.capability) issue('Replay requires an exact capability version.');
  if (run.result?.kind === 'success' && (!run.capability || run.capability.id !== run.result.capability.id
    || run.capability.version !== run.result.capability.version)) issue('Successful result must identify the saved/executed capability.');
  if (Date.parse(run.updatedAt) < Date.parse(run.createdAt)) issue('Run timestamps are out of order.');
});
export type RunView = z.infer<typeof RunViewSchema>;

export function validateReplayRequest(capability: Capability, value: unknown) {
  const artifact = parseCapability(capability);
  const request = RunRequestSchema.parse(value);
  if (request.mode !== 'replay' || request.capability.id !== artifact.capabilityId || request.capability.version !== artifact.version) {
    throw new Error('Replay request must identify the exact capability version.');
  }
  validateInvocation(artifact, request.inputs);
  return request;
}
export function validateCapabilityResult(capability: Capability, value: unknown) {
  const artifact = parseCapability(capability);
  const result = RunResultSchema.parse(value);
  if (result.kind === 'success') {
    if (result.capability.id !== artifact.capabilityId || result.capability.version !== artifact.version) {
      throw new Error('Result must identify the exact capability version.');
    }
    if (result.output.availability === 'available') validateOutput(artifact, result.output.values);
  }
  if (result.kind === 'business_outcome' && !artifact.outcomeRules.some((rule) => rule.code === result.code)) {
    throw new Error('Business outcome is not declared by this capability.');
  }
  return result;
}
