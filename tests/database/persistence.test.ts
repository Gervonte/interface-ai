import { DemoAccountsSchema, DemoDetailsSchema } from '@interface-ai/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createPool, migrate, transaction } from '@interface-ai/postgres';
import type { Pool } from '@interface-ai/postgres';
import type { Capability } from '@interface-ai/contracts';
import { AutomationRepository, loadConfigurations, migrateAutomation } from '../../apps/automation/src/db/repository.js';
import { DemoRepository, migrateDemo, resetDemoFixtures } from '../../apps/demo-api/src/db/repository.js';
import { databaseSettings, disposeTestDatabases, grantRuntime, provision, readSecrets } from '../../scripts/database-support.js';

import { staffServer, selectMember } from '../helpers/staff-http.js';

const secrets = readSecrets(process.env); // Explicit suite fails when unconfigured; never silently skipped.
const settings = databaseSettings({ ...secrets,
  DB_AUTOMATION_MIGRATOR_PASSWORD: randomBytes(32).toString('hex'), DB_AUTOMATION_APP_PASSWORD: randomBytes(32).toString('hex'),
  DB_DEMO_MIGRATOR_PASSWORD: randomBytes(32).toString('hex'), DB_DEMO_APP_PASSWORD: randomBytes(32).toString('hex'),
}, 'interface_test_' + randomBytes(6).toString('hex'));
let automation: Pool; let automationOwner: Pool; let demo: Pool; let demoOwner: Pool;
let repository: AutomationRepository; let target: DemoRepository;
let configuration: Awaited<ReturnType<typeof loadConfigurations>>;
const request = { mode: 'discovery', targetId: 'demo-credit-union', goal: 'Find the requested current balance.', inputs: { memberId: 'M1001' } };
async function accept(key = randomUUID(), body: unknown = request) {
  return repository.acceptRun(body, { principal: 'test-operator', idempotencyKey: key }, configuration);
}
async function validArtifact(runId: string) {
  const artifact = JSON.parse(await readFile(new URL('../../examples/primary-savings.contract.json', import.meta.url), 'utf8')) as Capability;
  artifact.sourceDiscoveryRunId = runId; artifact.capabilityId = 'test-savings-' + randomBytes(4).toString('hex');
  for (const step of artifact.steps) {
    const sequence = await repository.appendEvent(runId, { type: step.type === 'capture' ? 'READ_COMPLETED' : 'ACTION_COMPLETED', actor: 'automation', stepId: step.id, details: { code: 'confirmed' } });
    step.source = { kind: 'discovery', runId, eventSequence: sequence };
  }
  return artifact;
}
const outputs = { memberId: 'M1001', accountId: 'S2001', accountType: 'savings', currentBalanceMinor: 125034, currency: 'USD' };
describe('real PostgreSQL persistence and isolation', () => {
  beforeAll(async () => {
    await provision(settings);
    automationOwner = createPool(settings.automation.migratorUrl); demoOwner = createPool(settings.demo.migratorUrl);
    expect(await migrateAutomation(automationOwner)).toBe(2); expect(await migrateDemo(demoOwner)).toBe(1);
    await grantRuntime(automationOwner, 'automation', settings.automation.app); await grantRuntime(demoOwner, 'demo', settings.demo.app);
    automation = createPool(settings.automation.appUrl); demo = createPool(settings.demo.appUrl);
    repository = new AutomationRepository(automation, secrets.REQUEST_FINGERPRINT_KEY); target = new DemoRepository(demo);
    configuration = await loadConfigurations(); await resetDemoFixtures(demoOwner);
  });
  afterEach(async () => {
    if (automationOwner) await automationOwner.query(`UPDATE automation.runs SET status='failed',controller='none',operator_ref=NULL,active_intervention_id=NULL,
      result='{"kind":"failure","code":"TEST_FINISHED","summary":"Test cleanup","blocked":null,"evidenceIds":[]}'::jsonb,updated_at=now() WHERE status NOT IN ('completed','failed','cancelled')`);
  });
  afterAll(async () => {
    await Promise.allSettled([automation?.end(), demo?.end(), automationOwner?.end(), demoOwner?.end()]);
    await disposeTestDatabases(settings);
  });
  it('applies initial migrations to empty databases and reruns without duplicating history', async () => {
    expect(await migrateAutomation(automationOwner)).toBe(0); expect(await migrateDemo(demoOwner)).toBe(0);
    const version = await automation.query('SHOW server_version'); expect(String(version.rows[0].server_version)).toMatch(/^18\.7/);
    expect((await automation.query('SHOW fsync')).rows[0].fsync).toBe('on');
    expect((await automation.query('SHOW synchronous_commit')).rows[0].synchronous_commit).toBe('on');
    const history = await automationOwner.query('SELECT count(*)::integer AS count FROM automation.schema_migrations'); expect(history.rows[0].count).toBe(2);
  });
  it('rejects changed migration history and rolls back failed migration DDL', async () => {
    const directory = await mkdtemp(tmpdir() + '/interface-migration-');
    const changed = pathToFileURL(directory + '/001_initial.sql'); await writeFile(changed, 'SELECT 1;');
    await expect(migrate(automationOwner, 'automation', [changed])).rejects.toThrow('mismatch');
    const valid = new URL('../../apps/automation/migrations/001_initial.sql', import.meta.url);
    const runtime = new URL('../../apps/automation/migrations/002_runtime.sql', import.meta.url);
    const failing = pathToFileURL(directory + '/003_bad.sql'); await writeFile(failing, 'CREATE TABLE automation.should_rollback(id integer); SELECT 1/0;');
    await expect(migrate(automationOwner, 'automation', [valid, runtime, failing])).rejects.toMatchObject({ code: '22012' });
    expect((await automationOwner.query("SELECT to_regclass('automation.should_rollback') AS name")).rows[0].name).toBeNull();
  });
  it('deduplicates concurrent retries and rejects changed payloads before capacity checks', async () => {
    const key = randomUUID(); const accepted = await Promise.all(Array.from({ length: 12 }, () => accept(key)));
    expect(new Set(accepted.map((value) => value.runId)).size).toBe(1);
    expect(accepted.filter((value) => !value.reused)).toHaveLength(1);
    await expect(accept(key, { ...request, inputs: { memberId: 'M1002' } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(accept()).rejects.toMatchObject({ code: 'RUN_CAPACITY_REACHED' });
    const rows = await automation.query('SELECT count(*)::integer AS count FROM automation.request_receipts WHERE run_id=$1', [accepted[0]!.runId]);
    expect(rows.rows[0].count).toBe(1);
    await expect(automation.query(`INSERT INTO automation.request_receipts SELECT $1,principal_ref,operation_scope,key_digest,payload_fingerprint,fingerprint_key_id,fingerprint_key_version,run_id,intervention_id,state,result_reference,accepted_at,expires_at FROM automation.request_receipts WHERE run_id=$2`, [randomUUID(), accepted[0]!.runId])).rejects.toMatchObject({ code: '23505' });
  });
  it('does not persist raw goals, invocation values, idempotency keys, or response payloads', async () => {
    const marker = 'synthetic-sensitive-marker'; const key = randomUUID();
    const accepted = await accept(key, { ...request, goal: marker, inputs: { memberId: marker } });
    const data = await automation.query(`SELECT jsonb_build_object('run',to_jsonb(r),'receipt',to_jsonb(q),'event',to_jsonb(e)) AS value
      FROM automation.runs r JOIN automation.request_receipts q USING(run_id) JOIN automation.run_events e USING(run_id) WHERE r.run_id=$1`, [accepted.runId]);
    const stored = JSON.stringify(data.rows);
    expect(stored).not.toContain(marker); expect(stored).not.toContain(key); expect(stored).not.toContain(secrets.REQUEST_FINGERPRINT_KEY);
    expect(stored).toContain('memberId');
  });
  it('fails closed on fingerprint-key loss/change and handles receipt expiry without redispatch', async () => {
    const key = randomUUID(); const accepted = await accept(key);
    const changed = new AutomationRepository(automation, randomBytes(32).toString('hex'));
    await expect(changed.acceptRun(request, { principal: 'test-operator', idempotencyKey: randomUUID() }, configuration)).rejects.toMatchObject({ code: 'FINGERPRINT_KEY_MISMATCH' });
    await automationOwner.query("UPDATE automation.request_receipts SET accepted_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE receipt_id=$1", [accepted.receiptId]);
    expect((await accept(key)).reused).toBe(true); // Active work cannot expire into another run.
    await automationOwner.query("UPDATE automation.runs SET status='cancelled',result=$2 WHERE run_id=$1", [accepted.runId, JSON.stringify({ kind: 'cancelled', reason: 'USER_REQUESTED', dispatchState: 'not_sent', effectState: 'not_applied' })]);
    await expect(accept(key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_WINDOW_EXPIRED' });
  });
  it('rolls back run, receipt, and event creation when receipt storage fails', async () => {
    const before = (await automation.query('SELECT count(*)::integer AS count FROM automation.runs')).rows[0].count;
    await automationOwner.query(`CREATE FUNCTION automation.test_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Forced test failure'; END; $$;
      CREATE TRIGGER test_fail_receipt BEFORE INSERT ON automation.request_receipts FOR EACH ROW EXECUTE FUNCTION automation.test_fail_receipt()`);
    try { await expect(accept()).rejects.toMatchObject({ code: 'P0001' }); }
    finally { await automationOwner.query('DROP TRIGGER test_fail_receipt ON automation.request_receipts; DROP FUNCTION automation.test_fail_receipt()'); }
    expect((await automation.query('SELECT count(*)::integer AS count FROM automation.runs')).rows[0].count).toBe(before);
  });
  it('assigns ordered, unique event sequences concurrently and enforces the SQL uniqueness constraint', async () => {
    const { runId } = await accept(); await repository.markRunning(runId);
    const sequences = await Promise.all(Array.from({ length: 16 }, () => repository.appendEvent(runId, { type: 'READ_COMPLETED', actor: 'automation', stepId: null, details: { code: 'observed' } })));
    expect(sequences.sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, index) => index + 3));
    await expect(automation.query("INSERT INTO automation.run_events(event_id,run_id,sequence,event_type,actor,details) VALUES($1,$2,1,'READ_COMPLETED','automation','{}')", [randomUUID(), runId])).rejects.toMatchObject({ code: '23505' });
  });
  it('publishes capability/result/event atomically, retains exact versions, and survives new connections', async () => {
    const { runId } = await accept(); await repository.markRunning(runId); const artifact = await validArtifact(runId);
    await automationOwner.query(`CREATE FUNCTION automation.test_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='RUN_COMPLETED' THEN RAISE EXCEPTION 'Forced completion failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_fail_completion BEFORE INSERT ON automation.run_events FOR EACH ROW EXECUTE FUNCTION automation.test_fail_completion()`);
    try { await expect(repository.publishCapability(runId, artifact, outputs, 'synthetic')).rejects.toMatchObject({ code: 'P0001' }); }
    finally { await automationOwner.query('DROP TRIGGER test_fail_completion ON automation.run_events; DROP FUNCTION automation.test_fail_completion()'); }
    expect((await repository.getRun(runId)).status).toBe('running');
    await expect(repository.getCapability(artifact.capabilityId, 1)).rejects.toMatchObject({ code: 'CAPABILITY_NOT_FOUND' });
    await repository.publishCapability(runId, artifact, outputs, 'synthetic');
    await expect(automation.query('INSERT INTO automation.capabilities SELECT * FROM automation.capabilities WHERE capability_id=$1', [artifact.capabilityId])).rejects.toMatchObject({ code: '23505' });
    const fresh = createPool(settings.automation.appUrl);
    try {
      const reopened = new AutomationRepository(fresh, secrets.REQUEST_FINGERPRINT_KEY);
      expect(await reopened.getCapability(artifact.capabilityId, 1)).toEqual(artifact);
      expect((await reopened.getRun(runId)).status).toBe('completed');
      await expect(reopened.getCapability(artifact.capabilityId, 2)).rejects.toMatchObject({ code: 'CAPABILITY_NOT_FOUND' });
    } finally { await fresh.end(); }
    await expect(automation.query('UPDATE automation.capabilities SET version=version WHERE capability_id=$1', [artifact.capabilityId])).rejects.toMatchObject({ code: '42501' });
    await expect(automationOwner.query('UPDATE automation.capabilities SET version=version WHERE capability_id=$1', [artifact.capabilityId])).rejects.toMatchObject({ code: '23514' });
    const replay = await accept(randomUUID(), { mode: 'replay', targetId: request.targetId, capability: { id: artifact.capabilityId, version: 1 }, inputs: { memberId: 'M1002' } });
    expect((await repository.getRun(replay.runId)).capability?.id).toBe(artifact.capabilityId);
  });
  it('rejects unconfirmed artifact provenance and protects pinned configuration snapshots', async () => {
    const { runId } = await accept(); await repository.markRunning(runId);
    const artifact = JSON.parse(await readFile(new URL('../../examples/primary-savings.contract.json', import.meta.url), 'utf8')) as Capability;
    artifact.sourceDiscoveryRunId = runId;
    for (const step of artifact.steps) step.source = { kind: 'discovery', runId, eventSequence: 1 };
    await expect(repository.publishCapability(runId, artifact, outputs)).rejects.toMatchObject({ code: 'UNCONFIRMED_ARTIFACT_SOURCE' });
    const confirmed = await validArtifact(runId);
    confirmed.surfaceRequirements.applicationFamily = 'another-application';
    await expect(repository.publishCapability(runId, confirmed, outputs)).rejects.toMatchObject({ code: 'INCOMPATIBLE_TARGET' });
    confirmed.surfaceRequirements.applicationFamily = 'demo-credit-union';
    const session = randomUUID(); const actualIntervention = randomUUID(); const incorrectIntervention = randomUUID();
    await automation.query('UPDATE automation.runs SET session_ref=$2 WHERE run_id=$1', [runId, session]);
    for (const intervention of [actualIntervention, incorrectIntervention]) await automation.query(
      "INSERT INTO automation.interventions(intervention_id,run_id,status,blocked,operator_ref,control_revision,session_ref,expires_at) VALUES($1,$2,'resolved','{}','test-human',2,$3,now()+interval '10 minutes')", [intervention, runId, session]);
    const first = confirmed.steps[0]!;
    const sequence = await repository.appendEvent(runId, { type: 'ACTION_COMPLETED', actor: 'human', stepId: first.id, interventionId: actualIntervention, details: { code: 'confirmed' } });
    first.source = { kind: 'manual', runId, interventionId: incorrectIntervention, eventSequence: sequence };
    confirmed.manualContributions = [{ handling: 'included', interventionId: incorrectIntervention, eventSequences: [sequence], stepIds: [first.id] }];
    await expect(repository.publishCapability(runId, confirmed, outputs)).rejects.toMatchObject({ code: 'UNCONFIRMED_ARTIFACT_SOURCE' });
    await expect(automation.query("UPDATE automation.runs SET target_snapshot='{}' WHERE run_id=$1", [runId])).rejects.toMatchObject({ code: '23514' });
  });
  it('enforces same-run/session intervention references and one unresolved intervention', async () => {
    const { runId } = await accept(); const session = randomUUID();
    await automation.query('UPDATE automation.runs SET session_ref=$2 WHERE run_id=$1', [runId, session]);
    await expect(transaction(automation, async (client) => {
      for (let index = 0; index < 2; index++) await client.query("INSERT INTO automation.interventions(intervention_id,run_id,status,blocked,control_revision,session_ref,expires_at) VALUES($1,$2,'open','{}',1,$3,now()+interval '10 minutes')", [randomUUID(), runId, session]);
    })).rejects.toMatchObject({ code: '23505' });
    await expect(automation.query("INSERT INTO automation.interventions(intervention_id,run_id,status,blocked,control_revision,session_ref,expires_at) VALUES($1,$2,'open','{}',1,$3,now()+interval '10 minutes')", [randomUUID(), runId, randomUUID()])).rejects.toMatchObject({ code: '23503' });
    await expect(automation.query('UPDATE automation.runs SET session_ref=$2 WHERE run_id=$1', [runId, randomUUID()])).rejects.toMatchObject({ code: '23514' });
  });
  it('resets synthetic data deterministically with reordered accounts and distinct balance fields', async () => {
    const first = await target.listAccounts('M1001'); expect(first?.map((account) => account.account_id)).toEqual(['C3001', 'S2001']);
    expect(first?.[1]).toMatchObject({ current_balance_minor: 125034, available_balance_minor: 120034 });
    expect((await target.listAccounts('M1002'))?.[0]).toMatchObject({ account_id: 'S2002', current_balance_minor: 8765, available_balance_minor: 7600 });
    expect((await target.listAccounts('M1003'))?.some((account) => account.is_primary)).toBe(false);
    expect(await target.listAccounts('M1004')).toBeNull(); expect(await target.findMember('M9999')).toBeNull();
    await demoOwner.query("UPDATE demo.accounts SET current_balance_minor=1 WHERE account_id='S2001'");
    await resetDemoFixtures(demoOwner); expect((await target.listAccounts('M1001'))?.[1]?.current_balance_minor).toBe(125034);
    await resetDemoFixtures(demoOwner); expect(await target.listAccounts('M1001')).toEqual(first);
  });
  it('serves actual PostgreSQL member/account values through the staff session API', async () => {
    const service = await staffServer(target); const client = service.client();
    try {
      await client('/session');
      for (const [memberId, accountId, current, available] of [['M1001', 'S2001', 125034, 120034], ['M1002', 'S2002', 8765, 7600]] as const) {
        expect((await selectMember(client, memberId)).status).toBe(200);
        const details = await client(`/members/${memberId}/accounts/${accountId}`);
        expect(details.status).toBe(200);
        expect(await details.json()).toMatchObject({ member: { id: memberId }, account: { id: accountId, currentBalanceMinor: current, availableBalanceMinor: available } });
      }
      await selectMember(client, 'M1002'); expect((await client('/members/M1002/accounts/S2001')).status).toBe(404);
      await selectMember(client, 'M1003'); expect(DemoAccountsSchema.parse(await (await client('/members/M1003/accounts')).json()).accounts.some((row: { isPrimary: boolean }) => row.isPrimary)).toBe(false);
      await selectMember(client, 'M1004'); expect((await client('/members/M1004/accounts')).status).toBe(403);
      await demoOwner.query("UPDATE demo.accounts SET current_balance_minor=31999 WHERE account_id='S2001'");
      await selectMember(client, 'M1001');
      expect(DemoDetailsSchema.parse(await (await client('/members/M1001/accounts/S2001')).json()).account.currentBalanceMinor).toBe(31999);
    } finally { await service.close(); await resetDemoFixtures(demoOwner); }
  });
  it('denies cross-database access, role escalation, runtime DDL, and direct target writes', async () => {
    const stolen = new URL(settings.automation.appUrl); stolen.pathname = '/' + settings.demo.database;
    const cross = createPool(stolen.toString());
    try { await expect(cross.query('SELECT * FROM demo.members')).rejects.toMatchObject({ code: '42501' }); }
    finally { await cross.end(); }
    const opposite = new URL(settings.demo.appUrl); opposite.pathname = '/' + settings.automation.database;
    const reverse = createPool(opposite.toString());
    try { await expect(reverse.query('SELECT * FROM automation.runs')).rejects.toMatchObject({ code: '42501' }); }
    finally { await reverse.end(); }
    await expect(automation.query('CREATE TABLE public.forbidden(id integer)')).rejects.toMatchObject({ code: '42501' });
    await expect(automation.query('SET ROLE ' + settings.demo.app)).rejects.toMatchObject({ code: '42501' });
    await expect(demo.query("UPDATE demo.accounts SET current_balance_minor=1 WHERE account_id='S2001'")).rejects.toMatchObject({ code: '42501' });
    await expect(automation.query('SELECT * FROM demo.members')).rejects.toMatchObject({ code: '42P01' });
  });
});
