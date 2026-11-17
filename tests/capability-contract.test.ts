import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CapabilitySchema, DataSchemaSchema, isBoundedJson, parseCapability, validateCapabilityResult, validateData, validateInvocation, validateOutput, validateReplayRequest } from '@interface-ai/contracts';
import type { Capability, Predicate } from '@interface-ai/contracts';

const sample = JSON.parse(readFileSync(new URL('../examples/primary-savings.contract.json', import.meta.url), 'utf8')) as Capability;
const fixture = () => structuredClone(sample);
const input = { kind: 'input', name: 'memberId' } as const;
const interventionId = '22222222-2222-4222-8222-222222222222';

describe('complete capability contract', () => {
  it('round-trips the authored full-portal contract fixture as JSON without hidden defaults', () => {
    const parsed = parseCapability(fixture());
    expect(parsed).toEqual(sample);
    expect(parseCapability(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(parsed.steps).toHaveLength(7);
    expect(parsed.successCondition.identity).toEqual([{ target: 'detailsMemberId', input: 'memberId' }]);
  });
  it('validates actual invocation values, including changed inputs', () => {
    expect(validateInvocation(fixture(), { memberId: 'M1001' })).toEqual({ memberId: 'M1001' });
    expect(validateInvocation(fixture(), { memberId: 'M1002' })).toEqual({ memberId: 'M1002' });
  });
  it('validates actual replay requests and results against the referenced artifact', () => {
    const cap = fixture(); const capability = { id: cap.capabilityId, version: cap.version };
    const request = { mode: 'replay', targetId: 'demo-credit-union', capability, inputs: { memberId: 'M1002' } };
    expect(validateReplayRequest(cap, request).inputs).toEqual(request.inputs);
    expect(() => validateReplayRequest(cap, { ...request, inputs: { memberId: 'invalid' } })).toThrow();
    expect(() => validateReplayRequest(cap, { ...request, capability: { ...capability, version: 2 } })).toThrow();
    const result = { kind: 'success', capability, output: { availability: 'available', values: {
      memberId: 'M1002', accountId: 'S2002', accountType: 'savings', currentBalanceMinor: 8765, currency: 'USD',
    } } };
    expect(validateCapabilityResult(cap, result).kind).toBe('success');
    expect(() => validateCapabilityResult(cap, { ...result, output: { availability: 'available', values: { memberId: 'M1002' } } })).toThrow();
    expect(() => validateCapabilityResult(cap, { kind: 'business_outcome', code: 'UNDECLARED', summary: '', evidenceIds: [] })).toThrow();
  });
  it.each([{}, { memberId: 1001 }, { memberId: 'M12' }, { memberId: 'M1001', extra: 'value' }])('rejects invalid embedded invocation data', (value) => {
    expect(() => validateInvocation(fixture(), value)).toThrow();
  });
  it('validates UI-derived output data rather than stopping at envelope validation', () => {
    const output = { memberId: 'M1002', accountId: 'S2002', accountType: 'savings', currentBalanceMinor: 8765, currency: 'USD' };
    expect(validateOutput(fixture(), output)).toEqual(output);
    for (const invalid of [
      { ...output, currentBalanceMinor: '87.65' }, { ...output, currentBalanceMinor: 87.65 },
      { ...output, currentBalanceMinor: -1 }, { ...output, currentBalanceMinor: Number.MAX_SAFE_INTEGER + 1 },
      { ...output, currency: 'EUR' }, { ...output, accountType: 'checking' },
      { ...output, accountId: 'not-an-account' }, { ...output, availableBalanceMinor: 7600 },
    ]) expect(() => validateOutput(fixture(), invalid)).toThrow();
  });
  const negativeCases: [string, (cap: Capability) => unknown][] = [
    ['unknown schema version', (cap) => ({ ...cap, schemaVersion: 2 })],
    ['implicit latest version', (cap) => ({ ...cap, version: 'latest' })],
    ['arbitrary operation', (cap) => ({ ...cap, steps: [{ ...cap.steps[0], type: 'evaluate', code: 'fetch(secret)' }] })],
    ['embedded executable function', (cap) => ({ ...cap, execute: () => 'code' })],
    ['executable schema keyword', (cap) => ({ ...cap, inputSchema: { ...cap.inputSchema, $ref: 'https://untrusted.example/schema' } })],
    ['unrestricted regex', (cap) => ({ ...cap, inputSchema: { ...cap.inputSchema, properties: { memberId: { type: 'string', maxLength: 20, pattern: '(a+)+' } } } })],
    ['policy self-authorization', (cap) => ({ ...cap, safe: true, policyOverride: 'allow-all' })],
    ['provider session in artifact', (cap) => ({ ...cap, sessionId: interventionId })],
    ['missing full success checkpoint', (cap) => ({ ...cap, successCondition: undefined })],
    ['empty terminal identity', (cap) => ({ ...cap, successCondition: { ...cap.successCondition, identity: [] } })],
    ['literal identity in place of input', (cap) => ({ ...cap, successCondition: { ...cap.successCondition, identity: [{ target: 'detailsMemberId', input: 'M1001' }] } })],
    ['missing UI output extraction', (cap) => { delete cap.outputs.memberId; return cap; }],
    ['output copied from invocation', (cap) => ({ ...cap, outputs: { ...cap.outputs, memberId: input } })],
    ['output transform/type mismatch', (cap) => { cap.outputs.currentBalanceMinor!.transform = 'trim'; return cap; }],
    ['unresolved target', (cap) => { cap.steps[0]!.before = { kind: 'visible', target: 'missing' }; return cap; }],
    ['unresolved input binding', (cap) => { const step = cap.steps[1]!; if (step.type !== 'fill') throw new Error('Expected fill fixture step'); step.value = { kind: 'input', name: 'missing' }; return cap; }],
    ['fill literal instead of parameter', (cap) => ({ ...cap, steps: [cap.steps[0], { ...cap.steps[1], value: { kind: 'literal', value: 'M1001' } }, ...cap.steps.slice(2)] })],
    ['fill with integer input', (cap) => { cap.inputSchema.properties.memberId = { type: 'integer', minimum: 0, maximum: 9999 }; return cap; }],
    ['variable before capture', (cap) => { cap.steps[0]!.before = { kind: 'equals', source: { target: 'detailsAccountId', read: 'text', transform: 'trim' }, value: { kind: 'variable', name: 'primaryAccountId' } }; return cap; }],
    ['capture variable type mismatch', (cap) => { cap.variables.primaryAccountId = { type: 'boolean' }; return cap; }],
    ['uninitialized variable', (cap) => { cap.variables.unused = { type: 'boolean' }; return cap; }],
    ['missing reference in unused target', (cap) => { cap.targets.unused = { ...cap.targets.memberOpen!, within: [{ kind: 'tableRow', tableCaption: 'Members', cells: [{ columnHeader: 'ID', equals: { kind: 'input', name: 'missing' } }] }] }; return cap; }],
    ['duplicate step ID', (cap) => { cap.steps[1]!.id = cap.steps[0]!.id; return cap; }],
    ['different source run', (cap) => { cap.steps[0]!.source = { kind: 'discovery', runId: interventionId, eventSequence: 1 }; return cap; }],
    ['unresolved recovery reference', (cap) => { cap.steps[0]!.recoveryRuleIds = ['missing']; return cap; }],
    ['unresolved outcome scope', (cap) => { cap.outcomeRules[0]!.appliesToStepIds = ['missing']; return cap; }],
    ['duplicate business outcome code', (cap) => { cap.outcomeRules[1]!.code = cap.outcomeRules[0]!.code; return cap; }],
    ['unbounded recovery', (cap) => { cap.recoveryRules[0]!.maxAttempts = Infinity; return cap; }],
    ['recovery after uncertain dispatch', (cap) => ({ ...cap, recoveryRules: [{ ...cap.recoveryRules[0], dispatchState: 'unknown' }] })],
    ['ambiguous target cardinality', (cap) => ({ ...cap, targets: { ...cap.targets, memberInput: { ...cap.targets.memberInput, expectedMatches: 2 } } })],
    ['raw XPath replay target', (cap) => ({ ...cap, targets: { ...cap.targets, memberInput: { ...cap.targets.memberInput, locator: { kind: 'xpath', value: '//input[1]' } } } })],
    ['unscoped table cell', (cap) => { cap.targets.primaryAccountCell!.within = []; return cap; }],
    ['missing frame feature', (cap) => { cap.surfaceRequirements.features = ['dom-text', 'table-rows']; return cap; }],
    ['manual step without declared handling', (cap) => { cap.steps[0]!.source = { kind: 'manual', runId: cap.sourceDiscoveryRunId, interventionId, eventSequence: 1 }; return cap; }],
    ['manual precondition that is never checked', (cap) => { cap.manualContributions = [{ handling: 'precondition', interventionId, eventSequences: [1], preconditionId: 'missing' }]; return cap; }],
  ];
  it.each(negativeCases)('rejects %s', (_name, change) => { expect(() => parseCapability(change(fixture()))).toThrow(); });
  it('represents included manual actions with matching provenance', () => {
    const cap = fixture();
    cap.steps[0]!.source = { kind: 'manual', runId: cap.sourceDiscoveryRunId, interventionId, eventSequence: 1 };
    cap.manualContributions = [{ handling: 'included', interventionId, eventSequences: [1], stepIds: [cap.steps[0]!.id] }];
    expect(parseCapability(cap).manualContributions[0]?.handling).toBe('included');
    cap.manualContributions[0]!.eventSequences = [2];
    expect(() => parseCapability(cap)).toThrow();
  });
  it('represents a necessary manual prerequisite as a checked initial condition', () => {
    const cap = fixture();
    cap.manualContributions = [{ handling: 'precondition', interventionId, eventSequences: [1], preconditionId: 'staff-workspace' }];
    expect(parseCapability(cap).manualContributions[0]?.handling).toBe('precondition');
  });
  it('represents an explicit intervention requirement and rejects a reference to an ordinary step', () => {
    const cap = fixture();
    const condition: Predicate = { kind: 'visible', target: 'staffHeading' };
    cap.steps.unshift({ id: 'restore-session', type: 'intervene', before: condition, after: condition, timeoutMs: 10000,
      source: { kind: 'authored', reason: 'Manual session restoration must be represented.' },
      reason: 'SESSION_EXPIRED', resumeCondition: condition, interventionTimeoutMs: 600000, outcomeRuleIds: [], recoveryRuleIds: [] });
    cap.manualContributions = [{ handling: 'required_intervention', interventionId, eventSequences: [1], stepId: 'restore-session' }];
    expect(parseCapability(cap).steps[0]?.type).toBe('intervene');
    cap.manualContributions[0] = { handling: 'required_intervention', interventionId, eventSequences: [1], stepId: 'open-search' };
    expect(() => parseCapability(cap)).toThrow();
  });
});

describe('bounded data-only schema parsing', () => {
  it('validates boolean and integer fields without coercion or extra properties', () => {
    const schema = DataSchemaSchema.parse({ type: 'object', additionalProperties: false, required: ['enabled', 'count'],
      properties: { enabled: { type: 'boolean' }, count: { type: 'integer', minimum: 1, maximum: 3 } } });
    expect(validateData(schema, { enabled: true, count: 2 })).toEqual({ enabled: true, count: 2 });
    for (const invalid of [{ enabled: 'true', count: 2 }, { enabled: true, count: '2' }, { enabled: true, count: 4 }, { enabled: true, count: 2, extra: false }]) {
      expect(() => validateData(schema, invalid)).toThrow();
    }
  });
  it('rejects contradictory field schemas and optional/unknown fields', () => {
    const base = fixture().inputSchema;
    for (const properties of [
      { memberId: { type: 'integer', minimum: 10, maximum: 1 } },
      { memberId: { type: 'string', minLength: 10, maxLength: 5 } },
      { memberId: { type: 'string', maxLength: 5, enum: ['long-value'] } },
      { memberId: { type: 'string', maxLength: 5, format: 'member-id', enum: ['wrong'] } },
    ]) expect(() => DataSchemaSchema.parse({ ...base, properties })).toThrow();
    expect(() => DataSchemaSchema.parse({ ...base, additionalProperties: true })).toThrow();
    expect(() => DataSchemaSchema.parse({ ...base, required: [] })).toThrow();
  });
  it('rejects cycles, excessive nesting, non-JSON objects, and getters without invoking them', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    let getterCalled = false;
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { getterCalled = true; return 'secret'; } });
    for (const value of [cycle, getter, new Date(), { run: () => {} }, { value: NaN }]) expect(isBoundedJson(value)).toBe(false);
    expect(getterCalled).toBe(false);
    const cap = fixture(); let nested: Predicate = { kind: 'visible', target: 'staffHeading' };
    for (let depth = 0; depth < 30; depth++) nested = { kind: 'all', conditions: [nested] };
    cap.steps[0]!.before = nested;
    expect(CapabilitySchema.safeParse(cap).success).toBe(false);
    expect(CapabilitySchema.safeParse(JSON.parse('{"__proto__":{"polluted":true}}')).success).toBe(false);
  });
});
