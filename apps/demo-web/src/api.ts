import { z } from 'zod';
import { DemoAccountsSchema, DemoDetailsSchema, DemoMemberSchema, DemoOverviewSchema, DemoSearchSchema, DemoSessionSchema } from '@interface-ai/contracts';
export class PortalError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const errors: Record<string, string> = {
  STAFF_SESSION_EXPIRED: 'Staff session expired. Restore the training session to continue.',
  SERVICING_NOTICE_REQUIRED: 'Review and acknowledge the servicing notice before continuing.',
  MANUAL_REVIEW_REQUIRED: 'A servicing review requires your attention before opening account details.',
  MEMBER_SEARCH_VALIDATION: 'Member search validation error. Check the supplied member identifier.',
  INQUIRY_UNAVAILABLE: 'Account inquiry temporarily unavailable. Try again.',
  ACCESS_DENIED: 'Account access is restricted for this member and staff role.',
  MEMBER_CONTEXT_CHANGED: 'Member context changed. Start a new search.',
  STALE_SEARCH_RESULT: 'Search results changed. Search for the member again.',
  STAFF_SESSION_REQUIRED: 'Your staff session has ended. Reopen the workspace.',
  ACCOUNT_NOT_FOUND: 'Account not found for the active member.', MEMBER_NOT_FOUND: 'The selected member is no longer available.',
};
async function call<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal, body?: unknown) {
  const response = await fetch('/api/staff' + path, {
    credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const code = z.object({ error: z.object({ code: z.string() }) }).safeParse(data);
    const name = code.success ? code.data.error.code : 'UNAVAILABLE';
    throw new PortalError(name, errors[name] ?? 'Member services are temporarily unavailable. Try again.');
  }
  return schema.parse(data);
}
export const api = {
  acknowledge: () => call('/servicing/acknowledge',z.object({ok:z.literal(true)}),undefined,{}),
  dismissReview: () => call('/servicing/review/dismiss',z.object({ok:z.literal(true)}),undefined,{}),
  restore: () => call('/session/restore',z.object({ok:z.literal(true)}),undefined,{}),
  session: (signal?: AbortSignal) => call('/session', DemoSessionSchema, signal),
  reset: (signal?: AbortSignal) => call('/context/reset', z.object({ ok: z.literal(true) }), signal, {}),
  search: (memberId: string, signal?: AbortSignal) => call('/search', DemoSearchSchema, signal, { memberId }),
  select: (memberId: string, searchRevision: number, signal?: AbortSignal) => call('/selection', DemoMemberSchema, signal, { memberId, searchRevision }),
  overview: (memberId: string, signal?: AbortSignal) => call('/members/' + encodeURIComponent(memberId), DemoOverviewSchema, signal),
  accounts: (memberId: string, signal?: AbortSignal) => call('/members/' + encodeURIComponent(memberId) + '/accounts', DemoAccountsSchema, signal),
  details: (memberId: string, accountId: string, signal?: AbortSignal) => call('/members/' + encodeURIComponent(memberId) + '/accounts/' + encodeURIComponent(accountId), DemoDetailsSchema, signal),
};
let bootstrap: ReturnType<typeof api.session> | undefined;
export function bootstrapSession() {
  bootstrap ??= api.session().catch((error: unknown) => { bootstrap = undefined; throw error; });
  return bootstrap;
}
