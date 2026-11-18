import { z } from 'zod';
import { migrate, transaction } from '@interface-ai/postgres';
import type { Pool } from '@interface-ai/postgres';

export const demoMigrations = [new URL('../../migrations/001_initial.sql', import.meta.url)];
export const migrateDemo = (pool: Pool) => migrate(pool, 'demo', demoMigrations);
const memberId = z.string().regex(/^M\d{4}$/);
const memberSchema = z.object({ member_id: memberId, display_name: z.string(), status: z.enum(['active', 'inactive']), account_access: z.boolean() });
const minor = z.string().regex(/^\d+$/).transform((value) => BigInt(value)).refine((value) => value <= BigInt(Number.MAX_SAFE_INTEGER)).transform(Number);
const accountSchema = z.object({ account_id: z.string(), member_id: memberId, account_type: z.enum(['savings', 'checking']), is_primary: z.boolean(),
  status: z.enum(['active', 'closed']), current_balance_minor: minor, available_balance_minor: minor, currency: z.literal('USD'), sort_order: z.number().int() });
export class DemoRepository {
  constructor(readonly pool: Pool) {}
  async findMember(value: string) {
    const id = memberId.parse(value);
    const response = await this.pool.query('SELECT * FROM demo.members WHERE member_id=$1', [id]);
    return response.rows[0] ? memberSchema.parse(response.rows[0]) : null;
  }
  async listAccounts(value: string) {
    const id = memberId.parse(value);
    const member = await this.findMember(id);
    if (!member || !member.account_access) return null;
    const response = await this.pool.query('SELECT * FROM demo.accounts WHERE member_id=$1 ORDER BY sort_order,account_id', [id]);
    return z.array(accountSchema).parse(response.rows);
  }
}
// Setup only, using the migrator role. Neither automation nor the target UI receives this function.
export async function resetDemoFixtures(pool: Pool) {
  await transaction(pool, async (client) => {
    const ids = ['M1001', 'M1002', 'M1003', 'M1004'];
    await client.query('DELETE FROM demo.accounts WHERE member_id=ANY($1::text[])', [ids]);
    for (const [index, id] of ids.entries()) await client.query(`INSERT INTO demo.members(member_id,display_name,status,account_access) VALUES($1,$2,'active',$3)
      ON CONFLICT(member_id) DO UPDATE SET display_name=excluded.display_name,status=excluded.status,account_access=excluded.account_access`, [id, 'Test Member ' + ['A', 'B', 'C', 'D'][index], id !== 'M1004']);
    for (const account of [
      ['C3001', 'M1001', 'checking', false, 54000, 50000, 0], ['S2001', 'M1001', 'savings', true, 125034, 120034, 1],
      ['S2002', 'M1002', 'savings', true, 8765, 7600, 0], ['C3002', 'M1002', 'checking', false, 90000, 85000, 1],
      ['C3003', 'M1003', 'checking', false, 15000, 15000, 0], ['S2004', 'M1004', 'savings', true, 50000, 50000, 0],
    ]) await client.query("INSERT INTO demo.accounts(account_id,member_id,account_type,is_primary,current_balance_minor,available_balance_minor,sort_order,status,currency) VALUES($1,$2,$3,$4,$5,$6,$7,'active','USD')", account);
    await client.query("INSERT INTO demo.fixture_metadata(name,version) VALUES('baseline',1) ON CONFLICT(name) DO UPDATE SET version=excluded.version");
  });
}
