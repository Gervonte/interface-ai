import type { z } from 'zod';
import type { BlockedContextSchema } from '@interface-ai/contracts';
export const failureCodes = ['STALE_OBSERVATION','POLICY_BLOCKED', 'CONTROL_CHANGED', 'ACTION_IN_FLIGHT', 'TARGET_NOT_FOUND', 'AMBIGUOUS_TARGET',
  'TARGET_NOT_ACTIONABLE', 'UNSUPPORTED_SURFACE', 'STATE_TIMEOUT', 'BUDGET_EXHAUSTED', 'ACTION_OUTCOME_UNKNOWN',
  'TARGET_VALIDATION_ERROR','IDENTITY_MISMATCH','CONFLICTING_SIGNALS','RECOVERY_EXHAUSTED','RECOVERY_FAILED','INVALID_OUTPUT_CONTRACT','UNSUPPORTED_GOAL', 'MODEL_UNAVAILABLE', 'MODEL_BUDGET_EXHAUSTED', 'ARTIFACT_INVALID', 'INFERENCE_FORBIDDEN', 'INTERVENTION_TIMEOUT', 'READ_FAILED', 'INVALID_EXTRACTION', 'INVALID_BINDING', 'CANCELLED', 'SESSION_LOST', 'EVIDENCE_UNAVAILABLE'] as const;
export type FailureCode = typeof failureCodes[number];
export class ExecutionError extends Error {
  constructor(readonly code: FailureCode, readonly dispatchState: 'not_sent' | 'sent' | 'settled' | 'unknown' = 'not_sent',
    readonly effectState: 'not_checked' | 'confirmed' | 'not_applied' | 'unknown' = 'not_checked') { super(code); }
}
export function safeExecutionError(error: unknown, sent = false) {
  if(error instanceof ExecutionError){
    // A lost transport cannot establish that an already-sent mutation was not applied.
    if(sent&&error.code==='SESSION_LOST')return new ExecutionError('SESSION_LOST','unknown','unknown');
    return error;
  }
  return new ExecutionError(sent ? 'ACTION_OUTCOME_UNKNOWN' : 'READ_FAILED', sent ? 'unknown' : 'not_sent', sent ? 'unknown' : 'not_checked');
}

export class NeedsIntervention extends Error {
  constructor(readonly blocked: z.infer<typeof BlockedContextSchema>) { super('HUMAN_HELP_REQUIRED'); }
}
