import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DemoAccountIdSchema, DemoAccountSchema, DemoAccountsSchema, DemoDetailsSchema, DemoMemberIdSchema, DemoMemberSchema,
  DemoOverviewSchema, DemoSearchSchema, DemoSessionSchema } from '@interface-ai/contracts';
import type { DemoRepository } from './db/repository.js';

export type MemberStore = Pick<DemoRepository, 'findMember' | 'listAccounts'>;
type MemberRow = NonNullable<Awaited<ReturnType<MemberStore['findMember']>>>;
type AccountRow = NonNullable<Awaited<ReturnType<MemberStore['listAccounts']>>>[number];
const memberDto = (row: MemberRow) => DemoMemberSchema.parse({ id: row.member_id, name: row.display_name, status: row.status, accountAccess: row.account_access ? 'allowed' : 'denied' });
const accountDto = (row: AccountRow) => DemoAccountSchema.parse({ id: row.account_id, memberId: row.member_id, type: row.account_type,
  isPrimary: row.is_primary, status: row.status, currentBalanceMinor: row.current_balance_minor, availableBalanceMinor: row.available_balance_minor, currency: row.currency });
interface StaffSession { expiresAt: number; epoch: number; active: string | null; search: { memberId: string; found: boolean; revision: number } | null }
const operator = { id: 'STF-104', name: 'Alex Chen', branch: 'Training Branch', role: 'Member Services' };
function reject(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ error: { code, message } });
}

export function createStaffRouter(repository: MemberStore | undefined, sessionTtlMs = 3_600_000) {
  const router = express.Router();
  const sessions = new Map<string, StaffSession>();
  function session(request: Request) {
    const id = (request.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('demo_staff='))?.slice('demo_staff='.length);
    if (!id || !z.uuid().safeParse(id).success) return undefined;
    const value = sessions.get(id);
    if (value && value.expiresAt > Date.now()) return value;
    sessions.delete(id); return undefined;
  }
  function required(request: Request, response: Response): StaffSession | undefined {
    const value = session(request);
    if (!value) reject(response, 401, 'STAFF_SESSION_REQUIRED', 'Your staff session has ended. Reopen the workspace.');
    return value;
  }
  function current(value: StaffSession, epoch: number, response: Response, memberId?: string) {
    if (value.epoch === epoch && (!memberId || value.active === memberId)) return true;
    reject(response, 409, 'MEMBER_CONTEXT_CHANGED', 'Member context changed. Start a new search.'); return false;
  }
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  router.use((request, response, next) => {
    if (!repository) { reject(response, 503, 'MEMBER_SERVICES_UNAVAILABLE', 'Member services are temporarily unavailable.'); return; }
    if (request.method === 'POST' && request.headers.origin !== `${request.protocol}://${request.headers.host}`) {
      reject(response, 403, 'INVALID_ORIGIN', 'Open the staff workspace to continue.'); return;
    }
    next();
  });
  router.get('/session', async (request, response) => {
    let value = session(request);
    if (!value) {
      for (const [id, item] of sessions) if (item.expiresAt <= Date.now()) sessions.delete(id);
      if (sessions.size >= 100) { reject(response, 503, 'SESSION_CAPACITY_REACHED', 'Staff services are busy. Try again shortly.'); return; }
      const id = randomUUID(); value = { expiresAt: Date.now() + sessionTtlMs, epoch: 0, active: null, search: null }; sessions.set(id, value);
      response.cookie('demo_staff', id, { httpOnly: true, sameSite: 'lax', secure: request.secure, path: '/', maxAge: sessionTtlMs });
    }
    const epoch = value.epoch;
    const member = value.active ? await repository!.findMember(value.active) : null;
    if (!current(value, epoch, response)) return;
    if (value.active && !member) { value.active = null; value.search = null; value.epoch++; }
    response.json(DemoSessionSchema.parse({ operator, status: 'active', contextRevision: value.epoch, activeMember: member ? memberDto(member) : null }));
  });
  router.post('/context/reset', (request, response) => {
    const value = required(request, response); if (!value) return;
    if (!z.strictObject({}).safeParse(request.body).success) { reject(response, 400, 'INVALID_REQUEST', 'Invalid staff request.'); return; }
    value.epoch++; value.active = null; value.search = null; response.json({ ok: true });
  });
  router.post('/search', async (request, response) => {
    const value = required(request, response); if (!value) return;
    value.epoch++; value.active = null; value.search = null; const epoch = value.epoch;
    const input = z.strictObject({ memberId: DemoMemberIdSchema }).safeParse(request.body);
    if (!input.success) { reject(response, 400, 'INVALID_MEMBER_ID', 'Enter a member ID in the format M1234.'); return; }
    const member = await repository!.findMember(input.data.memberId);
    if (!current(value, epoch, response)) return;
    value.search = { memberId: input.data.memberId, found: member !== null, revision: epoch };
    response.json(DemoSearchSchema.parse({ memberId: input.data.memberId, member: member ? memberDto(member) : null, searchRevision: epoch }));
  });
  router.post('/selection', async (request, response) => {
    const value = required(request, response); if (!value) return;
    const input = z.strictObject({ memberId: DemoMemberIdSchema, searchRevision: z.number().int().positive() }).safeParse(request.body);
    if (!input.success) { reject(response, 400, 'INVALID_REQUEST', 'Invalid member selection.'); return; }
    const epoch = value.epoch;
    if (!value.search?.found || value.search.revision !== input.data.searchRevision || epoch !== input.data.searchRevision || value.search.memberId !== input.data.memberId) {
      reject(response, 409, 'STALE_SEARCH_RESULT', 'Search results changed. Search for the member again.'); return;
    }
    const member = await repository!.findMember(input.data.memberId);
    if (!current(value, epoch, response)) return;
    if (!member) { reject(response, 404, 'MEMBER_NOT_FOUND', 'The selected member is no longer available.'); return; }
    value.active = member.member_id; response.json(DemoMemberSchema.parse(memberDto(member)));
  });
  function memberRoute(handler: (request: Request, response: Response, value: StaffSession, epoch: number, member: MemberRow) => Promise<void>) {
    return async (request: Request, response: Response, _next: NextFunction) => {
      const value = required(request, response); if (!value) return;
      const id = DemoMemberIdSchema.safeParse(request.params.memberId);
      if (!id.success) { reject(response, 400, 'INVALID_MEMBER_ID', 'Enter a member ID in the format M1234.'); return; }
      const epoch = value.epoch;
      if (!current(value, epoch, response, id.data)) return;
      const member = await repository!.findMember(id.data);
      if (!current(value, epoch, response, id.data)) return;
      if (!member) { reject(response, 404, 'MEMBER_NOT_FOUND', 'The selected member is no longer available.'); return; }
      await handler(request, response, value, epoch, member);
    };
  }
  router.get('/members/:memberId', memberRoute(async (_request, response, value, epoch, member) => {
    const accounts = member.account_access ? await repository!.listAccounts(member.member_id) : null;
    if (!current(value, epoch, response, member.member_id)) return;
    response.json(DemoOverviewSchema.parse({ member: memberDto(member), accountSummary: accounts ? { total: accounts.length,
      savings: accounts.filter((account) => account.account_type === 'savings').length, checking: accounts.filter((account) => account.account_type === 'checking').length } : null }));
  }));
  async function accountsFor(member: MemberRow, response: Response) {
    if (!member.account_access) { reject(response, 403, 'ACCESS_DENIED', 'Account access is restricted for this member.'); return null; }
    const rows = await repository!.listAccounts(member.member_id);
    if (!rows) reject(response, 403, 'ACCESS_DENIED', 'Account access is restricted for this member.');
    return rows;
  }
  router.get('/members/:memberId/accounts', memberRoute(async (_request, response, value, epoch, member) => {
    const accounts = await accountsFor(member, response); if (!accounts || !current(value, epoch, response, member.member_id)) return;
    response.json(DemoAccountsSchema.parse({ member: memberDto(member), accounts: accounts.map(accountDto) }));
  }));
  router.get('/members/:memberId/accounts/:accountId', memberRoute(async (request, response, value, epoch, member) => {
    const id = DemoAccountIdSchema.safeParse(request.params.accountId);
    if (!id.success) { reject(response, 400, 'INVALID_ACCOUNT_ID', 'Invalid account reference.'); return; }
    const accounts = await accountsFor(member, response); if (!accounts || !current(value, epoch, response, member.member_id)) return;
    const account = accounts.find((row) => row.account_id === id.data);
    if (!account) { reject(response, 404, 'ACCOUNT_NOT_FOUND', 'Account not found for the active member.'); return; }
    response.json(DemoDetailsSchema.parse({ member: memberDto(member), account: accountDto(account) }));
  }));
  return router;
}
