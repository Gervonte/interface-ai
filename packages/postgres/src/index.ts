import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
export { Pool } from 'pg';
export type { PoolClient } from 'pg';

export function createPool(connectionString: string) {
  const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000,
    statement_timeout: 10000, query_timeout: 12000 });
  pool.on('error', () => console.error('PostgreSQL idle connection failed.'));
  return pool;
}
export async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    throw error;
  } finally { client.release(destroy); }
}
export function identifier(value: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid database identifier.');
  return '"' + value + '"';
}
export async function migrate(pool: Pool, schema: 'automation' | 'demo', files: readonly URL[]) {
  const migrations = await Promise.all(files.map(async (file) => {
    const sql = await readFile(file, 'utf8');
    return { name: file.pathname.split('/').at(-1)!, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  if (new Set(migrations.map((entry) => entry.name)).size !== migrations.length) throw new Error('Duplicate migration name.');
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(5001)');
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const prior = await client.query<{ name: string; checksum: string }>(`SELECT name, checksum FROM ${schema}.schema_migrations ORDER BY name`);
    for (const row of prior.rows) {
      if (migrations.find((entry) => entry.name === row.name)?.checksum !== row.checksum) throw new Error('Migration history or checksum mismatch.');
    }
    let applied = 0;
    for (const entry of migrations) {
      if (prior.rows.some((row) => row.name === entry.name)) continue;
      await client.query(entry.sql);
      await client.query(`INSERT INTO ${schema}.schema_migrations (name, checksum) VALUES ($1,$2)`, [entry.name, entry.checksum]);
      applied++;
    }
    return applied;
  });
}
