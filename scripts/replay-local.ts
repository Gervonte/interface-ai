import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCapability } from '@interface-ai/contracts';
import { loadConfigurations } from '../apps/automation/src/db/repository.js';
import { openLocalBrowser } from '../apps/automation/src/execution/local-browser.js';
import { replayLocally } from '../apps/automation/src/execution/local-replay.js';
import { scenarioNames } from '../apps/demo-api/src/scenarios.js';

// Model-free replay of a saved capability against the locally served portal, in a local Chrome.
// Needs no Browserbase account, tunnel, model key or automation database.
const root = resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({ options: {
  capability: { type: 'string', default: 'evidence/capability.json' },
  member: { type: 'string', default: 'M1002' },
  scenario: { type: 'string', default: 'baseline' },
  headful: { type: 'boolean', default: false },
} });

async function main() {
  if (!(scenarioNames as readonly string[]).includes(args.scenario!)) throw Error('UNKNOWN_SCENARIO');
  const capability = parseCapability(JSON.parse(await readFile(resolve(root, args.capability!), 'utf8')));
  const configuration = await loadConfigurations({ target: new URL('../apps/automation/config/target.v3.json', import.meta.url), policy: new URL('../apps/automation/config/policy.v5.json', import.meta.url) });
  let reachable = false;
  try { const health = await fetch(new URL('/healthz', configuration.target.entryPoint), { signal: AbortSignal.timeout(5000) }); reachable = health.ok && (await health.json()).service === 'demo-target'; } catch { /* not running */ }
  if (!reachable) throw Error('PORTAL_NOT_RUNNING');
  // The portal reads its scenario when a new staff session starts.
  const scenarioDir = resolve(root, 'apps/demo-api/runtime'); await mkdir(scenarioDir, { recursive: true, mode: 0o700 });
  const setScenario = (name: string) => writeFile(resolve(scenarioDir, 'scenario.json'), JSON.stringify({ name, delayMs: 1000, failuresBeforeSuccess: 1 }), { mode: 0o600 });
  await setScenario(args.scenario!);
  const folder = resolve(root, 'apps/automation/runtime/local-replay'); await mkdir(folder, { recursive: true, mode: 0o700 });
  const abort = new AbortController(); process.once('SIGINT', () => abort.abort());
  console.info(JSON.stringify({ step: 'local-replay', capability: { id: capability.capabilityId, version: capability.version, name: capability.name }, member: args.member, scenario: args.scenario, target: configuration.target.entryPoint }));
  try {
    const record = await replayLocally(capability, { memberId: args.member! }, { configuration, evidenceDirectory: resolve(folder, 'evidence'), signal: abort.signal,
      openSurface: () => openLocalBrowser(configuration, { headless: !args.headful, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) }) });
    const file = resolve(folder, record.runId + '.json');
    await writeFile(file, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    console.info(JSON.stringify({ step: 'result', runId: record.runId, result: record.result, modelCalls: record.modelCalls, inferenceAttempts: record.inferenceAttempts, browserClosed: record.browserClosed }));
    console.info('Run record: ' + file);
    if (record.result.kind === 'failure' || record.inferenceAttempts !== 0 || !record.browserClosed) process.exitCode = 1;
  } finally { await setScenario('baseline'); }
}
main().catch(error => { const code = error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'LOCAL_REPLAY_FAILED';
  console.error('Local replay stopped: ' + code + (code === 'PORTAL_NOT_RUNNING' ? '. Start the portal with pnpm demo:serve.' : '.')); process.exitCode = 1; });
