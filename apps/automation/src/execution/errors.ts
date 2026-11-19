export const failureCodes = ['POLICY_BLOCKED', 'CONTROL_CHANGED', 'ACTION_IN_FLIGHT', 'TARGET_NOT_FOUND', 'AMBIGUOUS_TARGET',
  'TARGET_NOT_ACTIONABLE', 'UNSUPPORTED_SURFACE', 'STATE_TIMEOUT', 'BUDGET_EXHAUSTED', 'ACTION_OUTCOME_UNKNOWN',
  'READ_FAILED', 'INVALID_EXTRACTION', 'INVALID_BINDING', 'CANCELLED', 'SESSION_LOST', 'EVIDENCE_UNAVAILABLE'] as const;
export type FailureCode = typeof failureCodes[number];
export class ExecutionError extends Error {
  constructor(readonly code: FailureCode, readonly dispatchState: 'not_sent' | 'sent' | 'settled' | 'unknown' = 'not_sent',
    readonly effectState: 'not_checked' | 'confirmed' | 'not_applied' | 'unknown' = 'not_checked') { super(code); }
}
export function safeExecutionError(error: unknown, sent = false) {
  return error instanceof ExecutionError ? error : new ExecutionError(sent ? 'ACTION_OUTCOME_UNKNOWN' : 'READ_FAILED', sent ? 'unknown' : 'not_sent', sent ? 'unknown' : 'not_checked');
}
