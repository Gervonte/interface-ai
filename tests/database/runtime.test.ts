import { currentBalanceRequest, availableBalanceRequest } from '../../examples/discovery-requests.js';
import { NeedsIntervention } from '../../apps/automation/src/execution/errors.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { Server } from 'node:http';
import { createPool } from '@interface-ai/postgres';
import type { Pool } from '@interface-ai/postgres';
import { RunAcceptedSchema, RunViewSchema } from '@interface-ai/contracts';
import { createApp } from '../../apps/automation/src/app.js';
import { AutomationRepository, loadConfigurations, migrateAutomation } from '../../apps/automation/src/db/repository.js';
import { RuntimeRepository } from '../../apps/automation/src/db/runtime-repository.js';
import { Coordinator } from '../../apps/automation/src/execution/coordinator.js';
import type { Worker, SessionFactory } from '../../apps/automation/src/execution/coordinator.js';
import { EvidenceStore } from '../../apps/automation/src/execution/evidence.js';
import { sessionStartError } from '../../apps/automation/src/execution/diagnostics.js';
import { databaseSettings, disposeTestDatabases, grantRuntime, provision, readSecrets } from '../../scripts/database-support.js';

const secrets = readSecrets(process.env);
const settings = databaseSettings({ ...secrets, DB_AUTOMATION_MIGRATOR_PASSWORD: randomBytes(32).toString('hex'), DB_AUTOMATION_APP_PASSWORD: randomBytes(32).toString('hex'),
  DB_DEMO_MIGRATOR_PASSWORD: randomBytes(32).toString('hex'), DB_DEMO_APP_PASSWORD: randomBytes(32).toString('hex') }, 'interface_test_' + randomBytes(6).toString('hex'));
let owner: Pool; let pool: Pool; let repository: AutomationRepository; let configuration: Awaited<ReturnType<typeof loadConfigurations>>; let folder: string;
const cleanups: Array<() => Promise<void>> = [];
const request = { mode: 'discovery', outputContract: currentBalanceRequest.outputContract, targetId: 'demo-credit-union', goal: 'synthetic-private-goal-marker', inputs: { memberId: 'synthetic-private-input-marker' } };
async function service(worker?: Worker, sessions?: SessionFactory) {
  const coordinator = new Coordinator(repository, secrets.REQUEST_FINGERPRINT_KEY, configuration, new EvidenceStore(folder), sessions, worker);
  await coordinator.start();
  const server: Server = createApp({ coordinator, identities: [{ token: 'a'.repeat(64), principal: 'test-operator', access: 'operator' },
    { token: 'b'.repeat(64), principal: 'another-operator', access: 'operator' }, { token: 'c'.repeat(64), principal: 'test-operator', access: 'read' }] }).listen(0, '127.0.0.1');
  await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No HTTP address');
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await coordinator.stop(); });
  const call = (path: string, body?: unknown, key = randomUUID(), token = 'a'.repeat(64)) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  return { coordinator, call, base: `http://127.0.0.1:${address.port}` };
}
async function until(check: () => Promise<boolean>) { for (let i = 0; i < 100; i++) { if (await check()) return; await delay(20); } throw new Error('Timed out waiting for test state'); }
describe('authenticated run API and durable coordinator', () => {
  beforeAll(async () => {
    await provision(settings); owner = createPool(settings.automation.migratorUrl); expect(await migrateAutomation(owner)).toBe(4);
    await grantRuntime(owner, 'automation', settings.automation.app); pool = createPool(settings.automation.appUrl);
    repository = new AutomationRepository(pool, secrets.REQUEST_FINGERPRINT_KEY); configuration = await loadConfigurations();
    folder = await mkdtemp(tmpdir() + '/runtime-evidence-');
  });
  afterEach(async () => {
    for (const close of cleanups.splice(0).reverse()) await close();
    await owner.query("UPDATE automation.runs SET session_state='closed' WHERE session_state NOT IN ('none','closed')");
    await owner.query("UPDATE automation.runs SET status='cancelled',controller='none',operator_ref=NULL,active_intervention_id=NULL,result=$1 WHERE status NOT IN ('completed','failed','cancelled')", [JSON.stringify({ kind: 'cancelled', reason: 'INTERRUPTED', dispatchState: 'unknown', effectState: 'unknown' })]);
  });
  afterAll(async () => { await Promise.allSettled([pool?.end(), owner?.end()]); await disposeTestDatabases(settings); });
  it('returns accepted references promptly and reports an explicit unavailable mode asynchronously', async () => {
    const f = await service(); const response = await f.call('/v1/runs', request); expect(response.status).toBe(202);
    const accepted = RunAcceptedSchema.parse(await response.json()); await f.coordinator.idle();
    const result = await f.call(accepted.statusUrl); expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
    expect(RunViewSchema.parse(await result.json()).result).toMatchObject({ kind: 'failure', code: 'DISCOVERY_NOT_IMPLEMENTED' });
    const rows = await pool.query('SELECT row_to_json(r) AS row FROM automation.runs r WHERE run_id=$1', [accepted.runId]);
    const events = await f.call(`/v1/runs/${accepted.runId}/events?afterSequence=0&limit=2`); const text = await events.text();
    expect(text).toContain('RUN_ACCEPTED'); expect(text).not.toContain('synthetic-private'); expect(JSON.stringify(rows.rows)).not.toContain('synthetic-private');
    expect((await f.call(`/v1/runs/${accepted.runId}/events?limit=201`)).status).toBe(400);
  });
  it('deduplicates concurrent HTTP requests and reserves one active run before background execution', async () => {
    let workers = 0;
    const f = await service(async (_request, context) => { workers++; await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true })); });
    const key = randomUUID(); const responses = await Promise.all(Array.from({ length: 8 }, () => f.call('/v1/runs', request, key)));
    const accepted = await Promise.all(responses.map(async response => { expect(response.status).toBe(202); return RunAcceptedSchema.parse(await response.json()); }));
    expect(new Set(accepted.map(value => value.runId)).size).toBe(1); await until(async () => workers === 1); expect(workers).toBe(1);
    expect((await f.call('/healthz')).status).toBe(200);
    expect((await f.call('/v1/runs', request)).status).toBe(409);
    expect((await f.call('/v1/runs', { ...request, inputs: { memberId: 'changed' } }, key)).status).toBe(409);
    expect((await f.call('/v1/runs', { ...request, targetId: 'unknown-target' }, key)).status).toBe(409);
    const id = accepted[0]!.runId; const cancelKey = randomUUID(); const stopped = await f.call(`/v1/runs/${id}/cancel`, { reason: 'USER_REQUESTED' }, cancelKey); expect([200, 202]).toContain(stopped.status);
    await f.coordinator.idle(); expect(RunViewSchema.parse(await (await f.call(`/v1/runs/${id}`)).json()).status).toBe('cancelled');
    expect((await f.call(`/v1/runs/${id}/cancel`, { reason: 'USER_REQUESTED' }, cancelKey)).status).toBe(200);
    expect((await f.call('/v1/runs', request, key)).status).toBe(202); expect(workers).toBe(1);
  });
  it('authenticates and authorizes reads, writes, evidence, and capability access without exposing values', async () => {
    const f = await service();
    expect((await f.call('/v1/runs', request, randomUUID(), 'wrong')).status).toBe(401);
    expect((await f.call('/v1/runs', request, randomUUID(), 'c'.repeat(64))).status).toBe(403);
    const accepted = RunAcceptedSchema.parse(await (await f.call('/v1/runs', request)).json()); await f.coordinator.idle();
    expect((await f.call(accepted.statusUrl, undefined, randomUUID(), 'b'.repeat(64))).status).toBe(404);
    expect((await f.call(accepted.statusUrl + '/events', undefined, randomUUID(), 'b'.repeat(64))).status).toBe(404);
    expect((await f.call(accepted.statusUrl + '/evidence/' + randomUUID(), undefined, randomUUID(), 'b'.repeat(64))).status).toBe(404);
    expect((await f.call('/v1/capabilities/unknown/versions/1')).status).toBe(404);
    expect((await f.call('/v1/runs', { ...request, targetId: 'unknown-target' })).status).toBe(404);
  });
  it('rejects duplicate keys, malformed JSON, unsafe shapes and missing mutation keys', async () => {
    const f = await service();
    for (const raw of ['{"mode":"replay","mode":"discovery"}', '{"inputs":{"memberId":"x","\\u006demberId":"y"}}', '{"private-marker":']) {
      const response = await fetch(f.base + '/v1/runs', { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: raw });
      expect(response.status).toBe(400); expect(await response.text()).not.toContain('private-marker');
    }
    expect((await fetch(f.base + '/v1/runs', { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json' }, body: JSON.stringify(request) })).status).toBe(400);
  });
  it('enforces a single coordinator lease across independent connections', async () => {
    const f = await service(); const second = new Coordinator(repository, secrets.REQUEST_FINGERPRINT_KEY, configuration, new EvidenceStore(folder));
    await expect(second.start()).rejects.toMatchObject({ code: 'COORDINATOR_ALREADY_RUNNING' }); expect(f.coordinator.status().ready).toBe(true);
  });
  it('keeps capacity blocked when a provider launch/session cannot be reconciled', async () => {
    const accepted = await repository.acceptRun(request, { principal: 'test-operator', idempotencyKey: randomUUID() }, configuration); await repository.markRunning(accepted.runId);
    const runtime = new RuntimeRepository(repository, secrets.REQUEST_FINGERPRINT_KEY); await runtime.sessionIntent(accepted.runId, new Date(Date.now() + 60_000));
    const f = await service();
    expect((await f.call('/v1/runs', request)).status).toBe(409);
    expect(RunViewSchema.parse(await (await f.call(`/v1/runs/${accepted.runId}`)).json()).result).toMatchObject({ kind: 'cancelled', reason: 'INTERRUPTED' });
    expect((await runtime.state(accepted.runId)).session_state).toBe('uncertain');
  });
  it('reports a definitive provider refusal as not created, releases capacity, and keeps no cleanup hold', async () => {
    let reconciles=0;
    const factory: SessionFactory = { reconcile: async () => { reconciles++; return false; }, open: async () => { throw sessionStartError(Object.assign(new Error('synthetic-provider-text-marker'), { status: 402 })); } };
    const f = await service(async (_request, context) => { await context.executor({}); throw new Error('unreachable'); }, factory);
    const accepted = RunAcceptedSchema.parse(await (await f.call('/v1/runs', request)).json()); await f.coordinator.idle();
    const view = RunViewSchema.parse(await (await f.call(`/v1/runs/${accepted.runId}`)).json());
    expect(view.result).toMatchObject({ kind: 'failure', code: 'SESSION_NOT_CREATED', blocked: null });
    expect(view.result?.kind === 'failure' && view.result.summary).toMatch(/usage or plan limit.*No session was created and no model call or UI action ran/);
    const events = (await f.coordinator.repository.events(accepted.runId, 'test-operator', 0, 50)).events;
    expect(events.find(event => event.type === 'SESSION_FINISHED')?.details).toMatchObject({ code: 'not_created', category: 'provider_usage_limit', modelCalls: 0 });
    expect(events.some(event => /^(MODEL_|ACTION_)/.test(event.type))).toBe(false);
    const runtime = new RuntimeRepository(repository, secrets.REQUEST_FINGERPRINT_KEY);
    expect((await runtime.state(accepted.runId)).session_state).toBe('closed'); expect(reconciles).toBe(0);
    expect(JSON.stringify({ view, events })).not.toContain('synthetic-provider-text-marker');
    // No cleanup hold: the next run is admitted.
    expect((await f.call('/v1/runs', request)).status).toBe(202);
  });
  it('keeps an uncertain session start held and says so instead of reporting a cleanup failure', async () => {
    const factory: SessionFactory = { reconcile: async () => false, open: async () => { throw sessionStartError(new Error('socket hang up')); } };
    const f = await service(async (_request, context) => { await context.executor({}); throw new Error('unreachable'); }, factory);
    const accepted = RunAcceptedSchema.parse(await (await f.call('/v1/runs', request)).json()); await f.coordinator.idle();
    const result = (await f.coordinator.read(accepted.runId, 'test-operator')).result;
    expect(result).toMatchObject({ kind: 'failure', code: 'SESSION_START_UNCERTAIN' });
    expect(result?.kind === 'failure' && result.summary).toMatch(/may have created a session/);
    expect((await new RuntimeRepository(repository, secrets.REQUEST_FINGERPRINT_KEY).state(accepted.runId)).session_state).toBe('uncertain');
    expect((await f.call('/v1/runs', request)).status).toBe(409);
  });
  it('keeps synthetic goal, input and page markers out of every table, event, evidence file and API response, and explains the failed identity check', async () => {
    const goalMarker='synthetic-goal-marker-7f3a',inputMarker='synthetic-input-marker-91c2',pageMarker='synthetic-page-marker-4d8e';
    const fill={scope:{kind:'document' as const},within:[],locator:{kind:'label' as const,text:'Member ID',exact:true as const},expectedMatches:1 as const};
    let location='about:blank';const dispatched:Array<string|undefined>=[];
    const surface={location:async()=>location,navigate:async(url:string)=>{location=url;},
      inspect:async()=>({count:1,visible:true,enabled:true,editable:true,text:pageMarker,value:pageMarker,checked:false,tag:'input',name:'Member ID',inputType:'text'}),
      dispatch:async(_type:string,_target:unknown,_policy:unknown,value?:string)=>{dispatched.push(value);},
      snapshot:async()=>({schemaVersion:1,kind:'structural-snapshot',redactedValues:true,omittedFrames:0,documents:[{depth:0,headings:[{kind:'h1',label:'Member Search'}],controls:[{kind:'input',label:'Member ID',enabled:true}],tables:[]}]})};
    const factory:SessionFactory={reconcile:async()=>true,open:async(_config,created)=>{const id=randomUUID();await created(id);return{id,surface,close:async()=>true};}};
    const worker:Worker=async(_request,context)=>{
      const executor=await context.executor({member:fill});
      await executor.execute({type:'navigate',destination:'target-entry'},'entry');
      await executor.execute({type:'fill',target:'member',value:{kind:'input',name:'memberId'}},'fill-member');
      return executor.reject('IDENTITY_MISMATCH','verify-identity','settled','account-identity');
    };
    const previous=configuration;
    configuration={...configuration,policy:{...configuration.policy,allowedFillNames:['Member ID']}};
    let f:Awaited<ReturnType<typeof service>>;try{f=await service(worker,factory);}finally{configuration=previous;}
    const accepted=RunAcceptedSchema.parse(await(await f.call('/v1/runs',{...request,goal:goalMarker,inputs:{memberId:inputMarker}})).json());await f.coordinator.idle();
    // Permitted destination: the bound value reaches the browser fill, and nowhere else.
    expect(dispatched).toEqual([inputMarker]);
    const view=await(await f.call(accepted.statusUrl)).json();const events=await(await f.call(accepted.statusUrl+'/events?afterSequence=0&limit=200')).json();
    expect(view.result).toMatchObject({kind:'failure',code:'IDENTITY_MISMATCH',blocked:{stepId:'verify-identity',reason:'IDENTITY_MISMATCH',dispatchState:'settled',expected:{code:'RECORD_IDENTITY_MATCH'},observed:{code:'IDENTITY_MISMATCH'}}});
    expect(view.result.blocked.observed.description).toContain('Rule: account-identity.');expect(view.result.summary).toContain('Step: verify-identity.');
    const evidenceId=view.result.evidenceIds[0];expect(evidenceId).toBeTruthy();
    const evidence=await(await f.call(accepted.statusUrl+'/evidence/'+evidenceId)).text();
    const tables=(await owner.query("SELECT table_name FROM information_schema.tables WHERE table_schema='automation' AND table_type='BASE TABLE'")).rows.map(row=>row.table_name as string);
    expect(tables.length).toBeGreaterThanOrEqual(5);
    const rows:unknown[]=[];for(const table of tables)rows.push(...(await owner.query(`SELECT to_jsonb(t) AS row FROM automation.${table} t`)).rows);
    const { readdir } = await import('node:fs/promises');
    const files=await Promise.all((await readdir(folder+'/'+accepted.runId)).map(name=>readFile(folder+'/'+accepted.runId+'/'+name,'utf8')));
    expect(files.length).toBeGreaterThan(0);
    const swept=JSON.stringify({rows,files,view,events,evidence});
    for(const marker of[goalMarker,inputMarker,pageMarker])expect(swept).not.toContain(marker);
  });
  it('keeps an intervention\'s own blocked reason when it times out after an earlier step failure', async () => {
    const missing={scope:{kind:'document' as const},within:[],locator:{kind:'role' as const,role:'button' as const,name:'Search',exact:true as const},expectedMatches:1 as const};
    let location='about:blank';
    const surface={location:async()=>location,navigate:async(url:string)=>{location=url;},
      inspect:async()=>({count:0,visible:false,enabled:false,editable:false,text:'',value:'',checked:false,tag:'',name:'',inputType:''}),dispatch:async()=>{},
      snapshot:async()=>({schemaVersion:1,kind:'structural-snapshot',redactedValues:true,omittedFrames:0,documents:[]})};
    const factory:SessionFactory={reconcile:async()=>true,open:async(_config,created)=>{const id=randomUUID();await created(id);return{id,surface,close:async()=>true};}};
    const worker:Worker=async(_request,context)=>{
      const executor=await context.executor({missing});
      await executor.execute({type:'navigate',destination:'target-entry'},'entry');
      await executor.execute({type:'click',target:'missing'},'step-a').catch(()=>{});
      throw new NeedsIntervention({stepId:null,actionIndex:null,reason:'MANUAL_PREREQUISITE',dispatchState:'not_sent',effectState:'not_checked',checkpointId:null,
        expected:{code:'READY_SCREEN',description:'Synthetic prerequisite.'},observed:{code:'MANUAL_PREREQUISITE',description:'Synthetic manual step needed.'},evidenceIds:[]});
    };
    const previous=configuration;
    configuration={...configuration,policy:{...configuration.policy,budgets:{...configuration.policy.budgets,interventionTimeoutMs:1000}}};
    let f:Awaited<ReturnType<typeof service>>;try{f=await service(worker,factory);}finally{configuration=previous;}
    const accepted=RunAcceptedSchema.parse(await(await f.call('/v1/runs',request)).json());await f.coordinator.idle();
    const result=(await f.coordinator.read(accepted.runId,'test-operator')).result;
    expect(result).toMatchObject({kind:'failure',code:'INTERVENTION_TIMEOUT',blocked:{stepId:'step-a',reason:'MANUAL_PREREQUISITE',expected:{code:'READY_SCREEN'}}});
  });
  it('reconciles expired sessions without redispatching interrupted actions', async () => {
    const accepted = await repository.acceptRun(request, { principal: 'test-operator', idempotencyKey: randomUUID() }, configuration); await repository.markRunning(accepted.runId);
    const runtime = new RuntimeRepository(repository, secrets.REQUEST_FINGERPRINT_KEY); await runtime.sessionIntent(accepted.runId, new Date(Date.now() - 1000));
    await runtime.sessionCreated(accepted.runId, randomUUID());
    await runtime.record(accepted.runId, 2, { type: 'ACTION_DISPATCHED', actor: 'automation', stepId: 'test-action', details: { code: 'dispatching' } });
    let workers = 0; const f = await service(async () => { workers++; });
    const run = RunViewSchema.parse(await (await f.call(`/v1/runs/${accepted.runId}`)).json());
    expect(run.result).toMatchObject({ kind: 'cancelled', reason: 'INTERRUPTED', dispatchState: 'unknown', effectState: 'unknown' }); expect(workers).toBe(0);
    expect((await runtime.state(accepted.runId)).session_state).toBe('closed');
  });
  it('returns cancellation promptly while a real admitted dispatch is still unresolved', async () => {
    let entered!: () => void; let release!: () => void; let dispatches = 0; let closes = 0;
    const started = new Promise<void>(resolve => { entered = resolve; }); const pending = new Promise<void>(resolve => { release = resolve; });
    const prior = configuration;
    configuration = { ...configuration, policy: { ...configuration.policy, allowedFillNames: ['Member ID'], budgets: { ...configuration.policy.budgets, stepTimeoutMs: 500, pollIntervalMs: 50 } } };
    const factory: SessionFactory = { async reconcile() { return true; }, async open(_config, created) {
      const id = randomUUID(); await created(id);
      return { id, surface: { async location() { return 'http://127.0.0.1:5174/'; }, async inspect() { return { count: 1, visible: true, enabled: true, editable: true, text: '', value: '', checked: false, tag: 'input', name: 'Member ID', inputType: 'text' }; },
        async dispatch() { dispatches++; entered(); await pending; }, async navigate() {}, async snapshot() { return { schemaVersion: 1, kind: 'structural-snapshot', redactedValues: true, documents: [], omittedFrames: 0 }; } },
        async close() { closes++; return true; } };
    } };
    try {
      const f = await service(async (_request, context) => {
        const executor = await context.executor({ member: { scope: { kind: 'document' }, within: [], locator: { kind: 'label', text: 'Member ID', exact: true }, expectedMatches: 1 } });
        await executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'memberId' } }, 'fill-member');
      }, factory);
      const accepted = RunAcceptedSchema.parse(await (await f.call('/v1/runs', request)).json()); await started;
      const time = Date.now(); const response = await f.call(accepted.statusUrl + '/cancel', { reason: 'USER_REQUESTED' });
      expect(response.status).toBe(202); expect(Date.now() - time).toBeLessThan(1000);
      expect((await f.call('/v1/runs', request)).status).toBe(409);
      await f.coordinator.idle(); release();
      expect(RunViewSchema.parse(await (await f.call(accepted.statusUrl)).json()).result).toMatchObject({ kind: 'cancelled', reason: 'USER_REQUESTED', dispatchState: 'unknown', effectState: 'unknown' });
      expect(dispatches).toBe(1); expect(closes).toBe(1);
      const operation = await f.call(accepted.operationUrl!); expect(operation.status).toBe(200);
    } finally { release(); configuration = prior; }
  });

  it('survives actual process death during session creation and blocks new runs until expiry/reconciliation', async () => {
    const child = fork(fileURLToPath(new URL('../helpers/runtime-child.ts', import.meta.url)), [], { execArgv: ['--import', 'tsx'],
      env: { ...process.env, AUTOMATION_TEST_DB: settings.automation.appUrl, AUTOMATION_TEST_EVIDENCE: folder }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    try {
      const [message] = await once(child, 'message') as [{ port: number }];
      const response = await fetch(`http://127.0.0.1:${message.port}/v1/runs`, { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(request) });
      const accepted = RunAcceptedSchema.parse(await response.json());
      await until(async () => (await pool.query('SELECT session_state FROM automation.runs WHERE run_id=$1', [accepted.runId])).rows[0]?.session_state === 'creating');
      child.kill('SIGKILL'); await once(child, 'exit');
      const f = await service();
      expect(RunViewSchema.parse(await (await f.call(accepted.statusUrl)).json()).result).toMatchObject({ reason: 'INTERRUPTED' });
      expect((await f.call('/v1/runs', request)).status).toBe(409);
      const row = (await pool.query('SELECT * FROM automation.runs WHERE run_id=$1', [accepted.runId])).rows[0];
      expect(row.session_state).toBe('uncertain'); expect(JSON.stringify(row)).not.toContain('synthetic-private');
    } finally { if (!child.killed) { child.kill('SIGKILL'); await once(child, 'exit'); } }
  });
  it('keeps validated outputs transient and reports non-retention after expiry', async () => {
    const source = await repository.acceptRun({ ...request, inputs: { memberId: 'M1001' } }, { principal: 'test-operator', idempotencyKey: randomUUID() }, configuration); await repository.markRunning(source.runId);
    const artifact = JSON.parse(await readFile(new URL('../../examples/primary-savings.contract.json', import.meta.url), 'utf8'));
    artifact.sourceDiscoveryRunId = source.runId; artifact.capabilityId = 'transient-output-test';
    for (const step of artifact.steps) step.source = { kind: 'discovery', runId: source.runId, eventSequence: await repository.appendEvent(source.runId, { type: 'ACTION_COMPLETED', actor: 'automation', stepId: step.id, details: { code: 'confirmed' } }) };
    const values = { memberId: 'M1001', accountId: 'S2001', accountType: 'savings', currentBalanceMinor: 125034, currency: 'USD' };
    await repository.publishCapability(source.runId, artifact, values);
    const f = await service(async () => ({ kind: 'success', capability: { id: artifact.capabilityId, version: 1 }, output: { availability: 'available', values } }));
    const accepted = RunAcceptedSchema.parse(await (await f.call('/v1/runs', { mode: 'replay', targetId: 'demo-credit-union', capability: { id: artifact.capabilityId, version: 1 }, inputs: { memberId: 'M1001' } })).json());
    await f.coordinator.idle();
    expect((await f.coordinator.read(accepted.runId, 'test-operator')).result).toMatchObject({ kind: 'success', output: { availability: 'available', values } });
    expect((await repository.getRun(accepted.runId)).result).toMatchObject({ kind: 'success', output: { availability: 'not_retained' } });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300_001);
    try { expect((await f.coordinator.read(accepted.runId, 'test-operator')).result).toMatchObject({ kind: 'success', output: { availability: 'not_retained' } }); }
    finally { clock.mockRestore(); }
  });

  it('maps well-formed invalid capability inputs to 422 and retrieves exact owned versions', async () => {
    const accepted = await repository.acceptRun({ ...request, inputs: { memberId: 'M1001' } }, { principal: 'test-operator', idempotencyKey: randomUUID() }, configuration); await repository.markRunning(accepted.runId);
    const artifact = JSON.parse(await readFile(new URL('../../examples/primary-savings.contract.json', import.meta.url), 'utf8'));
    artifact.sourceDiscoveryRunId = accepted.runId; artifact.capabilityId = 'runtime-owned-test';
    for (const step of artifact.steps) step.source = { kind: 'discovery', runId: accepted.runId, eventSequence: await repository.appendEvent(accepted.runId, { type: 'ACTION_COMPLETED', actor: 'automation', stepId: step.id, details: { code: 'confirmed' } }) };
    await repository.publishCapability(accepted.runId, artifact, { memberId: 'M1001', accountId: 'S2001', accountType: 'savings', currentBalanceMinor: 125034, currency: 'USD' });
    const f = await service(); const replay = { mode: 'replay', targetId: 'demo-credit-union', capability: { id: artifact.capabilityId, version: 1 }, inputs: { memberId: 'invalid' } };
    expect((await f.call('/v1/runs', replay)).status).toBe(422);
    expect((await f.call('/v1/runs', replay, randomUUID(), 'b'.repeat(64))).status).toBe(404);
    expect((await f.call('/v1/capabilities/runtime-owned-test/versions/1')).status).toBe(200);
    expect((await f.call('/v1/capabilities/runtime-owned-test/versions/2')).status).toBe(404);
    expect((await f.call('/v1/capabilities/runtime-owned-test/versions/1', undefined, randomUUID(), 'b'.repeat(64))).status).toBe(404);
  });
  it('persists an owned intervention, retains the session, blocks capacity, and cancels cleanly', async () => {
    let closes = 0; let location = 'about:blank';
    const factory: SessionFactory = { reconcile: async () => true, open: async (_configuration, created) => {
      const id = randomUUID(); await created(id);
      return { id, surface: { location: async () => location, navigate: async url => { location = url; }, inspect: async () => { throw new Error('No target reads'); }, dispatch: async () => { throw new Error('No mutations'); }, snapshot: async () => ({ schemaVersion:1,kind:'structural-snapshot',redactedValues:true,documents:[],omittedFrames:0 }) }, close: async () => { closes++; return true; } };
    } };
    const f = await service(async (_request, context) => {
      const executor = await context.executor({}); await executor.execute({type:'navigate',destination:'target-entry'},'entry');
      throw new NeedsIntervention({ stepId:null,actionIndex:null,reason:'MANUAL_PREREQUISITE',dispatchState:'not_sent',effectState:'not_checked',checkpointId:null,expected:{code:'READY',description:'Ready'},observed:{code:'HELP',description:'Help requested'},evidenceIds:[] });
    }, factory);
    const accepted=RunAcceptedSchema.parse(await (await f.call('/v1/runs',request)).json());
    await until(async () => (await repository.getRun(accepted.runId)).status === 'waiting_for_human');
    const waiting=await repository.getRun(accepted.runId); expect(closes).toBe(0);expect(waiting.control.owner).toBe('none');
    const route='/v1/interventions/'+waiting.activeInterventionId;
    const response=await f.call(route);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'open',runId:accepted.runId,blocked:{reason:'MANUAL_PREREQUISITE'}});
    expect((await f.call(route,undefined,randomUUID(),'b'.repeat(64))).status).toBe(404);
    expect((await f.call('/v1/runs',request)).status).toBe(409);
    expect((await f.coordinator.repository.state(accepted.runId)).session_state).toBe('live');
    expect((await f.call(accepted.statusUrl+'/cancel',{reason:'USER_REQUESTED'})).status).toBe(202);
    await f.coordinator.idle();expect(closes).toBe(1);expect((await repository.getRun(accepted.runId)).status).toBe('cancelled');
    expect((await f.coordinator.repository.state(accepted.runId)).session_state).toBe('closed');
    expect(await (await f.call(route)).json()).toMatchObject({status:'closed'});
  });

  it('accepts a confirmed negative discovery result without publishing a capability', async () => {
    const f=await service(async(_request,context)=>{await context.record({type:'BUSINESS_OUTCOME',actor:'automation',stepId:'search-member',details:{code:'MEMBER_NOT_FOUND',ruleId:'member-not-found'}});return{kind:'business_outcome',code:'MEMBER_NOT_FOUND',summary:'Verified negative.',evidenceIds:[]};});
    const accepted=RunAcceptedSchema.parse(await(await f.call('/v1/runs',request)).json());await f.coordinator.idle();
    const run=await f.coordinator.read(accepted.runId,'test-operator');expect(run.status).toBe('completed');expect(run.capability).toBeNull();expect(run.result).toMatchObject({kind:'business_outcome',code:'MEMBER_NOT_FOUND'});
    expect((await pool.query('SELECT 1 FROM automation.capabilities WHERE source_discovery_run_id=$1',[run.runId])).rowCount).toBe(0);
  });
  it('rejects an unconfirmed negative discovery result', async()=>{
    const f=await service(async()=>({kind:'business_outcome',code:'MEMBER_NOT_FOUND',summary:'Unconfirmed.',evidenceIds:[]}));
    const accepted=RunAcceptedSchema.parse(await(await f.call('/v1/runs',request)).json());await f.coordinator.idle();expect((await f.coordinator.read(accepted.runId,'test-operator')).result).toMatchObject({kind:'failure',code:'WORKER_FAILED'});
  });

  it('refuses publication when an otherwise typed artifact ignores the requested output contract',async()=>{
    const f=await service(async(_request,context)=>{
      const artifact=JSON.parse(await readFile(new URL('../../examples/primary-savings.contract.json',import.meta.url),'utf8'));
      artifact.sourceDiscoveryRunId=context.runId;
      await context.publish(artifact,{memberId:'M1001',accountId:'S2001',accountType:'savings',currentBalanceMinor:125034,currency:'USD'});
    });
    const accepted=RunAcceptedSchema.parse(await(await f.call('/v1/runs',availableBalanceRequest)).json());await f.coordinator.idle();
    expect((await f.coordinator.read(accepted.runId,'test-operator')).result).toMatchObject({kind:'failure',code:'ARTIFACT_INVALID'});
    expect((await pool.query('SELECT 1 FROM automation.capabilities WHERE source_discovery_run_id=$1',[accepted.runId])).rowCount).toBe(0);
  });

  async function handoffFixture(slow=false,timeoutMs?:number,riskyLabel?:string) {
    const label=(riskyLabel??'Dismiss servicing review') as 'Dismiss servicing review';
    let location='about:blank',resolved=false,changed=false,dispatches=0,continuations=0,opens=0,closes=0;
    let release=()=>{};let started=false;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    const target={scope:{kind:'document' as const},within:[],locator:{kind:'role' as const,role:'button' as const,name:label,exact:true as const},expectedMatches:1 as const};
    const surface={location:async()=>location,navigate:async(url:string)=>{location=url;},
      observe:async()=>({observationId:randomUUID(),fingerprint:(changed?'c':resolved?'b':'a').repeat(64),ready:true,headings:[],fields:[],controls:[{ref:'c1',kind:'click' as const,label,target,enabled:true,filled:false,row:{},matchesInputs:[]}]}),
      inspect:async(value:unknown)=>({count:JSON.stringify(value).includes('Checkpoint')?(resolved?1:0):1,visible:true,enabled:true,editable:false,text:'',value:'',checked:false,tag:'button',name:label,inputType:''}),
      dispatch:async()=>{dispatches++;started=true;if(slow)await pending;resolved=true;},
      snapshot:async()=>({schemaVersion:1,kind:'structural-snapshot',redactedValues:true,documents:[],omittedFrames:0})};
    const factory:SessionFactory={reconcile:async()=>true,open:async(_config,created)=>{opens++;const id=randomUUID();await created(id);return{id,surface,close:async()=>{closes++;return true;}};}};
    const worker:Worker=async(_request,context)=>{
      const executor=await context.executor({checkpoint:{...target,locator:{kind:'role',role:'heading',name:'Checkpoint',exact:true}}});
      await executor.execute({type:'navigate',destination:'target-entry'},'entry');
      await context.intervene!({stepId:'checkpoint',actionIndex:null,reason:'UNEXPECTED_DIALOG',dispatchState:'settled',effectState:'not_checked',checkpointId:'checkpoint',expected:{code:'READY',description:'Checkpoint ready'},observed:{code:'UNEXPECTED_DIALOG',description:'Manual dismissal needed'},evidenceIds:[]},async()=>(await executor.checkConditions([{kind:'visible',target:'checkpoint'}],'resume-check'))[0]===true,timeoutMs);
      continuations++;await context.record({type:'BUSINESS_OUTCOME',actor:'automation',stepId:'done',details:{code:'MEMBER_NOT_FOUND'}});
      return{kind:'business_outcome',code:'MEMBER_NOT_FOUND',summary:'Synthetic coordinator test.',evidenceIds:[]};
    };
    const previous=configuration;
    configuration={...configuration,policy:{...configuration.policy,manualClickNames:['Dismiss servicing review'],...(riskyLabel?{riskyControls:[{name:riskyLabel,effect:'irreversible' as const,treatment:'block' as const}]}:{})}};
    let f:Awaited<ReturnType<typeof service>>;
    try{f=await service(worker,factory);}finally{configuration=previous;}
    const accepted=RunAcceptedSchema.parse(await(await f.call('/v1/runs',request)).json());
    await until(async()=>(await repository.getRun(accepted.runId)).status==='waiting_for_human');
    const run=await repository.getRun(accepted.runId),path='/v1/interventions/'+run.activeInterventionId;
    return{...f,path,id:accepted.runId,run,counts:()=>({dispatches,continuations,opens,closes}),mutate:()=>{changed=true;},release,started:()=>started};
  }
  it('claims exclusively, fences stale requests, records the operator, and resumes the same session once',async()=>{
    const f=await handoffFixture();expect(await(await f.call(f.path+'/context')).json()).toMatchObject({resumable:true});
    expect((await f.call(f.path+'/claim',{expectedControlRevision:f.run.control.revision},randomUUID(),'b'.repeat(64))).status).toBe(404);
    expect((await f.call(f.path+'/observation?revision='+f.run.control.revision,undefined,randomUUID(),'c'.repeat(64))).status).toBe(403);
    const claims=await Promise.all([f.call(f.path+'/claim',{expectedControlRevision:f.run.control.revision}),f.call(f.path+'/claim',{expectedControlRevision:f.run.control.revision})]);
    expect(claims.map(r=>r.status).sort()).toEqual([200,409]);const human=await repository.getRun(f.id);expect(human.control.owner).toBe('human');
    expect((await f.call(f.path+'/observation?revision='+f.run.control.revision)).status).toBe(409);expect(f.counts().continuations).toBe(0);
    const observation=await(await f.call(f.path+'/observation?revision='+human.control.revision)).json();const key=randomUUID();
    const body={expectedControlRevision:human.control.revision,observationId:observation.observationId,action:{type:'click',controlRef:'c1'}};
    expect((await f.call(f.path+'/actions',body,key)).status).toBe(200);expect((await f.call(f.path+'/actions',body,key)).status).toBe(200);expect(f.counts().dispatches).toBe(1);
    expect((await f.call(f.path+'/actions',{...body,action:{type:'click',controlRef:'c2'}},key)).status).toBe(409);
    expect((await f.call(f.path+'/resume',{expectedControlRevision:human.control.revision,resolutionNote:'private-note-must-not-be-retained'})).status).toBe(200);
    await f.coordinator.idle();const completed=await repository.getRun(f.id);expect(completed.status).toBe('completed');expect(f.counts()).toEqual({dispatches:1,continuations:1,opens:1,closes:1});
    const events=await(await f.call('/v1/runs/'+f.id+'/events?limit=200')).json();expect(events.events.some((e:any)=>e.type==='CONTROL_RETURNED'&&e.details.operatorId==='test-operator')).toBe(true);
    expect(events.events.some((e:any)=>e.actor==='human'&&e.type==='ACTION_COMPLETED'&&e.interventionId===f.run.activeInterventionId)).toBe(true);expect(JSON.stringify(events)).not.toContain('private-note');
  });
  it('rejects premature resume, requires a fresh claim, and then allows validated hand-back',async()=>{
    const f=await handoffFixture();await f.call(f.path+'/claim',{expectedControlRevision:f.run.control.revision});let run=await repository.getRun(f.id);
    const old=run.control.revision;expect((await f.call(f.path+'/resume',{expectedControlRevision:old})).status).toBe(409);
    run=await repository.getRun(f.id);expect(run.status).toBe('waiting_for_human');expect(f.counts().continuations).toBe(0);
    expect((await f.call(f.path+'/claim',{expectedControlRevision:old})).status).toBe(409);
    await f.call(f.path+'/claim',{expectedControlRevision:run.control.revision});run=await repository.getRun(f.id);
    const observation=await(await f.call(f.path+'/observation?revision='+run.control.revision)).json();await f.call(f.path+'/actions',{expectedControlRevision:run.control.revision,observationId:observation.observationId,action:{type:'click',controlRef:'c1'}});
    expect((await f.call(f.path+'/resume',{expectedControlRevision:run.control.revision})).status).toBe(200);await f.coordinator.idle();expect(f.counts().continuations).toBe(1);
  });
  it('rejects a changed manual observation without dispatching or losing the claim',async()=>{
    const f=await handoffFixture();await f.call(f.path+'/claim',{expectedControlRevision:f.run.control.revision});const run=await repository.getRun(f.id);
    const observation=await(await f.call(f.path+'/observation?revision='+run.control.revision)).json();f.mutate();
    const result=await f.call(f.path+'/actions',{expectedControlRevision:run.control.revision,observationId:observation.observationId,action:{type:'click',controlRef:'c1'}});
    expect(result.status).toBe(409);expect((await result.json()).error.code).toBe('STALE_OBSERVATION');expect(f.counts().dispatches).toBe(0);expect((await repository.getRun(f.id)).status).toBe('human_controlled');
    await f.call('/v1/runs/'+f.id+'/cancel',{reason:'USER_REQUESTED'});await f.coordinator.idle();
  });
  it('blocks a risky control under operator ownership without dispatching and stops the run conservatively',async()=>{
    const f=await handoffFixture(false,undefined,'Close account');await f.call(f.path+'/claim',{expectedControlRevision:f.run.control.revision});const run=await repository.getRun(f.id);
    const observation=await(await f.call(f.path+'/observation?revision='+run.control.revision)).json();
    const result=await f.call(f.path+'/actions',{expectedControlRevision:run.control.revision,observationId:observation.observationId,action:{type:'click',controlRef:'c1'}});
    expect(result.ok).toBe(false);expect(f.counts().dispatches).toBe(0);
    const events=(await f.coordinator.repository.events(f.id,'test-operator',0,200)).events;
    expect(events.find(event=>event.type==='ACTION_FAILED'&&event.actor==='human')?.details).toMatchObject({code:'RISKY_ACTION_BLOCKED',dispatchState:'not_sent'});
    expect(events.some(event=>event.type==='ACTION_DISPATCHED'&&event.actor==='human')).toBe(false);
    await f.coordinator.idle();const final=await f.coordinator.read(f.id,'test-operator');
    expect(final.status).toBe('failed');expect(final.result).toMatchObject({kind:'failure',code:'RISKY_ACTION_BLOCKED'});expect(f.counts().continuations).toBe(0);
  });
  it('blocks resume during a manual dispatch and preserves uncertainty when cancellation wins',async()=>{
    const f=await handoffFixture(true);await f.call(f.path+'/claim',{expectedControlRevision:f.run.control.revision});const run=await repository.getRun(f.id);
    const observation=await(await f.call(f.path+'/observation?revision='+run.control.revision)).json();
    const manual=f.call(f.path+'/actions',{expectedControlRevision:run.control.revision,observationId:observation.observationId,action:{type:'click',controlRef:'c1'}});
    await until(async()=>f.started());expect((await f.call(f.path+'/resume',{expectedControlRevision:run.control.revision})).status).toBe(409);
    await f.call('/v1/runs/'+f.id+'/cancel',{reason:'USER_REQUESTED'});f.release();await manual;await f.coordinator.idle();
    const cancelled=await repository.getRun(f.id);expect(cancelled.status).toBe('cancelled');expect(cancelled.result).toMatchObject({kind:'cancelled',dispatchState:'unknown',effectState:'unknown'});expect(f.counts().continuations).toBe(0);expect(f.counts().dispatches).toBe(1);
  });

  it('honors a shorter declared intervention deadline and closes its retained session',async()=>{
    const f=await handoffFixture(false,1000);await f.coordinator.idle();
    expect((await repository.getRun(f.id)).result).toMatchObject({kind:'failure',code:'INTERVENTION_TIMEOUT'});expect(f.counts().continuations).toBe(0);expect(f.counts().closes).toBe(1);
  });

});
