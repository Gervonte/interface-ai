import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCapability, RunRequestSchema, RunViewSchema } from '@interface-ai/contracts';
import { loadConfigurations } from '../apps/automation/src/db/repository.js';

// Reviewer demo: goal -> live model-driven discovery -> saved capability -> model-free replay for another member ->
// model-free replay that meets a business outcome. Each run uses its own automation API process and browser session.
const root = resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({ options: {
  request: { type: 'string', default: 'examples/discovery-current.json' },
  'replay-member': { type: 'string', default: 'M1002' },
  'missing-member': { type: 'string', default: 'M9999' },
} });
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = true; });
const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status);
function check(condition: unknown, code: string): asserts condition { if (!condition) throw Error(code); }
async function assertPortFree() {
  const server = createServer(); await new Promise<void>((ok, fail) => {
    server.once('error', () => fail(Error('API_PORT_IN_USE'))); server.listen(3001, '127.0.0.1', () => server.close(error => error ? fail(Error('API_PORT_IN_USE')) : ok()));
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); let timer: ReturnType<typeof setTimeout> | undefined; child.kill('SIGTERM');
  try { await Promise.race([exited, new Promise<never>((_ok, fail) => { timer = setTimeout(() => { child.kill('SIGKILL'); fail(Error('CLEANUP_TIMEOUT')); }, 45000); })]); } finally { clearTimeout(timer); }
}

async function main() {
  for (const key of ['DATABASE_URL', 'REQUEST_FINGERPRINT_KEY', 'AUTOMATION_API_TOKEN', 'BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID']) if (!process.env[key]) throw Error('CONFIGURATION_REQUIRED');
  const entry = new URL(process.env.BROWSERBASE_PORTAL_URL ?? '');
  if (entry.protocol !== 'https:' || entry.pathname !== '/' || entry.search || entry.hash || entry.username || entry.password) throw Error('HTTPS_PORTAL_ROOT_REQUIRED');
  const health = await fetch(new URL('/healthz', entry), { signal: AbortSignal.timeout(10000) });
  if (!health.ok || (await health.json()).service !== 'demo-target') throw Error('TARGET_UNREACHABLE');
  const request = RunRequestSchema.parse(JSON.parse(await readFile(resolve(root, args.request!), 'utf8')));
  check(request.mode === 'discovery', 'DISCOVERY_REQUEST_REQUIRED');
  await assertPortFree();
  // Always start from the ordinary portal state.
  const scenarioDir = resolve(root, 'apps/demo-api/runtime'); await mkdir(scenarioDir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(scenarioDir, 'scenario.json'), JSON.stringify({ name: 'baseline', delayMs: 0, failuresBeforeSuccess: 1 }), { mode: 0o600 });

  // Freeze one configuration version bound to this tunnel; every run below uses it.
  const initial = await loadConfigurations({ target: new URL('../apps/automation/config/target.v3.json', import.meta.url), policy: new URL('../apps/automation/config/policy.v5.json', import.meta.url) });
  const version = Math.floor(Date.now() / 1000), folder = resolve(root, 'apps/automation/runtime/demo', String(version));
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const targetFile = resolve(folder, 'target.json'), policyFile = resolve(folder, 'policy.json');
  await writeFile(targetFile, JSON.stringify({ ...initial.target, version, entryPoint: entry.toString() }), { mode: 0o600 });
  await writeFile(policyFile, JSON.stringify({ ...initial.policy, version, allowedOrigins: [entry.origin] }), { mode: 0o600 });
  await writeFile(resolve(folder, 'request.json'), JSON.stringify(request, null, 2) + '\n', { mode: 0o600 });

  const run = async (name: string, body: unknown) => {
    if (interrupted) throw Error('DEMO_INTERRUPTED'); await assertPortFree();
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/index.ts'], { cwd: resolve(root, 'apps/automation'),
      env: { ...process.env, HOST: '127.0.0.1', PORT: '3001', AUTOMATION_TARGET_FILE: targetFile, AUTOMATION_POLICY_FILE: policyFile }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr?.on('data', () => {});
    const api = async (path: string, payload?: unknown) => {
      const response = await fetch('http://127.0.0.1:3001' + path, { headers: { Authorization: 'Bearer ' + process.env.AUTOMATION_API_TOKEN,
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }) }, ...(payload === undefined ? {} : { method: 'POST', body: JSON.stringify(payload) }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error('HTTP_' + response.status); return response.json();
    };
    let runId: string | undefined;
    try {
      let ready = false; for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw Error('API_STARTUP_FAILED'); try { await api('/healthz'); ready = true; break; } catch { /* starting */ } await delay(100); }
      check(ready, 'API_NOT_READY');
      runId = (await api('/v1/runs', body)).runId as string; console.info(JSON.stringify({ step: name, runId, status: 'started' }));
      const events: any[] = []; let view; let lastLog = 0;
      for (let i = 0; i < 2400; i++) {
        if (interrupted) throw Error('DEMO_INTERRUPTED'); view = RunViewSchema.parse(await api('/v1/runs/' + runId));
        events.push(...(await api(`/v1/runs/${runId}/events?afterSequence=${events.at(-1)?.sequence ?? 0}&limit=200`)).events);
        if (view.activeInterventionId) console.info(JSON.stringify({ step: name, runId, status: view.status, note: 'Human help requested. Start pnpm dev:operator and follow docs/HANDOFF.md.' }));
        if (terminal(view.status) && events.some(event => event.type === 'SESSION_FINISHED')) break;
        if (Date.now() - lastLog > 20000) { console.info(JSON.stringify({ step: name, runId, status: view.status, modelCalls: events.filter(e => e.type === 'MODEL_COMPLETED').length })); lastLog = Date.now(); }
        await delay(500);
      }
      check(view && terminal(view.status), 'RUN_UNFINISHED');
      const record = { processId: child.pid, run: view, events };
      await writeFile(resolve(folder, name + '.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      return { ...record, api };
    } catch (error) { if (runId) { try { await api(`/v1/runs/${runId}/cancel`, { reason: 'USER_REQUESTED' }); } catch { /* best effort */ } } throw error; }
    finally { await stop(child); }
  };

  // 1. Discovery: the model operates the live portal toward the goal and the system saves a capability.
  const discovery = await run('discovery', { ...request, targetId: initial.target.id });
  check(discovery.run.result?.kind === 'success', 'DISCOVERY_DID_NOT_SUCCEED');
  const reference = discovery.run.result.capability;
  // Fetch the saved artifact through a short-lived API process, exactly as a caller would.
  const capability = await (async () => {
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/index.ts'], { cwd: resolve(root, 'apps/automation'),
      env: { ...process.env, HOST: '127.0.0.1', PORT: '3001', AUTOMATION_TARGET_FILE: targetFile, AUTOMATION_POLICY_FILE: policyFile }, stdio: ['ignore', 'ignore', 'ignore'] });
    try {
      for (let i = 0; i < 100; i++) {
        try { const response = await fetch(`http://127.0.0.1:3001/v1/capabilities/${reference.id}/versions/${reference.version}`, { headers: { Authorization: 'Bearer ' + process.env.AUTOMATION_API_TOKEN } }); if (response.ok) return parseCapability(await response.json()); } catch { /* starting */ }
        await delay(100);
      }
      throw Error('CAPABILITY_UNAVAILABLE');
    } finally { await stop(child); }
  })();
  await writeFile(resolve(folder, 'capability.json'), JSON.stringify(capability, null, 2) + '\n', { mode: 0o600 });
  console.info(JSON.stringify({ step: 'discovery', capability: reference, outputs: discovery.run.result.output.availability === 'available' ? discovery.run.result.output.values : 'not_retained',
    modelCalls: discovery.events.filter(e => e.type === 'MODEL_COMPLETED').length }));

  // 2. Replay the exact saved version for a different member. Replay refuses model inference.
  const replay = await run('replay', { mode: 'replay', targetId: initial.target.id, capability: reference, inputs: { memberId: args['replay-member'] } });
  check(replay.run.result?.kind === 'success', 'REPLAY_DID_NOT_SUCCEED');
  // 3. Replay the same version for a member the portal does not have: a business outcome, not a failure.
  const notFound = await run('replay-not-found', { mode: 'replay', targetId: initial.target.id, capability: reference, inputs: { memberId: args['missing-member'] } });
  check(notFound.run.result?.kind === 'business_outcome', 'NOT_FOUND_OUTCOME_MISSING');
  for (const replayed of [replay, notFound]) {
    const session = replayed.events.find(e => e.type === 'SESSION_FINISHED')?.details;
    check(!replayed.events.some(e => e.type.startsWith('MODEL_')) && session?.modelCalls === 0 && session.inferenceAttempts === 0, 'REPLAY_USED_MODEL');
  }
  const summary = { configurationVersion: version, request: args.request, capability: reference,
    discovery: { runId: discovery.run.runId, processId: discovery.processId, result: discovery.run.result },
    replay: { runId: replay.run.runId, processId: replay.processId, input: args['replay-member'], result: replay.run.result },
    replayNotFound: { runId: notFound.run.runId, processId: notFound.processId, input: args['missing-member'], result: notFound.run.result }, finishedAt: new Date().toISOString() };
  await writeFile(resolve(folder, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
  console.info(JSON.stringify({ step: 'replay', input: args['replay-member'], result: replay.run.result }));
  console.info(JSON.stringify({ step: 'replay-not-found', input: args['missing-member'], result: notFound.run.result }));
  console.info('Demo complete. Private run records: ' + folder);
}
main().catch(error => { const code = error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'DEMO_FAILED'; console.error('Demo stopped: ' + code + '. Inspect private run records under apps/automation/runtime/demo/.'); process.exitCode = 1; });
