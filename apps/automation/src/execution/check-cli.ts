import { RunRequestSchema } from '@interface-ai/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from '@interface-ai/postgres';
import type { Target } from '@interface-ai/contracts';
import { AutomationRepository, loadConfigurations } from '../db/repository.js';
import { Coordinator } from './coordinator.js';
import { BrowserbaseSessions } from './provider.js';
import { EvidenceStore } from './evidence.js';
import { readBrowserbaseConfig } from '../browserbase/config.js';

async function main() {
  const currentBalanceRequest=RunRequestSchema.parse(JSON.parse(await readFile(new URL('../../../../examples/discovery-current.json',import.meta.url),'utf8')));
  if(currentBalanceRequest.mode!=='discovery')throw new Error('DISCOVERY_EXAMPLE_REQUIRED');
  const root = process.env.BROWSERBASE_PORTAL_URL?.replace(/\/$/, '');
  const credentials = readBrowserbaseConfig({ ...process.env, BROWSERBASE_FIXTURE_URL: root ? root + '/compatibility' : undefined });
  const url = new URL(credentials.fixtureUrl); url.pathname = '/';
  const initial = await loadConfigurations({ target: new URL('../../config/target.v2.json', import.meta.url), policy: new URL('../../config/policy.v2.json', import.meta.url) });
  const version = Math.floor(Date.now() / 1000);
  const configuration = { target: { ...initial.target, version, entryPoint: url.toString() }, policy: { ...initial.policy, version, allowedOrigins: [url.origin] } };
  if (!process.env.DATABASE_URL || !process.env.REQUEST_FINGERPRINT_KEY) throw new Error('Database configuration required');
  const pool = createPool(process.env.DATABASE_URL);
  const folder = resolve(import.meta.dirname, '../../runtime/int-007-008'); await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(resolve(folder, `target.${version}.json`), JSON.stringify(configuration.target, null, 2) + '\n', { mode: 0o600 });
  await writeFile(resolve(folder, `policy.${version}.json`), JSON.stringify(configuration.policy, null, 2) + '\n', { mode: 0o600 });
  const scope = { kind: 'frame' as const, frames: [{ attribute: 'title' as const, value: 'Member servicing workspace' }] };
  const role = (name: string, kind: 'button' | 'heading' = 'button'): Target => ({ scope, within: [], locator: { kind: 'role', role: kind, name, exact: true }, expectedMatches: 1 });
  const field = (label: string): Target => ({ scope, within: [{ kind: 'container', locator: { kind: 'role', role: 'region', name: 'Account Details', exact: true } }], locator: { kind: 'field', label }, expectedMatches: 1 });
  const row = { kind: 'tableRow' as const, tableCaption: 'Member accounts', cells: [{ columnHeader: 'Account Type', equals: { kind: 'literal' as const, value: 'Primary Savings' } }, { columnHeader: 'Designation', equals: { kind: 'literal' as const, value: 'Primary' } }] };
  const targets: Record<string, Target> = {
    staff: role('Staff workspace', 'heading'), start: role('Start Member Search'), searchHeading: role('Member Search', 'heading'),
    member: { scope, within: [], locator: { kind: 'label', text: 'Member ID', exact: true }, expectedMatches: 1 }, search: role('Search'),
    openA: { ...role('Open'), within: [{ kind: 'tableRow', tableCaption: 'Member search results', cells: [{ columnHeader: 'Member ID', equals: { kind: 'input', name: 'memberId' } }] }] },
    openB: { ...role('Open'), within: [{ kind: 'tableRow', tableCaption: 'Member search results', cells: [{ columnHeader: 'Member ID', equals: { kind: 'input', name: 'otherMemberId' } }] }] },
    overview: role('Member Overview', 'heading'), inquiry: role('Account Inquiry'), inquiryHeading: role('Account Inquiry', 'heading'),
    savingsOpen: { ...role('Open'), within: [row] }, selectedAccount: { scope, within: [row], locator: { kind: 'cell', columnHeader: 'Account ID' }, expectedMatches: 1 },
    details: role('Account Details', 'heading'), memberIdentity: field('Member ID'), accountIdentity: field('Account ID'), current: field('Current Balance'), available: field('Available Balance'),
    type: field('Account Type'), currency: field('Currency'), back: role('Back to Accounts'),
    newSearch: { ...role('Member Search'), scope: { kind: 'document' } }, ambiguousOpen: role('Open'),
  };
  const provider = new BrowserbaseSessions(credentials.apiKey, credentials.projectId);
  const verified: unknown[] = [];
  const base = new AutomationRepository(pool, process.env.REQUEST_FINGERPRINT_KEY);
  const deterministic = { open: (configuration: Parameters<typeof provider.open>[0], created: Parameters<typeof provider.open>[1], signal: AbortSignal) => provider.open(configuration, created, signal, 'replay'), reconcile: (id: string) => provider.reconcile(id) };
  const coordinator = new Coordinator(base, process.env.REQUEST_FINGERPRINT_KEY, configuration, new EvidenceStore(resolve(folder, 'evidence')), deterministic,
    async (_request, context) => {
      const executor = await context.executor(targets); let index = 0;
      const click = (target: string) => executor.execute({ type: 'click', target }, 'check-' + ++index);
      const wait = (target: string) => executor.execute({ type: 'wait', condition: { kind: 'visible', target } }, 'check-' + ++index);
      const read = (target: string, transform: 'trim' | 'usd-minor' | 'savings-type' = 'trim') => executor.execute({ type: 'capture', sourceValue: { target, read: 'text', transform } }, 'check-' + ++index);
      await executor.execute({ type: 'navigate', destination: 'target-entry' }, 'check-' + ++index); await wait('staff'); await click('start'); await wait('searchHeading'); await executor.execute({ type: 'wait', condition: { kind: 'editable', target: 'member' } }, 'check-' + ++index);
      for (const [input, open, memberId, accountId, current, available] of [['memberId', 'openA', 'M1001', 'S2001', 125034, 120034], ['otherMemberId', 'openB', 'M1002', 'S2002', 8765, 7600]] as const) {
        await executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: input } }, 'check-' + ++index);
        await click('search'); await wait(open); await click(open); await wait('overview'); await click('inquiry'); await wait('inquiryHeading'); await wait('savingsOpen');
        const selected = await read('selectedAccount'); await click('savingsOpen'); await wait('details');
        const actual = { memberId: await read('memberIdentity'), accountId: await read('accountIdentity'), type: await read('type', 'savings-type'),
          currency: await read('currency'), currentBalanceMinor: await read('current', 'usd-minor'), availableBalanceMinor: await read('available', 'usd-minor') };
        if (selected !== accountId || actual.memberId !== memberId || actual.accountId !== accountId || actual.type !== 'savings' || actual.currency !== 'USD' || actual.currentBalanceMinor !== current || actual.availableBalanceMinor !== available) throw new Error('Wrong UI values');
        verified.push(actual); await click('back'); await wait('inquiryHeading');
        if (memberId === 'M1001') { await click('newSearch'); await wait('searchHeading'); await executor.execute({ type: 'wait', condition: { kind: 'editable', target: 'member' } }, 'check-' + ++index); }
      }
      // Intentional representative failure: repeated Open buttons must dispatch nothing.
      await click('ambiguousOpen');
      throw new Error('Ambiguous control unexpectedly dispatched');
    });
  try {
    await coordinator.start();
    const accepted = await coordinator.accept({ mode: 'discovery', outputContract: currentBalanceRequest.outputContract, targetId: configuration.target.id, goal: 'Authored shared-executor verification; no discovery model or capability.', inputs: { memberId: 'M1001', otherMemberId: 'M1002' } }, 'demo-operator', randomUUID());
    await coordinator.idle(); const run = await coordinator.read(accepted.runId, 'demo-operator');
    const events = await coordinator.repository.events(run.runId, 'demo-operator', 0, 200);
    const failed = events.events.findLast(event => event.type === 'ACTION_FAILED');
    const evidenceId = typeof failed?.details.evidenceId === 'string' ? failed.details.evidenceId : undefined;
    const evidence = evidenceId ? await coordinator.evidenceFor(run.runId, evidenceId, 'demo-operator') : undefined;
    const ambiguousIntents = events.events.filter(event => event.details.targetRef === 'ambiguousOpen');
    const row = await coordinator.repository.state(run.runId);
    const result = { tasks: ['INT-007', 'INT-008'], kind: 'authored-shared-executor-check', runId: run.runId, configuration: { targetVersion: version, policyVersion: version },
      verified, expectedFailure: run.result, ambiguousDispatchCount: ambiguousIntents.filter(event => event.type === 'ACTION_DISPATCHED').length,
      evidenceId, sessionState: row.session_state, finalProviderStatus: provider.finalStatus, inferenceAttempts: provider.inferenceAttempts, modelMetrics: provider.lastMetrics,
      finishedAt: new Date().toISOString(), success: verified.length === 2 && run.result?.kind === 'failure' && run.result.code === 'AMBIGUOUS_TARGET' && !!evidence
        && row.session_state === 'closed' && provider.finalStatus === 'COMPLETED' && provider.inferenceAttempts === 0 && Object.values(provider.lastMetrics).every(value => value === 0)
        && ambiguousIntents.filter(event => event.type === 'ACTION_DISPATCHED').length === 0 };
    await writeFile(resolve(folder, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    await writeFile(resolve(folder, 'events.json'), JSON.stringify(events, null, 2) + '\n', { mode: 0o600 });
    if (evidence) await writeFile(resolve(folder, 'failure-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    console.info(JSON.stringify(result, null, 2)); if (!result.success) process.exitCode = 1;
  } finally { await coordinator.stop(); await pool.end(); }
}
main().catch(() => { console.error('Executor check failed. Check migrations, server-only credentials, target tunnel, and cleanup status. No raw provider errors were printed.'); process.exitCode = 1; });
