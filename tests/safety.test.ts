import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Target } from '@interface-ai/contracts';
import { ObservationSchema } from '../apps/automation/src/workflows/contracts.js';
import { embeddedInstruction } from '../apps/demo-api/src/staff-router.js';

// The model-bound observation is the only page-derived input to the planner. Its text positions accept a closed
// vocabulary, so page-supplied instructions cannot reach the model even if the in-page observer were misled.
const target: Target = { scope: { kind: 'document' }, within: [], locator: { kind: 'role', role: 'button', name: 'Open', exact: true }, expectedMatches: 1 };
const base = () => ({ observationId: randomUUID(), fingerprint: 'a'.repeat(64), ready: true,
  headings: [{ label: 'Account Details', target }],
  controls: [{ ref: 'c1', kind: 'click', label: 'Open', target, enabled: true, filled: false, row: { 'Account Type': 'Primary Savings' }, matchesInputs: [] }],
  fields: [{ ref: 'f1', label: 'Current Balance', region: 'Account Details', target, matchesInputs: [], constant: null }] });

describe('embedded page instructions cannot reach the planner', () => {
  it('accepts the ordinary safe observation', () => { expect(ObservationSchema.safeParse(base()).success).toBe(true); });
  it.each([
    ['heading label', (o: any) => { o.headings[0].label = embeddedInstruction; }],
    ['control label', (o: any) => { o.controls[0].label = embeddedInstruction; }],
    ['row header', (o: any) => { o.controls[0].row = { [embeddedInstruction]: 'Primary' }; }],
    ['row value', (o: any) => { o.controls[0].row = { 'Account Type': embeddedInstruction }; }],
    ['field label', (o: any) => { o.fields[0].label = embeddedInstruction; }],
    ['field region', (o: any) => { o.fields[0].region = embeddedInstruction; }],
    ['field constant', (o: any) => { o.fields[0].constant = embeddedInstruction; }],
    ['extra property', (o: any) => { o.notice = embeddedInstruction; }],
    ['control extra property', (o: any) => { o.controls[0].text = embeddedInstruction; }],
  ])('rejects instruction text in the %s position', (_position, mutate) => {
    const observation = base(); mutate(observation);
    expect(ObservationSchema.safeParse(observation).success).toBe(false);
  });
  it('does not admit the risky control or the instruction\'s wording into the vocabulary', () => {
    const observation = base(); observation.controls[0]!.label = 'Close account';
    expect(ObservationSchema.safeParse(observation).success).toBe(false);
  });
});

describe('model decision summaries in the run log', () => {
  it('records what was chosen in the closed vocabulary and validates as an event', async () => {
    const { decisionSummary } = await import('../apps/automation/src/execution/coordinator.js');
    const { eventSchema } = await import('../apps/automation/src/db/repository.js');
    const observation = base();
    const prepared = { goal: 'g', outputContract: {} as never, inputNames: ['memberId'], observation: observation as never, history: [] };
    const outputs = { memberId: '', currentBalanceMinor: '' };
    const cases = [
      [{ action: 'click', controlRef: 'c1', inputName: '', outputs, reason: 'continue' }, { action: 'click', decisionReason: 'continue', controlLabel: 'Open' }],
      [{ action: 'fill', controlRef: 'c1', inputName: 'memberId', outputs, reason: 'continue' }, { action: 'fill', inputName: 'memberId' }],
      [{ action: 'fill', controlRef: 'c1', inputName: 'not-a-binding', outputs, reason: 'continue' }, { action: 'fill' }],
      [{ action: 'finish', controlRef: '', inputName: '', outputs: { memberId: 'f1', currentBalanceMinor: 'f1' }, reason: 'goal_complete' }, { action: 'finish', decisionReason: 'goal_complete', fieldLabels: ['Current Balance'] }],
      [{ action: 'help', controlRef: 'c99', inputName: '', outputs, reason: 'blocked' }, { action: 'help', decisionReason: 'blocked' }],
    ] as const;
    for (const [decision, expected] of cases) {
      const summary = decisionSummary(prepared, { observationId: observation.observationId, ...decision } as never);
      expect(summary).toMatchObject(expected);
      if (decision.inputName === 'not-a-binding') expect(summary).not.toHaveProperty('inputName');
      if (decision.controlRef === 'c99') expect(summary).not.toHaveProperty('controlLabel');
      expect(eventSchema.safeParse({ type: 'MODEL_COMPLETED', actor: 'automation', stepId: null, details: { code: 'proposed', ...summary } }).success).toBe(true);
    }
    expect(eventSchema.safeParse({ type: 'MODEL_COMPLETED', actor: 'automation', stepId: null, details: { code: 'proposed', controlLabel: embeddedInstruction } }).success).toBe(false);
  });
});
