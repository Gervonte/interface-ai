# Acceptance checklist

Status: implementation in progress through INT-013. The first live balance discovery/replay proof is linked in [evidence/int-009-011](evidence/int-009-011/README.md). The scenario/recovery matrix is linked in [evidence/int-012-013](evidence/int-012-013/README.md). Full operator-handoff and privacy acceptance remains pending.

Source: *Assignment A — Computer-Use Automation System*, especially sections 3–7 and 9. Section references below refer to that assignment.

This checklist defines observable outcomes independently of implementation choices. The selected stack, agreed balance workflow, and reviewed implementation order are tracked in STACK.md, DEMO_WORKFLOW.md, and IMPLEMENTATION_PLAN.md. Planning coverage is not verification. The assessment-wide boxes remain unchecked pending the complete baseline verification; milestone evidence records the narrower behavior already demonstrated.

## How to use this checklist

- Required behavior and deliverables come from the assignment. Verification methods are proposed ways to demonstrate compliance, not additional assignment requirements.
- Check an item only after linking to supporting code, a test, a run, or the relevant design explanation. A planned feature is not a pass.
- All required areas need a working minimum where implementation is required. A polished subset does not satisfy the assignment.
- Keep optional evidence and stretch work separate from the required scope.

## 1. Live discovery — required implementation

- [ ] **DISC-01 — Goal and target input.** Accept a natural-language goal and a target application or entry point. **Verify:** supply both through the documented interface. (§3.1)
- [ ] **DISC-02 — Genuine model-driven interaction.** An LLM observes the live UI, chooses actions, and actually operates it through a non-trivial multi-step flow. **Verify:** capture at least one successful live discovery run with evidence connecting observations, decisions, actions, and the resulting UI state. A scripted or mocked model run alone does not qualify. (§3.1, §4)
- [ ] **DISC-03 — Bounded execution.** Discovery stops when the goal is met or a defined limit/dead-end is reached. **Verify:** demonstrate success and a stopping condition; inspect configured step/time limits and dead-end handling. (§3.1)

## 2. Reusable capability artifact — required implementation

- [ ] **ART-01 — Saved artifact from a successful run.** Emit a typed, serializable, versioned artifact representing the successful flow, separate from the raw model transcript. **Verify:** save and reload the emitted artifact and trace its actions to the discovery run. (§3.2)
- [ ] **ART-02 — Explicit actions and targets.** Represent ordered actions and how each target control is identified. **Verify:** inspect the artifact and explain why its targeting strategy is robust for the chosen surface. (§3.2)
- [ ] **ART-03 — Typed invocation contract.** Declare input parameters, output types/shapes, and what data to extract. **Verify:** inspect the contract and invoke it with supplied inputs; confirm returned outputs match the declaration. (§3.2)
- [ ] **ART-04 — Success condition.** Record a checkpoint or success condition that can be evaluated during replay. **Verify:** show both a satisfied condition and a case where an unmet condition prevents a success result. (§3.2–3.3)
- [ ] **ART-05 — Reviewability.** A reviewer or calling agent can understand what the capability does, needs, and returns from the artifact and its schema documentation. **Verify:** review a saved example without relying on the discovery transcript. (§3.2)

## 3. Deterministic replay and outcomes — required implementation

- [ ] **REP-01 — Replay without model decisions.** Execute a saved artifact with invocation inputs without asking an LLM what to do. **Verify:** replay with model access disabled or with instrumentation that would fail on a model call. (§3.3)
- [ ] **REP-02 — Reusable inputs.** Use invocation parameters rather than retaining discovery-specific values where parameters are declared. **Verify:** replay the same artifact with a different valid input and confirm the corresponding output. (§3.2–3.3; proposed proof of parameterization)
- [ ] **REP-03 — Stable targeting and synchronization.** Resolve controls reliably and wait for required UI states before proceeding. **Verify:** explain target resolution and waiting rules, then exercise a delayed transition. (§3.3, §7)
- [ ] **REP-04 — Verified outputs.** Evaluate the declared success condition and return declared outputs to the caller. **Verify:** compare the structured result with the actual UI state and artifact contract. (§3.3)
- [ ] **REP-05 — Business outcomes.** Represent expected outcomes, such as no matching record, separately from execution failures. **Verify:** trigger a legitimate negative business result and inspect its structured result. (§3.3)
- [ ] **REP-06 — Recoverable conditions.** Recognize supported transient/known conditions and apply deliberate recovery. **Verify:** trigger a supported condition, observe bounded waiting/retry or a known recovery action, and demonstrate stopping when recovery is exhausted. (§3.3)
- [ ] **REP-07 — Hard failures.** Stop safely when execution cannot proceed and report the step, expected state, and observed state. **Verify:** inject an unrecoverable condition and confirm no subsequent automated step blindly executes. (§3.3)
- [ ] **REP-08 — Runtime exception coverage.** Deliberately handle validation errors, missing records, permission denial, unexpected dialogs, session expiry, and slow/failed loads where applicable to the target. Recovery is not required for every condition; a clear stop or escalation may be correct. **Verify:** maintain a scenario-to-behavior mapping, exercise applicable cases, and explain any non-applicable cases. (§3.3)

Deterministic replay means decisions follow recorded rules without model reasoning. Different application data or runtime states may legitimately produce different outputs or outcomes.

## 4. Safety and data handling — required implementation

- [ ] **SAFE-01 — Configurable allowlist.** Enforce an explicit policy for allowed targets and actions throughout discovery and replay. **Verify:** attempt an allowed operation and a disallowed operation through each execution path; confirm the latter is prevented. (§3.4)
- [ ] **SAFE-02 — Risk treatment.** Distinguish reversible actions from risky/irreversible actions and apply a documented conservative treatment. **Verify:** exercise a representative risky action or policy test and show the chosen block, confirmation, or flag behavior. (§3.4)
- [ ] **SAFE-03 — Sensitive-data protection.** Do not persist secrets or raw sensitive data in artifacts or logs; redact retained evidence appropriately. **Verify:** use synthetic sensitive markers and inspect generated artifacts, logs, and richer evidence for leakage. (§3.4–3.5)
- [ ] **SAFE-04 — Suitable target and data.** Use an authorized demo, sandbox, or local proxy with synthetic data; respect applicable public-site terms and rate limits. Keep secrets out of version control. **Verify:** document target/data provenance and inspect tracked files. (§4, §9)

## 5. Evidence and observability — required implementation

- [ ] **OBS-01 — Structured execution log.** Capture what the agent did and why, with enough context to understand and debug the run. **Verify:** reconstruct a run from its sanitized log. Decision summaries are sufficient; raw private model reasoning is not needed. (§3.5)
- [ ] **OBS-02 — Rich failure evidence.** Capture at least one richer signal on failure, such as a screenshot, state snapshot, or trace. **Verify:** trigger a failure and inspect its sanitized evidence alongside the step-level error. (§3.5)

## 6. Human escalation and session handoff — required implementation

- [ ] **HUM-01 — Detect and route intervention.** Detect a stuck/blocked condition and raise an operator-visible request containing the goal/capability, current step, current state or screenshot, and reason for stopping. **Verify:** trigger intervention and inspect what the operator receives. (§3.6)
- [ ] **HUM-02 — Pause and establish ownership.** Pause automation and make the current controller explicit when transferring control to a human. **Verify:** confirm automation performs no actions while the operator owns the session. (§3.6)
- [ ] **HUM-03 — Same live session.** Let the human operate the existing session with its current state intact. **Verify:** perform a real manual action in that session; opening a fresh session does not pass. (§3.6)
- [ ] **HUM-04 — Hand back and continue.** Accept a resume signal, transfer control back, and allow the run to resume or complete safely. **Verify:** resolve an intervention manually and demonstrate continuation using the resulting state. (§3.6)
- [ ] **HUM-05 — Preserve context and manual-action evidence.** Retain run context across the handoff and record what the human did. **Verify:** inspect one continuous run record covering automation, manual actions, and resumption, with redaction applied. (§3.6)

The operator interface may be minimal or mocked. The pause, live-session access, ownership transfer, manual-action capture, and resumption must be real.

## 7. Extensibility — required design, not additional platforms

- [ ] **DES-01 — Surface boundary.** Explain how the flow representation is separated from surface observation/action, including extension to legacy web and/or desktop applications. Address assumptions about clean DOMs, selectors, and accessibility. **Verify:** the report identifies the relevant boundary and its limitations in the implemented system. (§3.7)
- [ ] **DES-02 — Reuse across institutions.** Explain shared vendor capabilities, safe tenant-specific specialization/overrides, and tenant/version drift detection and management. **Verify:** the report gives a concrete example and connects it to the artifact design. Working multi-tenant support is not required. (§3.7)

## 8. Repository and deliverables — required submission content

Paths in this section are relative to the repository root.

- [ ] **DEL-01 — Runnable source.** Provide readable, reasonably typed source with meaningful tests for important behavior, in a public GitHub repository at submission. **Verify:** run the documented setup and checks from a clean checkout. (§6–7)
- [ ] **DEL-02 — README.** Include setup, keys/configuration, any supported operation without live services, and exact discovery-then-replay demo commands in `/README.md`. **Verify:** follow those commands from a clean checkout. Clearly distinguish mock/offline operation from genuine discovery. (§6)
- [ ] **DEL-03 — Design report.** Provide approximately 1–3 pages in `/REPORT.md` with the seven headings listed below; explain decisions, trade-offs, limitations, deliberate mocks/cuts, and next steps. **Verify:** compare the report with the implementation and assignment. (§6)
- [ ] **DEL-04 — Genuine run evidence.** Include a saved example capability and sanitized logs from a real discovery run and a replay run in `/evidence/`. **Verify:** identify which discovery produced the artifact and which replay consumed it. (§4, §6)

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
