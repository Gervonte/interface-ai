import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { RunAcceptedSchema, RunViewSchema } from '@interface-ai/contracts';
let phase = 'configuration';
async function main() {
  const token = process.env.AUTOMATION_API_TOKEN; if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Configure authentication first');
  const port = Number(process.env.PORT ?? 3001); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const base = `http://127.0.0.1:${port}`;
  phase = 'authentication';
  const unauthorized = await fetch(base + '/v1/runs/' + randomUUID(), { signal: AbortSignal.timeout(5000) });
  if (unauthorized.status !== 401) throw new Error('Authentication boundary failed');
  const key = randomUUID(); const request = { mode: 'discovery', targetId: 'demo-credit-union', goal: 'Check run acceptance and lifecycle.', inputs: { memberId: 'M1001' } };
  const create = () => fetch(base + '/v1/runs', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(request), signal: AbortSignal.timeout(5000) });
  phase = 'acceptance';
  const response = await create(); if (response.status !== 202) throw new Error('Acceptance failed');
  const accepted = RunAcceptedSchema.parse(await response.json()); phase = 'deduplication'; const repeat = await create();
  if (repeat.status !== 202 || RunAcceptedSchema.parse(await repeat.json()).runId !== accepted.runId) throw new Error('Request deduplication failed');
  phase = 'polling';
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(base + accepted.statusUrl, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Read failed'); const run = RunViewSchema.parse(await response.json());
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      console.info(JSON.stringify({ accepted: true, authenticationRequired: true, deduplicated: true, runId: run.runId, status: run.status, result: run.result }));
      if (run.result?.kind !== 'failure' || run.result.code !== 'DISCOVERY_NOT_IMPLEMENTED') throw new Error('Unexpected current milestone result');
      return;
    }
    await delay(100);
  }
  throw new Error('Run did not settle');
}
main().catch(() => { console.error(`API smoke check failed at ${phase}. Check configuration, startup, and run/session capacity. No credentials were printed.`); process.exitCode = 1; });
