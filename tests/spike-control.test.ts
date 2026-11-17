import { describe, expect, it, vi } from 'vitest';
import { assertFreshObservation, ControlConflict, SpikeControl } from '../apps/automation/src/browserbase/spike-control.js';
import { actionSchema, parameterizeFill, usdMinor, verifiedBalance } from '../apps/automation/src/browserbase/fixture-ui.js';

describe('spike ownership boundary', () => {
  it('blocks automation throughout human control and stale human input after hand-back', async () => {
    const gate = new SpikeControl();
    const dispatch = vi.fn(async () => {});
    const paused = gate.pause(1);
    const claimed = gate.claim(paused);
    await expect(gate.dispatch('automation', claimed, dispatch)).rejects.toBeInstanceOf(ControlConflict);
    expect(dispatch).not.toHaveBeenCalled();
    await gate.dispatch('human', claimed, dispatch);
    const resumed = await gate.resume(claimed, async () => true);
    await expect(gate.dispatch('human', claimed, dispatch)).rejects.toBeInstanceOf(ControlConflict);
    await gate.dispatch('automation', resumed, dispatch);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it('rejects competing dispatch and ownership changes while an action is in flight', async () => {
    const gate = new SpikeControl();
    let finish!: () => void;
    const running = gate.dispatch('automation', 1, () => new Promise<void>((resolve) => { finish = resolve; }));
    const competitor = vi.fn(async () => {});
    expect(() => gate.pause(1)).toThrow(ControlConflict);
    await expect(gate.dispatch('automation', 1, competitor)).rejects.toBeInstanceOf(ControlConflict);
    expect(competitor).not.toHaveBeenCalled();
    finish(); await running;
    expect(gate.pause(1)).toBe(2);
  });
  it('closes human admission before asynchronous resume validation completes', async () => {
    const gate = new SpikeControl();
    gate.pause(1); const revision = gate.claim(2);
    let finish!: (valid: boolean) => void;
    const resuming = gate.resume(revision, () => new Promise<boolean>((resolve) => { finish = resolve; }));
    const dispatch = vi.fn(async () => {});
    await expect(gate.dispatch('human', revision, dispatch)).rejects.toBeInstanceOf(ControlConflict);
    await expect(gate.dispatch('automation', gate.snapshot().revision, dispatch)).rejects.toBeInstanceOf(ControlConflict);
    finish(true); await resuming;
    expect(dispatch).not.toHaveBeenCalled();
    expect(gate.snapshot().owner).toBe('automation');
  });
  it('requires a new claim after failed resume validation and never silently resumes', async () => {
    const gate = new SpikeControl(); gate.pause(1); const old = gate.claim(2);
    await expect(gate.resume(old, async () => false)).rejects.toBeInstanceOf(ControlConflict);
    expect(gate.snapshot().owner).toBe('none');
    expect(() => gate.claim(old)).toThrow(ControlConflict);
    expect(gate.claim(gate.snapshot().revision)).toBeGreaterThan(old);
  });
  it('releases the action slot after a failed operation but rejects all input after close', async () => {
    const gate = new SpikeControl();
    await expect(gate.dispatch('automation', 1, async () => { throw new Error('operation failed'); })).rejects.toThrow('operation failed');
    expect(gate.snapshot().busy).toBe(false);
    gate.close();
    const dispatch = vi.fn(async () => {});
    await expect(gate.dispatch('automation', gate.snapshot().revision, dispatch)).rejects.toBeInstanceOf(ControlConflict);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('observed manual control freshness', () => {
  const observation = { id: 'view-1', revision: 3, createdAt: 1000, fingerprint: 'member=M1001' };
  it('accepts a fresh matching view', () => {
    expect(() => assertFreshObservation(observation, { observationId: 'view-1', revision: 3 }, 'member=M1001', 2000)).not.toThrow();
  });
  it.each([
    ['view-2', 3, 'member=M1001', 2000], ['view-1', 2, 'member=M1001', 2000],
    ['view-1', 3, 'member=M1002', 2000], ['view-1', 3, 'member=M1001', 61_001],
  ] as const)('rejects changed view, revision, context, or age', (observationId, revision, fingerprint, now) => {
    expect(() => assertFreshObservation(observation, { observationId, revision }, fingerprint, now)).toThrow(ControlConflict);
  });
});

describe('spike descriptors and rendered balance checks', () => {
  const fill = { selector: 'iframe >> input[name="memberId"]', description: 'Fill Member ID', method: 'fill', arguments: ['M1001'] };
  it('round-trips a data-only fill descriptor and binds changed input without mutating the saved value', () => {
    const saved = actionSchema.parse(JSON.parse(JSON.stringify(fill)));
    const replay = parameterizeFill(saved, 'M1002');
    expect(replay.arguments).toEqual(['M1002']);
    expect(saved.arguments).toEqual(['M1001']);
  });
  it('rejects unsupported executable methods and arbitrary extra properties', () => {
    expect(() => actionSchema.parse({ ...fill, method: 'evaluate' })).toThrow();
    expect(() => actionSchema.parse({ ...fill, code: 'arbitrary script' })).toThrow();
    expect(() => parameterizeFill({ ...fill, method: 'click' }, 'M1002')).toThrow();
  });
  it('converts current and available balances separately using integer minor units', () => {
    const state = { heading: 'Account Details', memberId: 'M1002', input: '', rows: [], details: {
      'Account ID': 'S2002', 'Account Type': 'Primary Savings', Status: 'Active', 'Current Balance': '$87.65', 'Available Balance': '$76.00',
    } };
    expect(verifiedBalance(state, 'M1002', 'S2002')).toMatchObject({ currentBalanceMinor: 8765, availableBalanceMinor: 7600 });
    expect(() => verifiedBalance(state, 'M1001', 'S2001')).toThrow('Wrong member');
    expect(usdMinor('$1,250.34')).toBe(125034);
    expect(() => usdMinor('$1,25.34')).toThrow();
  });
});
