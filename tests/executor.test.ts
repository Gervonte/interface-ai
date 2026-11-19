import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DEFAULT_RUNTIME_BUDGETS } from '@interface-ai/contracts';
import type { Target } from '@interface-ai/contracts';
import type { StoredEventInput } from '../apps/automation/src/db/repository.js';
import type { BrowserSurface, TargetState } from '../apps/automation/src/execution/surface.js';
import { DispatchGate } from '../apps/automation/src/execution/gate.js';
import { Executor, transform } from '../apps/automation/src/execution/executor.js';
import { EvidenceStore } from '../apps/automation/src/execution/evidence.js';
import { ExecutionError } from '../apps/automation/src/execution/errors.js';
import { parseRequestJson } from '../apps/automation/src/execution/json.js';

const target: Target = { scope: { kind: 'document' }, within: [], locator: { kind: 'label', text: 'Member ID', exact: true }, expectedMatches: 1 };
const validState: TargetState = { count: 1, visible: true, enabled: true, editable: true, text: 'M1001', value: '', checked: false, tag: 'input', name: 'Member ID', inputType: 'text' };
const snapshot = { schemaVersion: 1, kind: 'structural-snapshot', redactedValues: true, omittedFrames: 0,
  documents: [{ depth: 0, headings: [{ kind: 'h1', label: 'Member Search' }], controls: [{ kind: 'input', label: 'Member ID', enabled: true }], tables: [] }] };
async function fixture(overrides: Partial<BrowserSurface> = {}, maxActions = 100) {
  let dispatched = 0; const events: StoredEventInput[] = []; const gate = new DispatchGate(2); const abort = new AbortController();
  const folder = await mkdtemp(tmpdir() + '/executor-evidence-'); const runId = randomUUID();
  const surface: BrowserSurface = { location: async () => 'https://portal.example/', inspect: async () => validState,
    dispatch: async () => { dispatched++; }, navigate: async () => { dispatched++; }, snapshot: async () => snapshot, ...overrides };
  const executor = new Executor({ runId, entryPoint: 'https://portal.example/', surface, gate, signal: abort.signal, revision: 2,
    policy: { allowedOrigins: ['https://portal.example'], allowedClickNames: ['Open'], allowedFillNames: ['Member ID'], allowedActions: ['navigate', 'click', 'fill', 'wait', 'capture'], budgets: { ...DEFAULT_RUNTIME_BUDGETS, maxActions } },
    targets: { member: target }, inputs: { memberId: 'synthetic-private-marker' }, authorize: async () => {}, record: async event => { events.push(event); }, evidence: new EvidenceStore(folder) });
  return { executor, gate, abort, events, folder, runId, dispatched: () => dispatched };
}
describe('shared executor dispatch boundary', () => {
  it('checks uniqueness/actionability and dispatches one bound fill without retaining its value', async () => {
    let value: string | undefined; const fixtureValue = await fixture({ dispatch: async (_type, _target, _policy, input) => { value = input; } });
    await fixtureValue.executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'memberId' } }, 'fill-member');
    expect(value).toBe('synthetic-private-marker'); expect(fixtureValue.events.map(event => event.type)).toEqual(['ACTION_INTENT', 'ACTION_DISPATCHED', 'ACTION_COMPLETED']);
    expect(JSON.stringify(fixtureValue.events)).not.toContain('synthetic-private-marker');
  });
  it.each([0, 2])('dispatches nothing with %i target matches', async count => {
    const f = await fixture({ inspect: async () => ({ ...validState, count }) });
    await expect(f.executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'memberId' } }, 'fill-member')).rejects.toMatchObject({ code: count ? 'AMBIGUOUS_TARGET' : 'TARGET_NOT_FOUND', dispatchState: 'not_sent' });
    expect(f.dispatched()).toBe(0);
    const id = f.events.at(-1)?.details.evidenceId; expect(id).toBeTruthy();
    const artifact = await new EvidenceStore(f.folder).read(f.runId, id!); expect(artifact.snapshot.documents[0]?.headings[0]?.label).toBe('Member Search');
  });
  it.each(['visible', 'enabled', 'editable'] as const)('rejects a target that is not %s', async property => {
    const f = await fixture({ inspect: async () => ({ ...validState, [property]: false }) });
    await expect(f.executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'memberId' } }, 'fill-member')).rejects.toMatchObject({ code: 'TARGET_NOT_ACTIONABLE' }); expect(f.dispatched()).toBe(0);
  });
  it('blocks disallowed origins, unsafe control names, and unbound inputs before mutation', async () => {
    for (const surface of [{ location: async () => 'https://foreign.example/private-marker' }, { inspect: async () => ({ ...validState, name: 'Save' }) }]) {
      const f = await fixture(surface); await expect(f.executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'memberId' } }, 'fill-member')).rejects.toMatchObject({ code: 'POLICY_BLOCKED' }); expect(f.dispatched()).toBe(0);
    }
    const f = await fixture(); await expect(f.executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'missing' } }, 'fill-member')).rejects.toMatchObject({ code: 'INVALID_BINDING' }); expect(f.dispatched()).toBe(0);
  });
  it('does not retry a command that may have applied before the driver failed', async () => {
    let dispatches = 0; const f = await fixture({ dispatch: async () => { dispatches++; throw new Error('provider-secret-marker'); } });
    await expect(f.executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'memberId' } }, 'fill-member')).rejects.toMatchObject({ code: 'ACTION_OUTCOME_UNKNOWN', dispatchState: 'unknown', effectState: 'unknown' });
    await expect(f.executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'memberId' } }, 'repeat')).rejects.toMatchObject({ code: 'CONTROL_CHANGED' });
    expect(dispatches).toBe(1); expect(JSON.stringify(f.events)).not.toContain('provider-secret-marker');
  });
  it('preserves definitive no-dispatch rejection from the atomic browser guard', async () => {
    const f = await fixture({ dispatch: async () => { throw new ExecutionError('AMBIGUOUS_TARGET', 'not_sent', 'not_applied'); } });
    await expect(f.executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'memberId' } }, 'fill-member')).rejects.toMatchObject({ dispatchState: 'not_sent', effectState: 'not_applied' });
  });
  it('keeps an aborted in-flight command occupied until its actual promise settles', async () => {
    let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture({ dispatch: async () => { started(); await pending; } });
    const action = f.executor.execute({ type: 'fill', target: 'member', value: { kind: 'input', name: 'memberId' } }, 'fill-member');
    await ready; f.abort.abort(); await expect(action).rejects.toMatchObject({ code: 'ACTION_OUTCOME_UNKNOWN' });
    expect(f.gate.snapshot()).toMatchObject({ busy: true, closed: true }); expect(await f.gate.drain(10)).toBe(false);
    release(); expect(await f.gate.drain(100)).toBe(true); expect(f.events.some(event => event.type === 'ACTION_COMPLETED')).toBe(false);
  });
  it('stops a bounded wait without dispatching a mutation', async () => {
    const f = await fixture({ inspect: async () => ({ ...validState, count: 0 }) }); const started = Date.now();
    await expect(f.executor.execute({ type: 'wait', condition: { kind: 'visible', target: 'member' } }, 'wait-member', 100)).rejects.toMatchObject({ code: 'STATE_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1000); expect(f.dispatched()).toBe(0);
  });
  it('does not hide an evaluation error behind a true branch', async () => {
    const f = await fixture();
    await expect(f.executor.execute({ type: 'wait', condition: { kind: 'any', conditions: [{ kind: 'present', target: 'member' }, { kind: 'present', target: 'missing' }] } }, 'check-all')).rejects.toMatchObject({ code: 'INVALID_BINDING' });
  });
  it('enforces cumulative action budgets', async () => {
    const f = await fixture({}, 1); await f.executor.execute({ type: 'capture', sourceValue: { target: 'member', read: 'text', transform: 'identity' } }, 'first');
    await expect(f.executor.execute({ type: 'capture', sourceValue: { target: 'member', read: 'text', transform: 'identity' } }, 'second')).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
  });
  it('suppresses unexpected snapshot content before writing any file', async () => {
    const f = await fixture({ snapshot: async () => ({ ...snapshot, private: 'secret-marker' }) });
    await expect(f.executor.execute({ type: 'capture', sourceValue: { target: 'missing', read: 'text', transform: 'identity' } }, 'failure')).rejects.toBeInstanceOf(ExecutionError);
    expect(await readdir(f.folder)).toEqual([]); expect(JSON.stringify(f.events)).not.toContain('secret-marker');
  });
  it('stores only permitted structure and rejects expired evidence', async () => {
    const f = await fixture(); const store = new EvidenceStore(f.folder); const id = await store.capture(f.runId, 'failed-step', { snapshot: async () => snapshot },
      { allowedOrigins: ['https://portal.example'], allowedClickNames: ['Open'], allowedFillNames: ['Member ID'] });
    const saved = await readFile(f.folder + '/' + f.runId + '/' + id + '.json', 'utf8'); expect(saved).not.toContain('synthetic-private-marker');
    await expect(new EvidenceStore(f.folder, () => Date.now() + 86_400_001).read(f.runId, id)).rejects.toMatchObject({ code: 'EVIDENCE_UNAVAILABLE' });
  });
});
describe('control gate', () => {
  it('rejects stale and concurrent dispatch without invoking their callbacks', async () => {
    const gate = new DispatchGate(4); let release!: () => void; let calls = 0;
    const first = gate.dispatch(4, async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); }); await Promise.resolve();
    await expect(gate.dispatch(3, async () => { calls++; })).rejects.toMatchObject({ code: 'CONTROL_CHANGED' });
    await expect(gate.dispatch(4, async () => { calls++; })).rejects.toMatchObject({ code: 'ACTION_IN_FLIGHT' }); release(); await first; expect(calls).toBe(1);
  });
});
describe('strict values and JSON transport', () => {
  it.each([['$1,250.34', 125034], ['$0.01', 1], ['$87.65', 8765]])('parses %s using integer minor units', (value, expected) => expect(transform(value as string, 'usd-minor')).toBe(expected));
  it.each(['1250.34', '$1,25.34', '$-1.00', '$1.2', '$90071992547409.92'])('rejects invalid/unsafe USD %s', value => expect(() => transform(value, 'usd-minor')).toThrow());
  it.each(['01', '1.2', ' 1', '9007199254740992'])('rejects noncanonical/unsafe integer %s', value => expect(() => transform(value, 'integer')).toThrow());
  it('checks exact savings types and booleans', () => { expect(transform('Primary Savings', 'savings-type')).toBe('savings'); expect(transform(true, 'identity')).toBe(true); expect(() => transform('Checking', 'savings-type')).toThrow(); });
  it.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"inputs":{"memberId":"x","memberId":"y"}}', '{"__proto__":{}}'])('rejects ambiguous JSON', text => expect(() => parseRequestJson(text)).toThrow());
  it('accepts ordinary nested JSON with escaped quotes and independent object keys', () => expect(parseRequestJson('{"a":[{"x":"a\\\"b"},{"x":2}],"b":true}')).toEqual({ a: [{ x: 'a"b' }, { x: 2 }], b: true }));
});
