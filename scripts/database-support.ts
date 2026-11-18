import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createPool, identifier } from '@interface-ai/postgres';
import type { Pool } from '@interface-ai/postgres';

export const secretNames = ['DB_ADMIN_PASSWORD', 'DB_AUTOMATION_MIGRATOR_PASSWORD', 'DB_AUTOMATION_APP_PASSWORD', 'DB_DEMO_MIGRATOR_PASSWORD', 'DB_DEMO_APP_PASSWORD', 'REQUEST_FINGERPRINT_KEY'] as const;
export type Secrets = Record<(typeof secretNames)[number], string>;
export function readSecrets(env: Record<string, string | undefined>): Secrets {
  const result = {} as Secrets;
  for (const name of secretNames) {
    const value = env[name];
    if (!value || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Missing or invalid local database configuration.');
    result[name] = value;
  }
  return result;
}
function connection(user: string, password: string, database: string) {
  return `postgresql://${user}:${password}@127.0.0.1:55432/${database}`;
}
export function databaseSettings(secrets: Secrets, prefix = 'interface_ai') {
  identifier(prefix);
  return {
    adminUrl: connection('interface_admin', secrets.DB_ADMIN_PASSWORD, 'postgres'),
    automation: {
      database: `${prefix}_automation`, migrator: `${prefix}_automation_migrator`, app: `${prefix}_automation_app`,
      migratorPassword: secrets.DB_AUTOMATION_MIGRATOR_PASSWORD, appPassword: secrets.DB_AUTOMATION_APP_PASSWORD,
      get migratorUrl() { return connection(this.migrator, this.migratorPassword, this.database); },
      get appUrl() { return connection(this.app, this.appPassword, this.database); },
    },
    demo: {
      database: `${prefix}_demo`, migrator: `${prefix}_demo_migrator`, app: `${prefix}_demo_app`,
      migratorPassword: secrets.DB_DEMO_MIGRATOR_PASSWORD, appPassword: secrets.DB_DEMO_APP_PASSWORD,
      get migratorUrl() { return connection(this.migrator, this.migratorPassword, this.database); },
      get appUrl() { return connection(this.app, this.appPassword, this.database); },
    },
  };
}
export type DatabaseSettings = ReturnType<typeof databaseSettings>;
export async function initializeLocalSecrets(root: URL) {
  const file = new URL('.env.database', root);
  let contents: string;
  try { contents = await readFile(file, 'utf8'); }
  catch (error) {
    if (!(typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT')) throw error;
    contents = secretNames.map((name) => `${name}=${randomBytes(32).toString('hex')}`).join('\n') + '\n';
    await writeFile(file, contents, { flag: 'wx', mode: 0o600 });
  }
  await chmod(file, 0o600);
  const secrets = readSecrets(parseEnv(contents));
  const settings = databaseSettings(secrets);
  for (const [path, values] of [
    ['apps/automation/.env', { DATABASE_URL: settings.automation.appUrl, REQUEST_FINGERPRINT_KEY: secrets.REQUEST_FINGERPRINT_KEY }],
    ['apps/demo-api/.env', { DATABASE_URL: settings.demo.appUrl }],
  ] as const) {
    const destination = new URL(path, root);
    let text = '';
    try { text = await readFile(destination, 'utf8'); }
    catch (error) { if (!(typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT')) throw error; }
    const existing = parseEnv(text);
    for (const [key, value] of Object.entries(values)) {
      if (existing[key] && existing[key] !== value) throw new Error('Existing application database configuration differs; it was not overwritten.');
      if (!existing[key]) text = text.trimEnd() + '\n' + key + '=' + value + '\n';
    }
    await writeFile(destination, text, { mode: 0o600 });
    await chmod(destination, 0o600);
  }
  return secrets;
}
export async function provision(settings: DatabaseSettings) {
  const admin = createPool(settings.adminUrl);
  try {
    for (const component of [settings.automation, settings.demo]) {
      for (const [role, password] of [[component.migrator, component.migratorPassword], [component.app, component.appPassword]]) {
        if (!role || !password || !/^[0-9a-f]{64}$/.test(password)) throw new Error('Invalid role configuration.');
        const prior = await admin.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1', [role]);
        if (!prior.rowCount) await admin.query(`CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
        else if (Object.values(prior.rows[0]).some(Boolean)) throw new Error('Existing role has unexpected elevated privileges.');
      }
      const database = await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1', [component.database]);
      if (!database.rowCount) await admin.query(`CREATE DATABASE ${identifier(component.database)} OWNER ${identifier(component.migrator)}`);
      else if (database.rows[0].owner !== component.migrator) throw new Error('Existing database has another owner.');
      await admin.query(`REVOKE ALL ON DATABASE ${identifier(component.database)} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${identifier(component.database)} TO ${identifier(component.app)}`);
      const migrator = createPool(component.migratorUrl);
      try { await migrator.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC'); }
      finally { await migrator.end(); }
    }
    await admin.query('REVOKE ALL ON DATABASE postgres FROM PUBLIC');
  } finally { await admin.end(); }
}
export async function grantRuntime(pool: Pool, schema: 'automation' | 'demo', role: string) {
  const recipient = identifier(role);
  await pool.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`);
  await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC`);
  await pool.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC`);
  await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${recipient}`);
  if (schema === 'automation') {
    await pool.query(`GRANT SELECT,INSERT ON automation.capabilities,automation.run_events TO ${recipient}`);
    await pool.query(`GRANT SELECT,INSERT,UPDATE ON automation.runs,automation.interventions,automation.request_receipts TO ${recipient}`);
  } else await pool.query(`GRANT SELECT ON demo.members,demo.accounts,demo.fixture_metadata TO ${recipient}`);
}
// Only used for unique test resources created in this process, never development data.
export async function disposeTestDatabases(settings: DatabaseSettings) {
  if (!settings.automation.database.startsWith('interface_test_') || !settings.demo.database.startsWith('interface_test_')) throw new Error('Refusing non-test database disposal.');
  const admin = createPool(settings.adminUrl);
  try {
    for (const component of [settings.automation, settings.demo]) {
      await admin.query(`DROP DATABASE IF EXISTS ${identifier(component.database)} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${identifier(component.app)}`);
      await admin.query(`DROP ROLE IF EXISTS ${identifier(component.migrator)}`);
    }
  } finally { await admin.end(); }
}
