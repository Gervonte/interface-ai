import { z } from 'zod';
import { BoundedJsonSchema, DataSchemaSchema, FieldSchema, IdentifierSchema as Id, ScalarSchema, validateData } from './data.js';
import type { Field } from './data.js';
import { StepTimeoutSchema } from './budgets.js';

const text = z.string().min(1).max(500);
export const ValueReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('input'), name: Id }),
  z.strictObject({ kind: z.literal('variable'), name: Id }),
  z.strictObject({ kind: z.literal('literal'), value: ScalarSchema }),
]);
type ValueReference = z.infer<typeof ValueReferenceSchema>;
const role = z.enum(['button', 'link', 'textbox', 'checkbox', 'heading', 'table', 'dialog', 'region', 'form']);
export const LocatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('label'), text, exact: z.literal(true) }),
  z.strictObject({ kind: z.literal('role'), role, name: text, exact: z.literal(true) }),
  z.strictObject({ kind: z.literal('text'), text, element: z.enum(['button', 'link', 'heading', 'text']), exact: z.literal(true) }),
  z.strictObject({ kind: z.literal('attribute'), name: z.enum(['name', 'title', 'aria-label', 'aria-modal']), value: text }),
  z.strictObject({ kind: z.literal('caption'), text, exact: z.literal(true) }),
  z.strictObject({ kind: z.literal('cell'), columnHeader: text }),
  z.strictObject({ kind: z.literal('field'), label: text }),
]);
export const TargetSchema = z.strictObject({
  scope: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('document') }),
    z.strictObject({ kind: z.literal('frame'), frames: z.array(z.strictObject({ attribute: z.enum(['name', 'title']), value: text })).min(1).max(4) }),
  ]),
  within: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('container'), locator: LocatorSchema }),
    z.strictObject({ kind: z.literal('tableRow'), tableCaption: text,
      cells: z.array(z.strictObject({ columnHeader: text, equals: ValueReferenceSchema })).min(1).max(8) }),
  ])).max(4),
  locator: LocatorSchema, expectedMatches: z.literal(1),
}).superRefine((target, ctx) => {
  if (target.locator.kind === 'cell' && target.within.at(-1)?.kind !== 'tableRow') {
    ctx.addIssue({ code: 'custom', message: 'A cell requires explicit table-row scope.' });
  }
  if (target.within.some((scope) => scope.kind === 'container' && ['cell', 'field'].includes(scope.locator.kind))) {
    ctx.addIssue({ code: 'custom', message: 'A cell or field is not a supported container scope.' });
  }
});
export type Target = z.infer<typeof TargetSchema>;
export const ExtractionSchema = z.strictObject({
  target: Id, read: z.enum(['text', 'value', 'checked']),
  transform: z.enum(['identity', 'trim', 'integer', 'usd-minor', 'savings-type']),
});
type Extraction = z.infer<typeof ExtractionSchema>;
export type Predicate =
  | { kind: 'present' | 'absent' | 'visible' | 'enabled' | 'editable'; target: string }
  | { kind: 'equals'; source: Extraction; value: ValueReference }
  | { kind: 'location'; routeKey: string }
  | { kind: 'all' | 'any'; conditions: Predicate[] };
export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() => z.union([
  z.strictObject({ kind: z.enum(['present', 'absent', 'visible', 'enabled', 'editable']), target: Id }),
  z.strictObject({ kind: z.literal('equals'), source: ExtractionSchema, value: ValueReferenceSchema }),
  z.strictObject({ kind: z.literal('location'), routeKey: Id }),
  z.strictObject({ kind: z.enum(['all', 'any']), conditions: z.array(PredicateSchema).min(1).max(16) }),
]));
const SourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('discovery'), runId: z.uuid(), eventSequence: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('manual'), runId: z.uuid(), interventionId: z.uuid(), eventSequence: z.number().int().positive() }),
]);
const base = { id: Id, before: PredicateSchema, after: PredicateSchema, timeoutMs: StepTimeoutSchema,
  outcomeRuleIds: z.array(Id).max(16), recoveryRuleIds: z.array(Id).max(8), source: SourceSchema };
export const StepSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...base, type: z.literal('fill'), target: Id, value: z.strictObject({ kind: z.literal('input'), name: Id }) }),
  z.strictObject({ ...base, type: z.literal('click'), target: Id }),
  z.strictObject({ ...base, type: z.literal('navigate'), destination: z.literal('target-entry') }),
  z.strictObject({ ...base, type: z.literal('wait'), condition: PredicateSchema }),
  z.strictObject({ ...base, type: z.literal('capture'), variable: Id, sourceValue: ExtractionSchema }),
  z.strictObject({ ...base, type: z.literal('intervene'), reason: z.enum(['UNEXPECTED_DIALOG', 'SESSION_EXPIRED', 'MANUAL_PREREQUISITE']),
    resumeCondition: PredicateSchema, interventionTimeoutMs: z.number().int().min(1000).max(900_000),
    source: z.strictObject({ kind: z.literal('authored'), reason: text }) }),
]);
const RuleSource = z.strictObject({ kind: z.literal('authored'), reason: text });
const OutcomeRule = z.strictObject({ id: Id, code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), when: PredicateSchema,
  appliesToStepIds: z.array(Id).min(1).max(128), source: RuleSource });
const RecoveryRule = z.strictObject({ id: Id, when: PredicateSchema, appliesToStepIds: z.array(Id).min(1).max(128),
  dispatchState: z.enum(['not_sent', 'settled']), maxAttempts: z.number().int().min(1).max(3), timeoutMs: StepTimeoutSchema,
  actions: z.array(z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('click'), target: Id }),
    z.strictObject({ type: z.literal('wait'), condition: PredicateSchema }),
  ])).min(1).max(3), after: PredicateSchema, source: RuleSource.extend({ observedEventSequences: z.array(z.number().int().positive()).max(128).optional() }) });
const RuntimeGuard = z.strictObject({ id: Id, when: PredicateSchema, require: PredicateSchema.optional(),
  handling: z.enum(['failure','intervention']), code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  reason: z.enum(['UNEXPECTED_DIALOG','SESSION_EXPIRED','STATE_TIMEOUT','POLICY_BLOCKED','AMBIGUOUS_TARGET']), appliesToStepIds:z.array(Id).min(1).max(128),
  source:RuleSource });
const ManualContribution = z.discriminatedUnion('handling', [
  z.strictObject({ handling: z.literal('included'), interventionId: z.uuid(), eventSequences: z.array(z.number().int().positive()).min(1).max(128), stepIds: z.array(Id).min(1).max(128) }),
  z.strictObject({ handling: z.literal('required_intervention'), interventionId: z.uuid(), eventSequences: z.array(z.number().int().positive()).min(1).max(128), stepId: Id }),
  z.strictObject({ handling: z.literal('precondition'), interventionId: z.uuid(), eventSequences: z.array(z.number().int().positive()).min(1).max(128), preconditionId: Id }),
]);
const structure = z.strictObject({
  schemaVersion: z.literal(1), capabilityId: Id, version: z.number().int().positive(), name: text, description: z.string().min(1).max(2000),
  sourceDiscoveryRunId: z.uuid(),
  surfaceRequirements: z.strictObject({ kind: z.literal('browser'), applicationFamily: Id,
    compatibleTargetVersions: z.array(z.number().int().positive()).min(1).max(32),
    features: z.array(z.enum(['frames', 'labels', 'roles', 'table-rows', 'dom-text'])).min(1).max(5) }),
  inputSchema: DataSchemaSchema, outputSchema: DataSchemaSchema,
  variables: z.record(Id, FieldSchema), targets: z.record(Id, TargetSchema),
  preconditions: z.record(Id, PredicateSchema), steps: z.array(StepSchema).min(1).max(128),
  outputs: z.record(Id, ExtractionSchema),
  successCondition: z.strictObject({ conditions: z.array(PredicateSchema).min(1).max(16),
    identity: z.array(z.strictObject({ target: Id, input: Id })).min(1).max(8) }),
  outcomeRules: z.array(OutcomeRule).max(16), recoveryRules: z.array(RecoveryRule).max(8),
  manualContributions: z.array(ManualContribution).max(32), runtimeGuards:z.array(RuntimeGuard).max(16).optional(),
});
export type Capability = z.infer<typeof structure>;

function semanticValidation(cap: Capability, ctx: z.RefinementCtx) {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const inputsUsed = new Set<string>();
  const initialized = new Set<string>();
  const unique = (values: readonly (string | number)[], label: string) => { if (new Set<string | number>(values).size !== values.length) issue(`Duplicate ${label}.`); };
  if (!Object.keys(cap.targets).length || Object.keys(cap.targets).length > 128 || !Object.keys(cap.preconditions).length
    || Object.keys(cap.preconditions).length > 32 || Object.keys(cap.variables).length > 32) issue('Invalid target, precondition, or variable count.');
  unique(cap.steps.map((step) => step.id), 'step ID');
  unique(cap.outcomeRules.map((rule) => rule.id), 'outcome rule ID');
  unique(cap.outcomeRules.map((rule) => rule.code), 'outcome code');
  unique(cap.recoveryRules.map((rule) => rule.id), 'recovery rule ID');
  unique((cap.runtimeGuards??[]).map(rule=>rule.id),'runtime guard ID');
  unique(cap.surfaceRequirements.compatibleTargetVersions, 'target version');
  unique(cap.surfaceRequirements.features, 'surface feature');
  const stepIds = new Set(cap.steps.map((step) => step.id));
  function valueType(value: ValueReference, available: Set<string>): Field['type'] | undefined {
    if (value.kind === 'literal') return typeof value.value === 'number' ? 'integer' : typeof value.value as 'string' | 'boolean';
    const field = value.kind === 'input' ? cap.inputSchema.properties[value.name] : cap.variables[value.name];
    if (!field) issue('Unresolved value reference.');
    if (value.kind === 'input') inputsUsed.add(value.name);
    if (value.kind === 'variable' && !available.has(value.name)) issue('Variable used before capture.');
    return field?.type;
  }
  function target(id: string, available: Set<string>) {
    const definition = cap.targets[id];
    if (!definition) { issue('Unresolved target reference.'); return; }
    for (const scope of definition.within) if (scope.kind === 'tableRow') {
      unique(scope.cells.map((cell) => cell.columnHeader), 'row column predicate');
      for (const cell of scope.cells) if (valueType(cell.equals, available) !== 'string') issue('Table cell comparisons require strings.');
    }
  }
  function extraction(source: Extraction, available: Set<string>): Field['type'] {
    target(source.target, available);
    if (source.read === 'checked') {
      if (source.transform !== 'identity') issue('Checked extraction only supports identity.');
      return 'boolean';
    }
    return source.transform === 'integer' || source.transform === 'usd-minor' ? 'integer' : 'string';
  }
  function predicate(condition: Predicate, available: Set<string>, depth = 0) {
    if (depth > 8) { issue('Predicate nesting limit exceeded.'); return; }
    if (condition.kind === 'all' || condition.kind === 'any') {
      for (const child of condition.conditions) predicate(child, available, depth + 1);
    } else if (condition.kind === 'equals') {
      if (extraction(condition.source, available) !== valueType(condition.value, available)) issue('Predicate binding type mismatch.');
    } else if ('target' in condition) target(condition.target, available);
  }
  for (const targetDefinition of Object.values(cap.targets)) {
    if (targetDefinition.scope.kind === 'frame' && !cap.surfaceRequirements.features.includes('frames')) issue('Frame feature is required.');
    if (targetDefinition.within.some((scope) => scope.kind === 'tableRow') && !cap.surfaceRequirements.features.includes('table-rows')) issue('Table-row feature is required.');
    const locators = [targetDefinition.locator, ...targetDefinition.within.flatMap((scope) => scope.kind === 'container' ? [scope.locator] : [])];
    if (locators.some((locator) => locator.kind === 'label') && !cap.surfaceRequirements.features.includes('labels')) issue('Label feature is required.');
    if (locators.some((locator) => locator.kind === 'role') && !cap.surfaceRequirements.features.includes('roles')) issue('Role feature is required.');
  }
  for (const id of Object.keys(cap.targets)) target(id, new Set(Object.keys(cap.variables)));
  if (!cap.surfaceRequirements.features.includes('dom-text')) issue('DOM-text feature is required for UI outputs.');
  for (const condition of Object.values(cap.preconditions)) predicate(condition, initialized);
  for (const step of cap.steps) {
    unique(step.outcomeRuleIds, 'outcome reference'); unique(step.recoveryRuleIds, 'recovery reference');
    predicate(step.before, initialized);
    if (step.source.kind !== 'authored' && step.source.runId !== cap.sourceDiscoveryRunId) issue('Step provenance uses another discovery run.');
    if ('target' in step) target(step.target, initialized);
    if (step.type === 'fill' && valueType(step.value, initialized) !== 'string') issue('Fill bindings require string inputs.');
    if (step.type === 'wait') predicate(step.condition, initialized);
    for (const id of step.outcomeRuleIds) {
      const rule = cap.outcomeRules.find((rule) => rule.id === id);
      if (!rule || !rule.appliesToStepIds.includes(step.id)) issue('Unresolved or incorrectly scoped outcome rule.');
      else predicate(rule.when, initialized);
    }
    for (const id of step.recoveryRuleIds) {
      const rule = cap.recoveryRules.find((rule) => rule.id === id);
      if (!rule || !rule.appliesToStepIds.includes(step.id)) issue('Unresolved or incorrectly scoped recovery rule.');
      else {
        predicate(rule.when, initialized); predicate(rule.after, initialized);
        for (const action of rule.actions) action.type === 'click' ? target(action.target, initialized) : predicate(action.condition, initialized);
      }
    }
    for(const guard of cap.runtimeGuards??[]) if(guard.appliesToStepIds.includes(step.id)){predicate(guard.when,initialized);if(guard.require)predicate(guard.require,initialized);}
    if (step.type === 'capture') {
      const field = cap.variables[step.variable];
      if (!field || field.type !== extraction(step.sourceValue, initialized)) issue('Capture variable type mismatch.');
      if (initialized.has(step.variable)) issue('Capture variable may only be assigned once.');
      initialized.add(step.variable);
    }
    if (step.type === 'intervene') predicate(step.resumeCondition, initialized);
    predicate(step.after, initialized);
  }
  for (const name of Object.keys(cap.variables)) if (!initialized.has(name)) issue('Variable declared without capture.');
  for (const guard of cap.runtimeGuards??[]) { unique(guard.appliesToStepIds,'guard scope');for(const id of guard.appliesToStepIds)if(!stepIds.has(id))issue('Unresolved guard step.'); }
  for (const rule of [...cap.outcomeRules, ...cap.recoveryRules]) {
    unique(rule.appliesToStepIds, 'rule scope');
    for (const id of rule.appliesToStepIds) {
      const step = cap.steps.find((step) => step.id === id);
      if (!step || !(('code' in rule ? step.outcomeRuleIds : step.recoveryRuleIds).includes(rule.id))) issue('Rule scope must reference a subscribing step.');
    }
  }
  for (const condition of cap.successCondition.conditions) predicate(condition, initialized);
  for (const check of cap.successCondition.identity) {
    target(check.target, initialized);
    if (valueType({ kind: 'input', name: check.input }, initialized) !== 'string') issue('Identity checks require string input references.');
    // Identity output must be read from the same UI region that is independently checked.
    if (!Object.values(cap.outputs).some((output) => output.target === check.target && output.read === 'text'
      && ['identity', 'trim'].includes(output.transform))) issue('Identity check needs a matching UI extraction.');
  }
  const outputNames = Object.keys(cap.outputSchema.properties);
  if (Object.keys(cap.outputs).length !== outputNames.length || outputNames.some((name) => !cap.outputs[name])) issue('Every output needs exactly one UI extraction.');
  for (const [name, source] of Object.entries(cap.outputs)) {
    if (cap.outputSchema.properties[name]?.type !== extraction(source, initialized)) issue('Output extraction type mismatch.');
  }
  for (const contribution of cap.manualContributions) {
    unique(contribution.eventSequences, 'manual event sequence');
    if (contribution.handling === 'precondition') {
      if (!cap.preconditions[contribution.preconditionId]) issue('Unresolved manual precondition.');
    } else if (contribution.handling === 'required_intervention') {
      if (!cap.steps.some((step) => step.id === contribution.stepId && step.type === 'intervene')) issue('Manual contribution needs an intervention step.');
    } else {
      unique(contribution.stepIds, 'manual step reference');
      for (const id of contribution.stepIds) {
        const step = cap.steps.find((step) => step.id === id);
        if (!stepIds.has(id) || step?.source.kind !== 'manual' || step.source.interventionId !== contribution.interventionId
          || !contribution.eventSequences.includes(step.source.eventSequence)) issue('Manual contribution does not match its recorded steps.');
      }
      for (const sequence of contribution.eventSequences) {
        if (!cap.steps.some((step) => contribution.stepIds.includes(step.id) && step.source.kind === 'manual'
          && step.source.eventSequence === sequence && step.source.interventionId === contribution.interventionId)) {
          issue('Included manual event has no represented step.');
        }
      }
    }
  }
  for (const step of cap.steps) if (step.source.kind === 'manual') {
    const source = step.source;
    if (!cap.manualContributions.some((item) => item.handling === 'included' && item.stepIds.includes(step.id)
      && item.interventionId === source.interventionId)) issue('Manual step lacks explicit contribution handling.');
  }
  for (const input of Object.keys(cap.inputSchema.properties)) if (!inputsUsed.has(input)) issue('Unused input has no explicit binding.');
}
export const CapabilitySchema = BoundedJsonSchema.pipe(structure).superRefine(semanticValidation);
export const parseCapability = (value: unknown): Capability => CapabilitySchema.parse(value);
export const validateInvocation = (capability: Capability, value: unknown) => validateData(CapabilitySchema.parse(capability).inputSchema, value);
export const validateOutput = (capability: Capability, value: unknown) => validateData(CapabilitySchema.parse(capability).outputSchema, value);
