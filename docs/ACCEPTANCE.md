# Acceptance checklist

Status: every required criterion below passes, each linked to genuine run evidence, a test, or the required design explanation in [REPORT.md](../REPORT.md). Remaining work is optional follow-on scope listed under the report's Cuts. Submitting the repository link is a separate delivery action.

Source: *Assignment A — Computer-Use Automation System*, especially sections 3–7 and 9. Section references below refer to that assignment.

This checklist defines observable outcomes independently of implementation choices. The selected stack, agreed balance workflow, and reviewed implementation order are tracked in STACK.md, DEMO_WORKFLOW.md, and IMPLEMENTATION_PLAN.md. Planning coverage is not verification; each checked box links its proof.

## How to use this checklist

- Required behavior and deliverables come from the assignment. Verification methods are proposed ways to demonstrate compliance, not additional assignment requirements.
- Check an item only after linking to supporting code, a test, a run, or the relevant design explanation. A planned feature is not a pass.
- All required areas need a working minimum where implementation is required. A polished subset does not satisfy the assignment.
- Keep optional evidence and stretch work separate from the required scope.

## 1. Live discovery — required implementation

- [x] **DISC-01 — Goal and target input.** Accept a natural-language goal and a target application or entry point. **Verify:** supply both through the documented interface. (§3.1)
  **Evidence:** Goal, output contract, target and inputs through `POST /v1/runs` or `pnpm demo:e2e --request`: [request](../evidence/request.json), [README demo](../README.md#demo-goal--discovery--saved-capability--replay).
- [x] **DISC-02 — Genuine model-driven interaction.** An LLM observes the live UI, chooses actions, and actually operates it through a non-trivial multi-step flow. **Verify:** capture at least one successful live discovery run with evidence connecting observations, decisions, actions, and the resulting UI state. A scripted or mocked model run alone does not qualify. (§3.1, §4)
  **Evidence:** [Discovery run](../evidence/discovery.json): seven `gpt-4.1` decisions, each followed by the dispatched action and confirmed UI state; more in [int-023](../evidence/int-023/README.md) and [int-014-015](../evidence/int-014-015/README.md).
- [x] **DISC-03 — Bounded execution.** Discovery stops when the goal is met or a defined limit/dead-end is reached. **Verify:** demonstrate success and a stopping condition; inspect configured step/time limits and dead-end handling. (§3.1)
  **Evidence:** Success: [discovery](../evidence/discovery.json). Stopping: budgets in [policy v5](../apps/automation/config/policy.v5.json) (30 model calls, 300 actions, step/active/overall timeouts); a real [model-timeout stop](../evidence/int-009-011/README.md); planner dead-ends (`UNSUPPORTED_GOAL`, help) in [workflows.test.ts](../tests/workflows.test.ts) and action-budget exhaustion in [executor.test.ts](../tests/executor.test.ts).

## 2. Reusable capability artifact — required implementation

- [x] **ART-01 — Saved artifact from a successful run.** Emit a typed, serializable, versioned artifact representing the successful flow, separate from the raw model transcript. **Verify:** save and reload the emitted artifact and trace its actions to the discovery run. (§3.2)
  **Evidence:** [Capability](../evidence/capability.json) v1 with `sourceDiscoveryRunId` = the [discovery](../evidence/discovery.json) run and per-step event sources; reloaded by ID/version and consumed by [replay](../evidence/replay.json).
- [x] **ART-02 — Explicit actions and targets.** Represent ordered actions and how each target control is identified. **Verify:** inspect the artifact and explain why its targeting strategy is robust for the chosen surface. (§3.2)
  **Evidence:** Ordered steps and semantic targets in the [capability](../evidence/capability.json); rationale in [REPORT: Artifact schema](../REPORT.md#artifact-schema).
- [x] **ART-03 — Typed invocation contract.** Declare input parameters, output types/shapes, and what data to extract. **Verify:** inspect the contract and invoke it with supplied inputs; confirm returned outputs match the declaration. (§3.2)
  **Evidence:** `inputSchema`/`outputSchema`/`outputs` in the [capability](../evidence/capability.json); [replay](../evidence/replay.json) with M1002 returns outputs matching the declaration.
- [x] **ART-04 — Success condition.** Record a checkpoint or success condition that can be evaluated during replay. **Verify:** show both a satisfied condition and a case where an unmet condition prevents a success result. (§3.2–3.3)
  **Evidence:** Satisfied: [replay](../evidence/replay.json). Unmet prevents success: [wrong-account](../evidence/int-012-013/wrong-account.json) and [identity mismatch](../evidence/int-016/hard-failure.json).
- [x] **ART-05 — Reviewability.** A reviewer or calling agent can understand what the capability does, needs, and returns from the artifact and its schema documentation. **Verify:** review a saved example without relying on the discovery transcript. (§3.2)
  **Evidence:** Name, generated description, per-output `outputDescriptions`, typed contract and provenance in the [capability](../evidence/capability.json); [REPORT: Artifact schema](../REPORT.md#artifact-schema), [CONTRACTS.md](CONTRACTS.md).

## 3. Deterministic replay and outcomes — required implementation

- [x] **REP-01 — Replay without model decisions.** Execute a saved artifact with invocation inputs without asking an LLM what to do. **Verify:** replay with model access disabled or with instrumentation that would fail on a model call. (§3.3)
  **Evidence:** [Replay](../evidence/replay.json) and [local replays](../evidence/local-replay/README.md) report zero model calls, attempts and tokens; replay's model is a rejecting function, and tests fail on any planner call.
- [x] **REP-02 — Reusable inputs.** Use invocation parameters rather than retaining discovery-specific values where parameters are declared. **Verify:** replay the same artifact with a different valid input and confirm the corresponding output. (§3.2–3.3; proposed proof of parameterization)
  **Evidence:** The same capability version replayed for M1002 returns S2002 / 8765 ([replay](../evidence/replay.json)); account order differs between members.
- [x] **REP-03 — Stable targeting and synchronization.** Resolve controls reliably and wait for required UI states before proceeding. **Verify:** explain target resolution and waiting rules, then exercise a delayed transition. (§3.3, §7)
  **Evidence:** Unique semantic targets and per-step bounded waits ([REPORT](../REPORT.md#determinism--error-handling)); live slow search/inquiry in [int-012-013](../evidence/int-012-013/README.md).
- [x] **REP-04 — Verified outputs.** Evaluate the declared success condition and return declared outputs to the caller. **Verify:** compare the structured result with the actual UI state and artifact contract. (§3.3)
  **Evidence:** [Replay](../evidence/replay.json) verifies the success condition and identities, then returns typed outputs from the UI fields.
- [x] **REP-05 — Business outcomes.** Represent expected outcomes, such as no matching record, separately from execution failures. **Verify:** trigger a legitimate negative business result and inspect its structured result. (§3.3)
  **Evidence:** [Not-found replay](../evidence/replay-not-found.json) returns `business_outcome` `MEMBER_NOT_FOUND`; no primary savings and access denied in [int-012-013](../evidence/int-012-013/README.md).
- [x] **REP-06 — Recoverable conditions.** Recognize supported transient/known conditions and apply deliberate recovery. **Verify:** trigger a supported condition, observe bounded waiting/retry or a known recovery action, and demonstrate stopping when recovery is exhausted. (§3.3)
  **Evidence:** Notice acknowledgment and transient inquiry retry, plus `RECOVERY_EXHAUSTED` after bounded attempts: [int-012-013](../evidence/int-012-013/README.md). Applied recoveries are listed in the result's `recoveries` ([runtime.test.ts](../tests/database/runtime.test.ts)).
- [x] **REP-07 — Hard failures.** Stop safely when execution cannot proceed and report the step, expected state, and observed state. **Verify:** inject an unrecoverable condition and confirm no subsequent automated step blindly executes. (§3.3)
  **Evidence:** [Identity-mismatch replay](../evidence/int-016/hard-failure.json): step, expected and observed condition, rule ID; no later step dispatched. Also [wrong-account](../evidence/int-012-013/wrong-account.json).
- [x] **REP-08 — Runtime exception coverage.** Deliberately handle validation errors, missing records, permission denial, unexpected dialogs, session expiry, and slow/failed loads where applicable to the target. Recovery is not required for every condition; a clear stop or escalation may be correct. **Verify:** maintain a scenario-to-behavior mapping, exercise applicable cases, and explain any non-applicable cases. (§3.3)
  **Evidence:** Scenario-to-behavior matrix in [SCENARIOS.md](SCENARIOS.md), exercised live in [int-012-013](../evidence/int-012-013/README.md): validation error, missing record, permission denial, unexpected dialog, session expiry, slow and failed loads, lost browser.

Deterministic replay means decisions follow recorded rules without model reasoning. Different application data or runtime states may legitimately produce different outputs or outcomes.

## 4. Safety and data handling — required implementation

- [x] **SAFE-01 — Configurable allowlist.** Enforce an explicit policy for allowed targets and actions throughout discovery and replay. **Verify:** attempt an allowed operation and a disallowed operation through each execution path; confirm the latter is prevented. (§3.4)
  **Evidence:** Origin/action/control allowlists enforced in discovery, replay and manual control ([SAFETY.md](SAFETY.md)); tests in [executor.test.ts](../tests/executor.test.ts), [workflows.test.ts](../tests/workflows.test.ts), [runtime.test.ts](../tests/database/runtime.test.ts); live in [int-016](../evidence/int-016/README.md).
- [x] **SAFE-02 — Risk treatment.** Distinguish reversible actions from risky/irreversible actions and apply a documented conservative treatment. **Verify:** exercise a representative risky action or policy test and show the chosen block, confirmation, or flag behavior. (§3.4)
  **Evidence:** Declared risky controls blocked before dispatch on every path; live Close account block in [int-016](../evidence/int-016/README.md); justification in [REPORT: Safety](../REPORT.md#safety).
- [x] **SAFE-03 — Sensitive-data protection.** Do not persist secrets or raw sensitive data in artifacts or logs; redact retained evidence appropriately. **Verify:** use synthetic sensitive markers and inspect generated artifacts, logs, and richer evidence for leakage. (§3.4–3.5)
  **Evidence:** Synthetic-marker sweep across tables, events, evidence files and API responses in [runtime.test.ts](../tests/database/runtime.test.ts); model-input and goal tests in [safety.test.ts](../tests/safety.test.ts) and [workflows.test.ts](../tests/workflows.test.ts); exported evidence scanned ([evidence/README.md](../evidence/README.md)).
- [x] **SAFE-04 — Suitable target and data.** Use an authorized demo, sandbox, or local proxy with synthetic data; respect applicable public-site terms and rate limits. Keep secrets out of version control. **Verify:** document target/data provenance and inspect tracked files. (§4, §9)
  **Evidence:** Synthetic portal and data built in this repository ([PORTAL.md](PORTAL.md)); no public site is automated. Secrets live only in ignored `.env` files; tracked files were scanned for credential patterns before submission.

## 5. Evidence and observability — required implementation

- [x] **OBS-01 — Structured execution log.** Capture what the agent did and why, with enough context to understand and debug the run. **Verify:** reconstruct a run from its sanitized log. Decision summaries are sufficient; raw private model reasoning is not needed. (§3.5)
  **Evidence:** Run events in [discovery](../evidence/discovery.json) and [replay](../evidence/replay.json): each model decision summarized as action, control or field labels, binding name and reason; then the chosen operation and target, dispatch, completion, reads, rule matches and cleanup. Free-text model reasoning is deliberately not stored.
- [x] **OBS-02 — Rich failure evidence.** Capture at least one richer signal on failure, such as a screenshot, state snapshot, or trace. **Verify:** trigger a failure and inspect its sanitized evidence alongside the step-level error. (§3.5)
  **Evidence:** Structural failure snapshots: [identity mismatch](../evidence/int-016/hard-failure-evidence.json), [int-012-013 failures](../evidence/int-012-013/failure-evidence.json).

## 6. Human escalation and session handoff — required implementation

- [x] **HUM-01 — Detect and route intervention.** Detect a stuck/blocked condition and raise an operator-visible request containing the goal/capability, current step, current state or screenshot, and reason for stopping. **Verify:** trigger intervention and inspect what the operator receives. (§3.6)
  **Evidence:** Intervention with step, reason, checkpoint, session reference and screenshot; goal or capability shown to the operator: [int-014-015](../evidence/int-014-015/README.md).
- [x] **HUM-02 — Pause and establish ownership.** Pause automation and make the current controller explicit when transferring control to a human. **Verify:** confirm automation performs no actions while the operator owns the session. (§3.6)
  **Evidence:** Claim sets the controller and revision; no automation events while a human owns the run: [int-014-015](../evidence/int-014-015/README.md).
- [x] **HUM-03 — Same live session.** Let the human operate the existing session with its current state intact. **Verify:** perform a real manual action in that session; opening a fresh session does not pass. (§3.6)
  **Evidence:** Manual actions in the existing browser in both discovery and replay: [int-014-015](../evidence/int-014-015/README.md).
- [x] **HUM-04 — Hand back and continue.** Accept a resume signal, transfer control back, and allow the run to resume or complete safely. **Verify:** resolve an intervention manually and demonstrate continuation using the resulting state. (§3.6)
  **Evidence:** Validated resume, then completion with typed outputs: [int-014-015](../evidence/int-014-015/README.md).
- [x] **HUM-05 — Preserve context and manual-action evidence.** Retain run context across the handoff and record what the human did. **Verify:** inspect one continuous run record covering automation, manual actions, and resumption, with redaction applied. (§3.6)
  **Evidence:** One run record with automation, human and control events; manual contribution saved in the [capability](../evidence/int-014-015/capability.json).

The operator interface may be minimal or mocked. The pause, live-session access, ownership transfer, manual-action capture, and resumption must be real.

## 7. Extensibility — required design, not additional platforms

- [x] **DES-01 — Surface boundary.** Explain how the flow representation is separated from surface observation/action, including extension to legacy web and/or desktop applications. Address assumptions about clean DOMs, selectors, and accessibility. **Verify:** the report identifies the relevant boundary and its limitations in the implemented system. (§3.7)
  **Evidence:** [REPORT: Heterogeneity & multi-tenant](../REPORT.md#heterogeneity--multi-tenant), surface seam and assumptions.
- [x] **DES-02 — Reuse across institutions.** Explain shared vendor capabilities, safe tenant-specific specialization/overrides, and tenant/version drift detection and management. **Verify:** the report gives a concrete example and connects it to the artifact design. Working multi-tenant support is not required. (§3.7)
  **Evidence:** [REPORT: Heterogeneity & multi-tenant](../REPORT.md#heterogeneity--multi-tenant): vendor capability, tenant binding, override precedence, drift detection.

## 8. Repository and deliverables — required submission content

Paths in this section are relative to the repository root.

- [x] **DEL-01 — Runnable source.** Provide readable, reasonably typed source with meaningful tests for important behavior, in a public GitHub repository at submission. **Verify:** run the documented setup and checks from a clean checkout. (§6–7)
  **Evidence:** Public repository https://github.com/Gervonte/interface-ai; `pnpm check` (262 tests) and `pnpm check:db` (43 PostgreSQL tests) pass, including from a clean clone.
- [x] **DEL-02 — README.** Include setup, keys/configuration, any supported operation without live services, and exact discovery-then-replay demo commands in `/README.md`. **Verify:** follow those commands from a clean checkout. Clearly distinguish mock/offline operation from genuine discovery. (§6)
  **Evidence:** [README.md](../README.md): setup, keys, offline checks, exact discovery-then-replay demo, and local replay without hosted services ([evidence](../evidence/local-replay/README.md)).
- [x] **DEL-03 — Design report.** Provide approximately 1–3 pages in `/REPORT.md` with the seven headings listed below; explain decisions, trade-offs, limitations, deliberate mocks/cuts, and next steps. **Verify:** compare the report with the implementation and assignment. (§6)
  **Evidence:** [REPORT.md](../REPORT.md) with the seven headings.
- [x] **DEL-04 — Genuine run evidence.** Include a saved example capability and sanitized logs from a real discovery run and a replay run in `/evidence/`. **Verify:** identify which discovery produced the artifact and which replay consumed it. (§4, §6)
  **Evidence:** [evidence/README.md](../evidence/README.md): capability, discovery, replay and a not-found replay from one chain.

Required report headings:

1. Architecture
2. Artifact schema
3. Determinism & error handling
4. Heterogeneity & multi-tenant
5. Escalation & handoff
6. Safety
7. Cuts

Publishing and submitting the repository are later delivery actions. This checklist does not initiate either action.

## Proposed acceptance demonstration

These scenarios make the requirements concrete without choosing a target or implementation. One scenario can cover several criteria.

| Scenario | Observable pass condition | Main coverage |
| --- | --- | --- |
| Live discovery | Given a goal and target, a real LLM completes a multi-step UI flow and emits a saved capability. | DISC, ART, OBS |
| Replay with changed input | The same artifact runs with a different valid input, makes no model decisions, verifies success, and returns corresponding typed outputs. | ART-03, REP-01–04 |
| Business outcome | A valid invocation with no matching record returns a known business outcome. | REP-05 |
| Recoverable interruption | A supported temporary condition recovers within its configured bounds; an exhausted recovery stops clearly. | REP-06 |
| Runtime failure | An unrecoverable condition stops execution with step-level context and richer failure evidence. | REP-07–08, OBS-02 |
| Human takeover | A blocked run requests intervention; a person operates the same session; automation remains paused, then resumes after hand-back; manual actions are recorded. | HUM-01–05 |
| Policy enforcement | Disallowed actions are prevented in discovery and replay, and a risky action receives the declared conservative treatment. | SAFE-01–02 |
| Data handling | Synthetic sensitive values do not leak into retained artifacts, logs, or failure evidence. | SAFE-03–04 |

The target-specific failure matrix should cover the applicable conditions in REP-08. This table is a demonstration outline, not a claim that one example proves all failure handling.

## Optional evidence and stretch scope

The assignment encourages saving an exceptional replay in `/evidence/`; a screen recording is optional. Saving a takeover demonstration would also help substantiate HUM-01–05. These evidence additions support required behavior but are not separately mandated deliverable formats.

Keep the following out of the baseline unless deliberately selected after the core passes: a capability catalog/API, generated automation code, artifact approval scoring, assisted LLM recovery, a working cross-tenant demonstration, and multi-run stability reporting. The assignment suggests at most one or two stretch goals.

Full operator consoles, desktop implementation, multi-tenant infrastructure, queues, and clusters are not baseline requirements.

## Design decisions tracked separately

- Target application, specific workflow, input/output examples, and applicable failure cases.
- Language, runtime, model/provider, computer-use technology, and architecture.
- Artifact format, targeting strategy, checkpoints, recovery rules, and result representation.
- Risk classifications, policy enforcement, redaction, and evidence retention approach.
- Session ownership, operator interaction, action capture, and resume validation.

These choices are tracked through the user's system-design framework and the linked design documents. The baseline must satisfy every required criterion; optional follow-on work can remain under Cuts. In particular, contact updates and deeper restart recovery do not gate the balance-workflow submission baseline.
