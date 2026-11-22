import type { z } from 'zod';
import type { BlockedContextSchema } from '@interface-ai/contracts';
import { ExecutionError } from './errors.js';

type Blocked = z.infer<typeof BlockedContextSchema>;
type Summary = Blocked['expected'];

// Provider-side reasons a session was definitively not created. Metadata only; no raw provider text is retained.
export const startCategories = ['provider_auth', 'provider_usage_limit', 'provider_rate_or_concurrency_limit', 'provider_rejected', 'provider_unreachable'] as const;
export type StartCategory = typeof startCategories[number];
const categoryText: Record<StartCategory, string> = {
  provider_auth: 'authentication or project permission',
  provider_usage_limit: 'usage or plan limit',
  provider_rate_or_concurrency_limit: 'rate or concurrency limit',
  provider_rejected: 'request rejected',
  provider_unreachable: 'provider unreachable before session creation',
};
const categoryFor = (status: number): StartCategory => status === 401 || status === 403 ? 'provider_auth' : status === 402 ? 'provider_usage_limit'
  : status === 429 ? 'provider_rate_or_concurrency_limit' : 'provider_rejected';

/** What the transport saw while starting a session. Metadata only: methods, paths and statuses, never bodies. */
export interface StartObservation { createSent: boolean; createStatus?: number | undefined; lastErrorStatus?: number | undefined }
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
/**
 * Observes the provider requests made while starting a session. Stagehand 4.4 replaces the SDK error with a generic
 * message and no status, and uploads its extension before creating the session, so both must be seen at the transport.
 */
export function sessionCreateRecorder(base: Fetch) {
  const seen: StartObservation = { createSent: false };
  const observed: Fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const create = method === 'POST' && new URL(url).pathname.replace(/\/$/, '') === '/v1/sessions';
    if (create) seen.createSent = true; // Marked before sending: from here on a session may exist.
    const response = await base(input, init);
    if (create) seen.createStatus = response.status;
    if (response.status >= 400) seen.lastErrorStatus = response.status;
    return response;
  };
  return { fetch: observed, observation: (): StartObservation => ({ ...seen }) };
}

/**
 * Classify a session-start error without retaining its message. No session can exist if the create request was never
 * sent, or if it was answered with 4xx. A created session (2xx) whose connection later failed, a create request with no
 * response, or a 5xx stays uncertain.
 */
export function sessionStartError(error: unknown, observation?: StartObservation): ExecutionError {
  if (error instanceof ExecutionError) return error;
  const notCreated = (category: StartCategory) => new ExecutionError('SESSION_NOT_CREATED', 'not_sent', 'not_checked', category);
  if (observation) {
    if (!observation.createSent) {
      const status = observation.lastErrorStatus;
      return notCreated(status !== undefined && status >= 400 && status < 500 ? categoryFor(status) : status !== undefined ? 'provider_rejected' : 'provider_unreachable');
    }
    const status = observation.createStatus;
    if (status !== undefined && status >= 400 && status < 500) return notCreated(categoryFor(status));
    return new ExecutionError('SESSION_START_UNCERTAIN');
  }
  // Direct SDK errors carry their HTTP status.
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : NaN;
  if (Number.isInteger(status) && status >= 400 && status < 500) return notCreated(categoryFor(status));
  // Timeouts, transport errors, and 5xx responses cannot prove that the provider did not create a session.
  return new ExecutionError('SESSION_START_UNCERTAIN');
}

const summaries: Record<string, string> = {
  SESSION_NOT_CREATED: 'The browser provider refused to create a session. No session was created and no model call or UI action ran.',
  SESSION_START_UNCERTAIN: 'Browser session creation did not complete; the provider may have created a session. No UI action ran. Reconcile before retrying.',
  SESSION_CLEANUP_UNCONFIRMED: 'The run ended but closure of its browser session could not be confirmed. Reconcile before starting another run.',
  SESSION_LOST: 'The browser session was lost during execution.',
  POLICY_BLOCKED: 'An operation was blocked by the configured policy before dispatch.',
  RISKY_ACTION_BLOCKED: 'A control classified as risky or irreversible was blocked before dispatch.',
  IDENTITY_MISMATCH: 'The displayed member or account identity did not match the requested record. No later step ran.',
  RECOVERY_EXHAUSTED: 'A declared recovery was attempted but did not restore the expected UI condition.',
  CONFLICTING_SIGNALS: 'The UI matched more than one declared outcome or recovery, so the run stopped rather than guess.',
  STATE_TIMEOUT: 'A recorded UI condition was not confirmed within the step timeout.',
  TARGET_NOT_FOUND: 'No permitted target matched a recorded step.',
  AMBIGUOUS_TARGET: 'More than one target matched a recorded step.',
  TARGET_NOT_ACTIONABLE: 'The recorded target was present but not visible, enabled, or editable.',
  ACTION_OUTCOME_UNKNOWN: 'An action was sent but its effect could not be confirmed.',
  BUDGET_EXHAUSTED: 'A configured action, time, or step budget was exhausted.',
  MODEL_UNAVAILABLE: 'The discovery model was unavailable or returned an unusable response.',
  MODEL_BUDGET_EXHAUSTED: 'The discovery model-call budget was exhausted before the goal was met.',
  UNSUPPORTED_GOAL: 'The planner reported that the goal or requested outputs cannot be supported safely.',
  INVALID_OUTPUT_CONTRACT: 'The requested output contract is invalid or unsupported.',
  INVALID_BINDING: 'An input binding is missing or invalid.',
  INVALID_EXTRACTION: 'A read UI value could not be converted to its declared type.',
  ARTIFACT_INVALID: 'The capability or a model proposal failed validation.',
  INFERENCE_FORBIDDEN: 'Replay attempted model inference, which is forbidden.',
  INTERVENTION_TIMEOUT: 'Human help was requested but not completed before its deadline.',
  HUMAN_HELP_REQUIRED: 'The run stopped and requires human help.',
  READ_FAILED: 'A UI read failed before any action was sent.',
  EVIDENCE_UNAVAILABLE: 'Richer evidence could not be captured safely and was suppressed.',
  UNSUPPORTED_SURFACE: 'The browser surface does not support a required operation.',
};

export function failureSummary(code: string, category?: string) {
  const base = summaries[code] ?? 'Execution stopped (' + code + '). Inspect the sanitized run events for context.';
  if (code !== 'SESSION_NOT_CREATED' || !category || !(category in categoryText)) return base;
  if (category === 'provider_unreachable') return 'The browser provider could not be reached before session creation. No session was created and no model call or UI action ran.';
  return base.replace('refused to create a session.', 'refused to create a session (' + categoryText[category as StartCategory] + ').');
}

const rule = (ruleId: string | undefined) => ruleId ? ' Rule: ' + ruleId + '.' : '';
/** Describe the failed step condition specifically, from codes and authored rule IDs only — never record values. */
export function describeStepFailure(code: string, ruleId?: string): Pick<Blocked, 'reason' | 'expected' | 'observed'> {
  const pick = (reason: Blocked['reason'], expected: Summary, observed: Summary) => ({ reason, expected, observed: { ...observed, description: (observed.description + rule(ruleId)).slice(0, 500) } });
  switch (code) {
    case 'IDENTITY_MISMATCH': return pick('IDENTITY_MISMATCH', { code: 'RECORD_IDENTITY_MATCH', description: 'The displayed member/account identity must equal the bound input or the account captured from the selected row.' },
      { code, description: 'A different member or account identity was displayed.' });
    case 'RECOVERY_EXHAUSTED': return pick('RECOVERY_EXHAUSTED', { code: 'DECLARED_RECOVERY_VERIFIED', description: 'A declared recovery must restore the recorded UI condition within its attempt and time limits.' },
      { code, description: 'Recovery attempts ended without restoring the recorded UI condition.' });
    case 'CONFLICTING_SIGNALS': return pick('CONFLICTING_SIGNALS', { code: 'SINGLE_CLASSIFICATION', description: 'At most one declared outcome or recovery may match the live UI.' },
      { code, description: 'More than one declared outcome or recovery matched.' });
    case 'STATE_TIMEOUT': return pick('STATE_TIMEOUT', { code: 'RECORDED_UI_CONDITION', description: 'The step\'s recorded UI condition must hold within the step timeout.' },
      { code, description: 'The recorded UI condition was not confirmed before the step timeout.' });
    case 'TARGET_NOT_FOUND': return pick('TARGET_NOT_FOUND', { code: 'UNIQUE_TARGET', description: 'Exactly one permitted target must match the recorded locator.' },
      { code, description: 'No target matched the recorded locator.' });
    case 'AMBIGUOUS_TARGET': return pick('AMBIGUOUS_TARGET', { code: 'UNIQUE_TARGET', description: 'Exactly one permitted target must match the recorded locator.' },
      { code, description: 'More than one target matched the recorded locator.' });
    case 'TARGET_NOT_ACTIONABLE': return pick('STEP_FAILED', { code: 'ACTIONABLE_TARGET', description: 'The matched target must be visible and enabled (or editable for fills).' },
      { code, description: 'The matched target was not actionable.' });
    case 'POLICY_BLOCKED': return pick('POLICY_BLOCKED', { code: 'POLICY_PERMITTED', description: 'The operation, control name, and origin must be permitted by the configured policy.' },
      { code, description: 'The policy did not permit the requested operation.' });
    case 'RISKY_ACTION_BLOCKED': return pick('POLICY_BLOCKED', { code: 'REVERSIBLE_ACTION', description: 'Only controls not classified as risky or irreversible may be dispatched under the baseline policy.' },
      { code, description: 'The control is classified as risky; nothing was dispatched.' });
    case 'ACTION_OUTCOME_UNKNOWN': return pick('ACTION_OUTCOME_UNKNOWN', { code: 'CONFIRMED_EFFECT', description: 'A sent action\'s effect must be confirmed by its recorded UI condition.' },
      { code, description: 'The action was sent but its effect is unknown.' });
    case 'SESSION_LOST': return pick('SESSION_LOST', { code: 'LIVE_SESSION', description: 'The browser session must remain available for the step.' },
      { code, description: 'The browser session was lost during the step.' });
    default: return pick('STEP_FAILED', { code: 'STEP_COMPLETED', description: 'The step must complete without error.' },
      { code, description: 'The step stopped with this error code.' });
  }
}
