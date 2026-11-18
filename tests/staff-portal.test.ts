import { DemoSessionSchema, DemoSearchSchema } from '@interface-ai/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { staffServer, selectMember } from './helpers/staff-http.js';
import type { MemberStore } from '../apps/demo-api/src/staff-router.js';

const member = (id: string) => ({ member_id: id, display_name: 'Synthetic test record', status: 'active' as const, account_access: id !== 'M1004' });
const store: MemberStore = {
  async findMember(id) { return id === 'M9999' ? null : member(id); },
  async listAccounts(id) { return id === 'M1004' ? null : [{ account_id: 'S2001', member_id: id, account_type: 'savings',
    is_primary: true, status: 'active', current_balance_minor: 23456, available_balance_minor: 20000, currency: 'USD', sort_order: 0 }]; },
};
const cleanup: Array<() => Promise<void>> = [];
async function setup(repository = store, ttl?: number) { const service = await staffServer(repository, ttl); cleanup.push(service.close); return service; }
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
describe('staff portal HTTP and session boundaries', () => {
  it('requires a staff session and selected member; publishes safe, uncached typed data', async () => {
    const service = await setup(); const client = service.client();
    expect((await client('/members/M1001/accounts')).status).toBe(401);
    const session = await client('/session'); expect(session.status).toBe(200);
    expect(session.headers.get('set-cookie')).toContain('HttpOnly'); expect(session.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(session.headers.get('cache-control')).toBe('no-store');
    expect(DemoSessionSchema.parse(await session.json()).activeMember).toBeNull();
    expect((await client('/members/M1001/accounts')).status).toBe(409);
    expect((await selectMember(client, 'M1001')).status).toBe(200);
    const details = await client('/members/M1001/accounts/S2001');
    expect(await details.json()).toMatchObject({ member: { id: 'M1001' }, account: { currentBalanceMinor: 23456, availableBalanceMinor: 20000 } });
    expect((await client('/members/M1001/accounts/C3999')).status).toBe(404);
    expect((await client('/members/M1002/accounts')).status).toBe(409);
  });
  it('clears prior member context on search and reset, and rejects stale selections', async () => {
    const client = (await setup()).client(); await client('/session'); await selectMember(client, 'M1001');
    const old = DemoSearchSchema.parse(await (await client('/search', { memberId: 'M1001' })).json());
    const latest = DemoSearchSchema.parse(await (await client('/search', { memberId: 'M1002' })).json());
    expect((await client('/selection', { memberId: 'M1001', searchRevision: old.searchRevision })).status).toBe(409);
    expect((await client('/selection', { memberId: 'M1002', searchRevision: latest.searchRevision })).status).toBe(200);
    expect((await client('/members/M1001')).status).toBe(409);
    await client('/context/reset', {});
    expect(DemoSessionSchema.parse(await (await client('/session')).json()).activeMember).toBeNull();
    expect((await client('/members/M1002/accounts')).status).toBe(409);
  });
  it('never restores an older search after a newer search completes', async () => {
    let release!: () => void; let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const client = (await setup({ ...store, async findMember(id) { if (id === 'M1001') { started(); await blocked; } return member(id); } })).client();
    await client('/session'); const first = client('/search', { memberId: 'M1001' }); await ready;
    const second = await client('/search', { memberId: 'M1002' }); expect(second.status).toBe(200); release();
    expect((await first).status).toBe(409);
    const data = DemoSearchSchema.parse(await second.json()); expect((await client('/selection', { memberId: 'M1002', searchRevision: data.searchRevision })).status).toBe(200);
  });
  it('rejects account data that settles after member context is cleared', async () => {
    let release!: () => void; let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; }); const blocked = new Promise<void>((resolve) => { release = resolve; });
    const client = (await setup({ ...store, async listAccounts(id) { started(); await blocked; return store.listAccounts(id); } })).client();
    await client('/session'); await selectMember(client, 'M1001');
    const pending = client('/members/M1001/accounts/S2001'); await ready; await client('/context/reset', {}); release();
    const response = await pending; expect(response.status).toBe(409); expect(await response.text()).not.toContain('23456');
  });
  it('keeps browser sessions separate and rejects foreign-origin mutations', async () => {
    const service = await setup(); const a = service.client(); const b = service.client();
    await a('/session'); await b('/session'); await selectMember(a, 'M1001');
    expect(DemoSessionSchema.parse(await (await b('/session')).json()).activeMember).toBeNull();
    expect((await a('/context/reset', {}, 'https://foreign.example')).status).toBe(403);
    expect(DemoSessionSchema.parse(await (await a('/session')).json()).activeMember?.id).toBe('M1001');
  });
  it('distinguishes missing records, validation, permission denial, and safe load failure', async () => {
    const client = (await setup()).client(); await client('/session');
    expect(DemoSearchSchema.parse(await (await client('/search', { memberId: 'M9999' })).json()).member).toBeNull();
    const invalid = await client('/search', { memberId: 'private-marker' }); expect(invalid.status).toBe(400); expect(await invalid.text()).not.toContain('private-marker');
    await selectMember(client, 'M1004'); expect((await client('/members/M1004/accounts')).status).toBe(403);
    const failed = (await setup({ ...store, async findMember() { throw new Error('database-password-private-marker'); } })).client();
    await failed('/session'); const response = await failed('/search', { memberId: 'M1001' });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-marker');
  });
  it('expires the synthetic staff session without returning old context', async () => {
    const client = (await setup(store, 60_000)).client(); await client('/session'); await selectMember(client, 'M1001');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001);
    try {
      expect((await client('/members/M1001/accounts')).status).toBe(401);
      expect(DemoSessionSchema.parse(await (await client('/session')).json()).activeMember).toBeNull();
    } finally { clock.mockRestore(); }
  });
});
