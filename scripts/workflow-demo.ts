import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCapability, RunViewSchema } from '@interface-ai/contracts';
import { readBrowserbaseConfig } from '../apps/automation/src/browserbase/config.js';
import { loadConfigurations } from '../apps/automation/src/db/repository.js';

const folder = resolve(import.meta.dirname, '../apps/automation/runtime/int-009-011');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('PORT_UNAVAILABLE'); const port = address.port; await new Promise<void>(resolve => server.close(() => resolve())); return port; }
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  try { await Promise.race([exited, new Promise<never>((_resolve,reject) => { timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CHILD_CLEANUP_TIMEOUT')); },45_000); })]); }
  finally { clearTimeout(timer); }
}
async function main() {
  for (const key of ['DATABASE_URL', 'REQUEST_FINGERPRINT_KEY', 'AUTOMATION_API_TOKEN', 'BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID']) if (!process.env[key]) throw new Error('CONFIGURATION_REQUIRED');
  const entry = new URL(process.env.BROWSERBASE_PORTAL_URL ?? ''); if (entry.protocol !== 'https:') throw new Error('HTTPS_PORTAL_REQUIRED'); readBrowserbaseConfig({ ...process.env, BROWSERBASE_FIXTURE_URL: new URL('/compatibility',entry).toString() }); entry.pathname = '/'; entry.search = ''; entry.hash = '';
  const initial = await loadConfigurations({ target: new URL('../apps/automation/config/target.v2.json', import.meta.url), policy: new URL('../apps/automation/config/policy.v2.json', import.meta.url) });
  const previous = process.env.WORKFLOW_REPLAY_ONLY === '1' ? JSON.parse(await readFile(resolve(folder,'result.json'),'utf8')) : undefined;
  if (previous && (!previous.success || !previous.runs?.[0]?.capability)) throw new Error('PRIOR_DISCOVERY_REQUIRED');
  const version: number = previous?.configurationVersion ?? Math.floor(Date.now() / 1000);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const targetFile = resolve(folder, `target.${version}.json`); const policyFile = resolve(folder, `policy.${version}.json`);
  if (!previous) await writeFile(targetFile, JSON.stringify({ ...initial.target, version, entryPoint: entry.toString() }, null, 2), { mode: 0o600 });
  if (!previous) await writeFile(policyFile, JSON.stringify({ ...initial.policy, version, allowedOrigins: [entry.origin] }, null, 2), { mode: 0o600 });
  if (previous && JSON.parse(await readFile(targetFile,'utf8')).entryPoint !== entry.toString()) throw new Error('ORIGINAL_BINDING_REQUIRED');
  const reports: any[] = previous ? [previous.runs[0]] : [];
  let reference: { id: string; version: number } | undefined = previous?.runs[0].capability;
  const modes: Array<'discovery' | 'replay'> = previous ? ['replay'] : ['discovery','replay'];
  for (const mode of modes) {
    const port = await freePort();
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/index.ts'], { cwd: resolve(import.meta.dirname, '../apps/automation'), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), AUTOMATION_TARGET_FILE: targetFile, AUTOMATION_POLICY_FILE: policyFile }, stdio: ['ignore', 'ignore', 'pipe'] });
    let startupError = false; child.stderr?.on('data', () => { startupError = true; });
    const origin = `http://127.0.0.1:${port}`;
    const api = async (path: string, body?: unknown) => {
      const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + process.env.AUTOMATION_API_TOKEN, ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('HTTP_' + response.status); return response.json();
    };
    let runId: string | undefined;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) { if ((child.exitCode !== null || child.signalCode !== null)) throw new Error('CHILD_STARTUP_FAILED'); try { const response = await fetch(origin + '/healthz', { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch {} await pause(100); }
      if (!ready) throw new Error('CHILD_NOT_READY');
      const accepted = await api('/v1/runs', mode === 'discovery'
        ? { mode, targetId: initial.target.id, goal: 'Find the current balance and currency of the primary savings account for the member identified by memberId. Verify member and account identity.', inputs: { memberId: 'M1001' } }
        : { mode, targetId: initial.target.id, capability: reference, inputs: { memberId: 'M1002' } });
      runId = accepted.runId;
      const events: any[] = []; let run; let lastLog = 0;
      for (let attempt = 0; attempt < 1000; attempt++) {
        run = RunViewSchema.parse(await api('/v1/runs/' + runId));
        const page = await api(`/v1/runs/${runId}/events?afterSequence=${events.at(-1)?.sequence ?? 0}&limit=200`); events.push(...page.events);
        if (Date.now() - lastLog > 20_000) { console.info(JSON.stringify({ mode, runId, status: run.status, modelCalls: events.filter(event => event.type === 'MODEL_COMPLETED').length, lastEvent: events.at(-1)?.type })); lastLog = Date.now(); }
        if (run.status === 'waiting_for_human') {
          const intervention = await api('/v1/interventions/' + run.activeInterventionId);
          await writeFile(resolve(folder, mode + '-intervention.json'), JSON.stringify(intervention, null, 2), { mode: 0o600 });
          await api(`/v1/runs/${runId}/cancel`, { reason: 'USER_REQUESTED' });
        }
        if (['failed', 'cancelled', 'completed'].includes(run.status) && (events.some(event => event.type === 'SESSION_FINISHED') || (run.result?.kind === 'failure' && ['UNSUPPORTED_GOAL','INVALID_BINDING','POLICY_BLOCKED','SESSION_LOST'].includes(run.result.code) && !events.some(event => event.type === 'ACTION_INTENT')))) break;
        await pause(500);
      }
      if (!run) throw new Error('RUN_UNAVAILABLE');
      const summary = { mode, processId: child.pid, run, events, startupError };
      await writeFile(resolve(folder, mode + '.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
      if (run.result?.kind !== 'success' || run.result.output.availability !== 'available') { console.info(JSON.stringify({ mode, result: run.result })); throw new Error('RUN_NOT_SUCCESSFUL'); }
      const expected = mode === 'discovery' ? { memberId: 'M1001', accountId: 'S2001', accountType: 'savings', currentBalanceMinor: 125034, currency: 'USD' } : { memberId: 'M1002', accountId: 'S2002', accountType: 'savings', currentBalanceMinor: 8765, currency: 'USD' };
      if (JSON.stringify(Object.entries(run.result.output.values).sort()) !== JSON.stringify(Object.entries(expected).sort())) throw new Error('WRONG_OUTPUT');
      const session = events.find(event => event.type === 'SESSION_FINISHED');
      if (session?.details.code !== 'closed') throw new Error('CLEANUP_UNCONFIRMED');
      if (mode === 'discovery') {
        reference = run.result.capability;
        const artifact = parseCapability(await api(`/v1/capabilities/${reference.id}/versions/${reference.version}`));
        if (/M1001|S2001|125034|1,250\.34/.test(JSON.stringify(artifact))) throw new Error('UNPARAMETERIZED_ARTIFACT');
        if (!events.some(event => event.type === 'MODEL_COMPLETED' && event.details.inputTokens > 0)) throw new Error('MODEL_EVIDENCE_MISSING');
        await writeFile(resolve(folder, 'capability.json'), JSON.stringify(artifact, null, 2), { mode: 0o600 });
      } else if (session.details.modelCalls !== 0 || session.details.inferenceAttempts !== 0 || session.details.inputTokens !== 0 || session.details.outputTokens !== 0 || events.some(event => event.type.startsWith('MODEL_'))) throw new Error('REPLAY_INFERENCE_DETECTED');
      reports.push({ mode, processId: child.pid, runId, capability: run.result.capability, output: run.result.output.values, session: session.details });
      console.info(JSON.stringify(reports.at(-1)));
    } finally {
      if (runId) { try { const run = await api('/v1/runs/' + runId); if (!['completed', 'failed', 'cancelled'].includes(run.status)) await api(`/v1/runs/${runId}/cancel`, { reason: 'USER_REQUESTED' }); } catch {} }
      await stop(child);
    }
  }
  if (reports[0]?.processId === reports[1]?.processId) throw new Error('FRESH_PROCESS_REQUIRED');
  const result = { tasks: ['INT-009', 'INT-010', 'INT-011'], finishedAt: new Date().toISOString(), configurationVersion: version, runs: reports, success: true };
  await writeFile(resolve(folder, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 }); console.info(JSON.stringify(result, null, 2));
}
main().catch(error => { const code = error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'VALIDATION_FAILED'; console.error('Workflow check stopped: ' + code + '. Inspect the private runtime reports.'); process.exitCode = 1; });
