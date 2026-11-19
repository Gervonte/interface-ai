# Public contracts and capability format (INT-004)

Implemented in `@interface-ai/contracts`, with Zod schemas and inferred TypeScript types exported from the package root. These are public data contracts only: no target business fixtures, credentials, Browserbase handles, database clients, or model clients enter the package.

**Verified on 2026-11-17:** `pnpm check` passes typechecking, 106 tests across seven files, and all application builds. INT-004 supplies validation and a reviewed example. HTTP run endpoints, UI target resolution, discovery construction, persistence, and replay interpretation are subsequent tasks.

## Entry points

| Export | Purpose |
| --- | --- |
| `parseCapability(value)` / `CapabilitySchema` | Validate bounded JSON, full artifact structure, references, binding types, and provenance relationships |
| `validateInvocation(capability, value)` | Validate actual input values against the embedded input schema |
| `validateOutput(capability, value)` | Validate actual extracted output values against the embedded output schema |
| `validateReplayRequest(capability, value)` | Validate replay envelope, exact capability ID/version, and embedded input values together |
| `validateCapabilityResult(capability, value)` | Validate result envelope, exact capability reference, declared business-outcome code, and retained output values together |
| `validateData(schema, value)` | Interpret the constrained input/output schema without coercion or executable schema hooks |
| `RunRequestSchema`, `RunAcceptedSchema`, `RunViewSchema`, `RunResultSchema` | Public run request/progress/result shapes |
| `ActionProposalSchema`, `ManualActionRequestSchema` | Ephemeral observed-control input, separate from durable artifact targets |
| `BlockedContextSchema`, `InterventionSchema`, claim/resume/cancel schemas | Explicit paused-state context and control requests |
| `MutationMetadataSchema` | Validate the normalized `Idempotency-Key` header value; no receipt persistence is implemented here |
| `RuntimeBudgetsSchema`, `DEFAULT_RUNTIME_BUDGETS` | Finite, adjustable server configuration defaults |

Envelope parsing alone is insufficient. The later API/runner must use the capability-aware helpers at invocation/result boundaries, and validate outputs **before** clearing transient values. A `not_retained` result represents later authorized retrieval after values were discarded; it cannot prove those values were valid or establish that a UI workflow succeeded.

## Serializable data schema

The initial input/output format is a small JSON Schema subset: a flat object with 1–32 named scalar properties, every property required exactly once, and `additionalProperties: false`.

- **String:** required finite `maxLength` up to 4096, optional `minLength`, optional nonempty string `enum`, and optional fixed format `member-id`, `account-id`, or `uuid`.
- **Integer:** required safe-integer `minimum` and `maximum`, with minimum no greater than maximum.
- **Boolean:** an actual JSON boolean.

`member-id` means `M` followed by four digits; `account-id` means an uppercase letter followed by four digits. These are local, explicitly validated formats. Enums must be unique and satisfy their field's bounds/format. Unknown fields, missing fields, fractional/unsafe integers, implicit string/boolean/number coercion, and contradictory bounds are rejected.

Nested objects, arrays, nullable/optional fields, arbitrary regular expressions, `$ref`, custom validators, and general JSON Schema support are deliberately outside format version 1. Unsupported keywords fail rather than being silently ignored. Extend the format and its tests explicitly when a real workflow needs more types.

## Capability envelope

`schemaVersion: 1` selects the executable data format; `capabilityId` plus positive integer `version` identifies one immutable workflow revision. Replay never resolves an implicit `latest`. `sourceDiscoveryRunId` correlates the artifact with its real source run; each recorded step must use that same run ID.

The envelope contains surface/application compatibility, typed input/output schemas, named targets, named starting preconditions, ordered steps, typed temporary variables, deterministic output extractions, independent terminal conditions/identity checks, scoped outcome/recovery rules, and explicit handling of manual contributions. Unsupported versions, operations, fields, and references are rejected.

The [full balance contract fixture](examples/primary-savings.contract.json) follows the planned staff portal path. It is **authored test data**, with a sentinel discovery-run UUID; it was not emitted by a real discovery run and must not be presented as discovery evidence or loaded as an executed capability. INT-008 must additionally verify provenance against actual confirmed events before saving a capability. Schema validation cannot establish that an external UI action happened.

Before recursive schema parsing, a plain-JSON gate rejects functions, accessors, non-JSON objects, cycles, dangerous prototype keys, and excessive complexity. It bounds nesting at 24 levels, visits at 20,000 nodes, and aggregate string/key content at 131,072 characters. Predicates additionally have an eight-level semantic nesting limit. These are parser safety bounds, independent of execution policy.

## Targets, bindings, and extraction

Targets specify document scope or an explicit frame chain, optional container/table-row scope, exactly one locator, and `expectedMatches: 1`. Frame chains use observed name/title values, never indexes. Rows match exact named columns against literal values or typed input/capture references. Controls use labels, roles/names, visible text with control kind, caption, supported stable attributes, a cell identified by column header, or an associated labeled output field.

A `field` locator identifies a value associated with its visible field label, such as a definition-list term/value pair; it does not mean a generated element ID. A `cell` requires table-row scope. Raw CSS/XPath, generated test IDs/classes, ordinal rows, provider control IDs, and coordinates are not durable format-v1 target strategies. The INT-003 positional XPath must be translated into verified semantic descriptions by the builder/adapter, not copied blindly.

The resolver in INT-007 must implement deterministic normalization and association rules for these descriptors, pass comparison values as data, enforce cardinality and actionability, and reject inaccessible/ambiguous scope. Parsing a target does not demonstrate runtime locator support or grant permission to act.

Values have explicit `input`, `variable`, or scalar `literal` references. Fill steps require a **string input reference**, not a copied discovery value. Variables are declared with scalar types and assigned once through a UI capture; references before capture fail validation. Target row comparisons require strings. Extraction/condition bindings must agree with the declared types.

Every output has exactly one UI extraction, never an input echo or literal. Each extraction identifies a target, `read` operation (`text`, `value`, or `checked`), and one named transformation:

| Transformation | Declared result / intended adapter semantics |
| --- | --- |
| `identity` | String for text/value; boolean for checked state |
| `trim` | String with only outer whitespace removed |
| `integer` | Strict signed decimal integer parsed into a safe integer; no general numeric coercion |
| `usd-minor` | Explicit USD display parsed into integer cents, without floating-point amount arithmetic |
| `savings-type` | Exact supported Savings/Primary Savings label mapped to `savings`; other account types fail |

These are instructions for the later deterministic adapter, not uploaded functions. Checked-state reads only permit identity. Other read/transform combinations have statically checked output types; actual converted values still need `validateOutput`.

## Steps and conditions

Supported steps are `navigate` to the configured target entry, `fill`, `click`, `wait`, `capture`, and `intervene`. Each has stable identity, before/after predicates, a finite requested timeout, applicable outcome/recovery references, and source provenance. Ordinary recorded steps reference discovery/manual events. An authored intervention requirement has an explicit reason and validated resume condition.

Predicates cover unique presence/absence, visibility, enabled/editable state, typed extracted-value equality, configured route location, and bounded `all`/`any` composition. Initial preconditions are all required. Terminal success requires **all** terminal conditions **and all** identity checks. Every identity check compares a UI target with a declared string input and requires a matching UI output extraction. Capture-derived account identity can independently tie Account Details to the selected account row.

The evaluator is INT-007 work. It must distinguish satisfied, not satisfied, and evaluation error; an error cannot disappear through boolean short-circuiting. Output-schema validation alone does not prove requested-record identity or the terminal UI condition.

Outcome rules contain an authored code, explicit UI predicate, and subscribed step IDs. The balance fixture declares `MEMBER_NOT_FOUND`, `NO_PRIMARY_SAVINGS_ACCOUNT`, and `ACCESS_DENIED`, each tied to the current requested member. An unresolved control is not a business outcome.

Recovery rules declare a known predicate, subscribed steps, `not_sent` or `settled` dispatch state, at most three attempts, a finite deadline, limited click/wait operations, and a required post-recovery checkpoint. Unknown dispatch state, model recovery, arbitrary script, and unbounded attempts are rejected. These declarations do not prove a recovery works; later scenario tests must do so, and execution policy still governs every action.

## Manual contributions and control

A recorded manual step must correlate with an included contribution's intervention ID/event sequence/step IDs. Included event sequences cannot be silently left without a represented step. Other necessary contributions must point to an explicit `intervene` step or a checked named initial precondition. None of these records contains typed credentials or permits omission of a necessary action. External completeness still needs comparison with the actual discovery history in INT-008.

Observed action proposals use current observation/control references. Manual requests use an observation ID, expected control revision, and constrained click/fill/configured-entry navigation. They do not accept arbitrary selectors, scripts, provider sessions, or client-asserted operator identity. Blocked context retains the stable step ID or discovery action index, distinguishes dispatch/effect uncertainty, and includes sanitized expected/observed summaries, checkpoint, and internal evidence references. `sessionRef` is an application-owned reference, not an authenticated provider connection URL.

Run views reject contradictory lifecycle/controller/result states, mismatched successful capability references, active interventions on terminal runs, and out-of-order timestamps. Claims/resume carry expected revisions; operator identity comes from server authentication. Shapes alone do not synchronize actions, authorize callers, redact arbitrary summaries, or implement idempotency. Those boundaries remain in their implementing tasks.

## Initial budgets

| Server setting | Default |
| --- | --- |
| Action admissions | 100 |
| Discovery model calls | 30; replay must use 0 |
| Active automation time | 300,000 ms (5 minutes) |
| Per-step wait ceiling | 10,000 ms |
| Observation poll interval | 250 ms |
| Recovery attempts | 3 |
| Human intervention deadline | 600,000 ms (10 minutes) |
| Overall elapsed run deadline | 900,000 ms (15 minutes) |

`RuntimeBudgetsSchema` validates bounded server configuration and consistent wait/poll/deadline relationships. These defaults are enforced by the shared executor/coordinator for the current discovery/replay slice. Recovery and handoff extensions in INT-013 onward must preserve the minimum of requested step/rule budgets, current policy ceilings, and remaining run budgets, without resetting deadlines on retries/handoff. A capability/request cannot select a policy override or grant itself more permission. The configured browser lifetime must cover the admitted overall run lifetime while still remaining finite.

## Verification and remaining scope

Tests round-trip the complete contract fixture; validate M1001/M1002 inputs and the agreed typed balance outputs; reject unsupported code/versions/locators, missing/forward references, invalid bindings, unknown output fields, contradictory schemas, missing identity extractions, invalid manual handling, unbounded recovery, and malformed run/control/result combinations. Existing fixture/HTTP/provider-spike tests continue passing.

No new hosted session, model call, database, UI route, or live discovery evidence is created by INT-004. Persistence is INT-005; the full portal is INT-006; resolution/execution is INT-007; real artifact construction and run boundaries follow. The schema example establishes format and reviewability, not a completed automation acceptance demonstration.

## Executor/API integration (INT-007/008)

The semantic target/read/condition contracts now have an executable same-origin browser adapter; its supported subset and failure behavior are documented in [RUNTIME.md](RUNTIME.md). `RunAcceptedSchema` additionally accepts a validated optional `operationUrl` that points to the accepted run's UUID receipt. Authenticated resource APIs, duplicate-key transport rejection, capability-aware replay invocation validation, durable principal/session state, cancellation and safe result access are implemented. Real discovery-derived construction and deterministic replay are now implemented in INT-009/010; see [the workflow guide](WORKFLOWS.md) for supported scope and the entry-navigation/precondition convention. The authored example remains a format/test fixture, not a production discovered capability.

## Actual discovered artifact (INT-009–011)

[The live example](evidence/int-009-011/capability.json) was emitted by discovery and consumed by a later API process for another member. Its discovery sources resolve to confirmed events in the exported run log. Publication verifies matching step IDs/types, positive model usage, and complete ordered mutation history. Initial global preconditions are checked after the fresh-session entry navigation. Output captures and identity checks use deterministic UI operations. The authored `examples/` fixture remains distinct from this real capability.
