# Implementation Plan

Status: draft for review. All items are pending; this document does not report completed implementation or authorize publishing/submission.

Selected stack: TypeScript/Node.js, Express, Zod, PostgreSQL, React + Vite + Mantine, and Browserbase/Stagehand. See [STACK.md](STACK.md), [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md), [DEMO_WORKFLOW.md](DEMO_WORKFLOW.md), and [ACCEPTANCE.md](ACCEPTANCE.md).

Work in dependency order. Keep IDs stable; append new IDs rather than renumbering existing work. Mark an item complete only with code/run/test evidence. Verification belongs with its implementing task; later review checks the assembled system. Mocked tests can verify contracts but never substitute for genuine discovery evidence.

Assessment baseline: one complete balance workflow, including real discovery, saved artifact, changed-input replay, business outcomes/recovery/failure, same-session human help, safe evidence, and the required documentation. The preferred-email update remains planned follow-on work; neither it nor the deeper restart-recovery suite blocks baseline readiness. Its proposed human Save boundary is finalized with its implementation and must remain explicit in the capability.

Execution order follows the dependencies and sections below, not the numeric ID. Existing IDs are preserved: INT-021/INT-022 now precede the follow-on INT-018–INT-020 and INT-017 work.

## Foundation and provider validation

1. **INT-001 — Scaffold the TypeScript workspace.**

    Set up separate automation backend, operator frontend, and demo-target applications, with shared public contracts where useful. Select workspace/package tooling and a meaningful unit/integration test runner; pin compatible Node, SDK, UI, and TypeScript versions. Add development/build/typecheck scripts, ignored runtime storage, and secret-free configuration examples. Keep target business access out of shared automation packages.

    **Done when:** the minimal Express apps and React/Vite/Mantine frontends start independently, build and typecheck; a documented root command starts the local components. **Depends on:** none. **Acceptance:** DEL-01, SAFE-04.

2. **INT-002 — Establish Browserbase access and fixture connectivity.**

    Configure runtime Browserbase credentials securely without committing them. Select and record a supported discovery model/configuration through Model Gateway. Provide one small synthetic fixture, including a frame and repeated table controls, at an address reachable by the hosted browser. Choose the minimum deployment/connectivity mechanism and document start/stop and required configuration.

    **Done when:** TypeScript creates a real hosted session, loads the fixture, records its non-secret ID, and terminates the session; the backend stays responsive during the operation. No business-data shortcut is used. **Depends on:** INT-001. **Acceptance:** SAFE-04, DEL-02.

3. **INT-003 — Prove the delegated SDK supports our execution boundaries.**

    Obtain a real Stagehand model-proposed action; inspect it before mutation, execute and serialize it, then apply a changed synthetic value using deterministic methods with self-healing disabled. Verify targeting, readiness, text extraction, inference instrumentation, same-session manual action capture/control hand-back, and capture/cleanup behavior. Use the smallest temporary operator surface needed for this proof; do not build the full console yet.

    **Done when:** a short recorded result identifies what Browserbase/Stagehand supplies, proves a deterministic action path with inference forbidden, and demonstrates manual input in the same session. Unsupported details have a concrete TypeScript adapter solution or a clearly identified gap before broader implementation. This fixture proof is not the final discovery demo. **Depends on:** INT-002. **Acceptance:** REP-01, REP-03, HUM-02, HUM-03, HUM-05, DES-01.

## First balance discovery and replay slice

4. **INT-004 — Implement the public contracts and capability schema.**

    Define Zod request/result/action/envelope contracts and the constrained serializable input/output schema representation with its runtime validator. Define versioned steps, scoped targets, parameter references, pre/postconditions, output extraction, and business-outcome/recovery representations. Resolve the balance contract against the workflow document; include blocked-run context and a representation for supported manual contributions/intervention requirements; add write-specific commit semantics with the second capability. Choose finite initial budgets and document them as adjustable configuration.

    **Done when:** valid contracts round-trip; unknown versions/operations, missing references, invalid bindings, and executable content are rejected. Embedded invocation/output schemas actually validate values; parsing the envelope alone is insufficient. **Depends on:** INT-003. **Acceptance:** ART-02, ART-03, ART-04, ART-05.

5. **INT-005 — Set up PostgreSQL persistence and isolated target data.**

    Select database access/migration tooling. Create automation migrations for capabilities, runs, interventions, events, and request receipts with version/sequence/receipt uniqueness and consistent references. Create a separate demo database/application role. Add deterministic seed/reset commands for synthetic members/accounts and retained non-secret configuration versions.

    **Done when:** migrations work from an empty development database; fixtures reset predictably; automation credentials cannot read the target's business tables. Core repository transactions and receipt uniqueness have meaningful integration coverage. **Depends on:** INT-001, INT-004. **Acceptance:** DEL-01, SAFE-04.

6. **INT-006 — Build the balance-lookup target UI.**

    Implement member search/results, member profile, account list, and savings details with React/Vite/Mantine and the separate target backend/database. Include the framed workspace, repeated Open controls, visible primary-savings designation, and differing account order for M1001/M1002. Display current balance and currency unambiguously. Keep ordinary accessible labels; do not depend on generated library IDs or test IDs.

    **Done when:** a person can complete the multi-step lookup for both seeded members and see the specified different balances. The same UI is reachable by Browserbase; fixture data is not exposed to the automation's execution path. **Depends on:** INT-002, INT-005. **Acceptance:** DISC-02, REP-02, SAFE-04.

7. **INT-007 — Implement the shared executor and safe recording boundary.**

    Wrap supported SDK operations with policy, owner/revision checks, action serialization, scoped unique targeting, bounded state waits, and deterministic extraction. Preserve unknown action outcomes and stop/escalate rather than repeat uncertain actions; this safety behavior is baseline, not deferred restart hardening. Record safe action intent/result events and richer evidence through a sanitization boundary before storage. Do not implement speculative fallback locators, model recovery, or blind action retries.

    **Done when:** allowed operations execute, disallowed/ambiguous operations dispatch nothing, deadlines stop waiting, and a representative failure produces a useful sanitized snapshot or screenshot. Synthetic sensitive markers are excluded from retained event/capture fields. **Depends on:** INT-003, INT-004, INT-005. **Acceptance:** REP-03, SAFE-01, SAFE-03, OBS-01, OBS-02.

8. **INT-008 — Implement run coordination and the initial API.**

    Add Express/Zod endpoints for starting and reading runs, exact capability retrieval, events, and safe cancellation. Run UI work outside request handlers. Pin configurations, enforce one active run including human pauses, provide basic authentication/authorization, and atomically associate accepted mutations with request receipts. Define safe result/output-availability behavior. Enforce one coordinator for the runtime store and finite session lifetimes. On restart, leave interrupted work stopped and mark it explicitly; require confirmed closure/expiry of its old session before admitting another run. Documented manual reconciliation is acceptable for the baseline; automatic cleanup/reconciliation scenarios are follow-on INT-017.

    **Done when:** run creation returns a reference promptly; callers can inspect progress/results; duplicate creation requests resolve to one run and a second distinct active run is rejected. Invalid requests, capability inputs, and authorization failures return the documented contracts. Stopping or restarting the backend never silently redispatches interrupted UI work; session cleanup uncertainty blocks new admission. **Depends on:** INT-004, INT-005, INT-007. **Acceptance:** DISC-01, DISC-03, REP-07, DEL-01.

9. **INT-009 — Implement model-driven discovery and artifact construction.**

    Use Stagehand's AI primitives to propose next UI actions from the goal and observed state, under a bounded TypeScript loop. Execute through INT-007 and derive steps from confirmed action history with explicit parameter bindings. Verify UI completion and typed outputs before transactionally publishing a capability version. Treat authored recovery rules as such; do not infer their correctness from the happy path. Discovery dead-ends or unsafe next actions must raise structured intervention context through the shared coordinator; reaching a hard budget limit still stops clearly. INT-014/INT-015 complete and verify this handoff path.

    **Done when:** the system accepts a goal and target, performs genuinely model-selected UI actions, and saves a reloadable parameterized capability traceable to the run. Invalid construction or goal completion fails clearly rather than fabricating a capability. **Depends on:** INT-006, INT-007, INT-008. **Acceptance:** DISC-01, DISC-02, DISC-03, ART-01, ART-02, ART-03, ART-04, ART-05.

10. **INT-010 — Implement deterministic capability replay.**

    Interpret an exact saved capability version with new inputs, resolving targets and conditions through the shared executor. Read outputs through deterministic UI operations, verify member/account identity and amounts, and distinguish terminal success/outcome/failure. Keep the replay path free of model-dependent discovery/extraction and self-healing.

    **Done when:** a saved capability is loaded in a later process and replays for another member; observed UI outputs match its contract. Instrumented model access fails on any attempted inference. Wrong-record/invalid-output checks prevent success. **Depends on:** INT-009. **Acceptance:** REP-01, REP-02, REP-03, REP-04, ART-04.

11. **INT-011 — Capture the first real end-to-end milestone.**

    Reset fixtures, run live discovery for M1001, export the actual artifact, then replay that version for M1002 with inference forbidden. Retain sanitized run logs/results and the model/configuration identity. Document the exact reproducible commands. Diagnose and fix integration failures before expanding scope.

    **Done when:** a reviewer can follow goal → genuine discovery → saved artifact → changed-input replay with the expected different balance and zero replay model calls. Evidence is real and clearly distinguished from fixture tests or illustrative examples. **Depends on:** INT-010. **Acceptance:** DISC-02, ART-01, REP-01, REP-02, REP-04, OBS-01, DEL-02, DEL-04.

## Baseline exceptions and human intervention

12. **INT-012 — Add repeatable target scenarios.**

    Add setup-controlled missing-member/no-primary-savings/access-denied outcomes, slow/failed loading, known interstitial, unexpected modal, synthetic session expiry, validation error, and wrong/duplicate record states. Trigger them through separate fixture setup, not undocumented powers given to the automation agent. Add a way for a person to resolve the manual cases inside the live UI. The blocking-modal/restoration scenario must be triggerable independently during discovery and replay.

    **Done when:** each scenario resets predictably and exposes an explicit visible state; baseline fixtures still work. Browser destruction and in-page session expiry can be tested separately. **Depends on:** INT-006, INT-011. **Acceptance:** REP-05, REP-06, REP-08, HUM-01.

13. **INT-013 — Implement declared business outcomes and bounded recovery.**

    Attach and validate the scenario detectors/rules in capability versions. Handle legitimate negatives, known recoveries, exhausted deadlines, ambiguity, and session loss explicitly. Define outcome precedence/conflict handling and preserve the failed step/expected/observed context. Do not label missing automation controls as a business no-match result.

    **Done when:** applicable scenarios produce the documented structured result; a known notice recovers, persistent failure stops, conflicting signals never produce false success, and action-dispatch assertions show no duplicate submits/clicks. **Depends on:** INT-007, INT-010, INT-012. **Acceptance:** REP-05, REP-06, REP-07, REP-08, OBS-02.

14. **INT-014 — Implement intervention state and exclusive control transfer.**

    Add intervention inspection, claim, resume, operation inspection, and manual observation/action APIs. Close admissions, drain/account for in-flight actions, record controller/revision transitions, and validate explicit continuation checkpoints. Handle stale requests, competing claims, cancellation races, operator disconnect, deadlines, and lost sessions without replacing the session silently.

    **Done when:** one actor controls dispatch at a time; stale/late actions are rejected, and a paused run keeps its identity/context. Race tests assert actual dispatched actions and show that hand-back cannot duplicate an already-completed step. Both discovery and replay route blocked states into this coordinator; only discovery may return to model reasoning after validated hand-back. **Depends on:** INT-003, INT-008, INT-012, INT-013. **Acceptance:** HUM-01, HUM-02, HUM-03, HUM-04, HUM-05, SAFE-02.

15. **INT-015 — Build the minimal operator UI and demonstrate real takeover.**

    Use React/Vite/Mantine to start/inspect runs, inspect capability/evidence, see intervention context, claim the session, act manually, and hand back. Use provider controls where INT-003 established equivalent guarantees; otherwise use the mediated interface. Avoid building a full co-browsing product.

    **Done when:** two real demonstrations pass: (1) discovery gets blocked, requests help, accepts a manual resolution in its existing session, resumes, and constructs a valid capability that explicitly accounts for the human contribution; (2) replay gets blocked, accepts manual help in its existing session, and completes after deterministic resume validation with no model calls. Each demonstration preserves its run/session identity and includes manual-action and ownership evidence. Unrepresentable human steps must not be silently omitted from an artifact. **Depends on:** INT-014. **Acceptance:** DISC-02, ART-01, HUM-01, HUM-02, HUM-03, HUM-04, HUM-05, OBS-01.

16. **INT-016 — Verify policy, redaction, and result/evidence access end to end.**

    Exercise restrictions in discovery, replay, and manual control; embedded UI instructions must not override policy. Inspect actual model-bound observations, database rows, event files, error paths, enabled provider captures, and output expiry behavior with synthetic markers. Verify unauthorized access and unsupported capture suppression. Document provider/settings and redaction limits.

    **Done when:** forbidden operations dispatch nothing; permitted human actions do not override unrelated restrictions; secret markers reach only permitted destinations; a useful safe richer failure artifact exists. Unsupported privacy guarantees are reported rather than claimed. **Depends on:** INT-013, INT-015. **Acceptance:** SAFE-01, SAFE-02, SAFE-03, SAFE-04, OBS-02.

## Baseline evidence and assessment readiness

17. **INT-021 — Assemble baseline evidence and operating instructions.**

    Collect genuine balance discovery/changed-input replay, a business outcome, bounded recovery/failure, and same-session human takeover during both discovery and replay. Export actual artifacts with linked sanitized logs/results/configuration references under `evidence/`. Document clean setup, PostgreSQL migration/seed/reset, model/service configuration, exact commands, minimal safe-stop/session-cleanup behavior, limits, and supported tests without live services in README.

    **Done when:** the complete balance workflow is reproducible and its evidence traces to the actual producing/consuming runs. The package contains no fabricated examples, credentials, raw runtime databases, profiles, or unsafe captures. Required paths and concrete commands exist. Contact-update evidence and deeper recovery tests can be added later; neither is a prerequisite. **Depends on:** INT-011, INT-013, INT-015, INT-016. **Acceptance:** DEL-01, DEL-02, DEL-04, SAFE-03, SAFE-04.

18. **INT-022 — Write the baseline report and verify assessment readiness.**

    Produce REPORT.md at approximately 1–3 pages with the assignment's seven headings: Architecture; Artifact schema; Determinism & error handling; Heterogeneity & multi-tenant; Escalation & handoff; Safety; Cuts. Describe the actual implementation, Browserbase delegation, tested limits, deliberate mocks, and follow-on work. Reconcile the design documents and run the documented demo from a clean checkout.

    For heterogeneity/reuse, include one concrete design example: a shared vendor capability, target/environment bindings, a safe tenant-specific override with clear precedence, and detection/handling of an incompatible tenant/application version. Explain the perception/action boundary and how legacy web/desktop adapters would fit. A diagram or configuration example is sufficient; implementing a second tenant or desktop surface is not required.

    **Done when:** every required acceptance criterion passes with linked tests, genuine run evidence, or the required design explanation. An unresolved required criterion blocks baseline readiness; unresolved optional/follow-on work belongs under Cuts and does not block it. The concise report and exact-path deliverables accurately describe a runnable complete balance workflow. Confirm required public-repository visibility before labeling the submission ready; if it is outstanding, surface it as a separate delivery action rather than treating that criterion as passed. Sending the submission link remains a separate user-controlled action. This task does not itself publish, push, or email anything. **Depends on:** INT-021. **Acceptance:** DES-01, DES-02, DEL-01, DEL-02, DEL-03, DEL-04.

## Planned follow-on: second capability

19. **INT-018 — Add the synthetic contact edit/review workflow.**

    Extend the same member profile with preferred-email edit, before/after review, Save/Cancel, persisted changes, and a UI-visible change reference. Add invalid-email, already-current, and delayed-confirmation scenarios. Use synthetic addresses only; no email delivery. Keep the target backend/database separate.

    **Done when:** a person can edit, review, save, reopen, and verify one persisted change; cancelling review makes no change. A test can assert commit count independently while automation remains UI-only. **Depends on:** INT-015, INT-022. **Acceptance:** planned second-demo scope; supports SAFE-02, REP-07, HUM-03, HUM-04.

20. **INT-019 — Add explicit human commit to capability discovery/replay.**

    Finalize the write input/output contract and explicit human-required commit step. Model-driven discovery reaches review, pauses for a real operator Save, verifies the result, and saves a separate write capability. Replay with a different member/email must preserve the human boundary and then verify persisted contact state, member identity, and change reference. Handle `ALREADY_CURRENT` without saving.

    **Done when:** both discovery and replay complete the write workflow in the same session across handoff; the artifact never converts the manual Save into an unattended click. The read capability remains independently invocable and model-free on replay. **Depends on:** INT-004, INT-009, INT-010, INT-014, INT-018. **Acceptance:** ART-01, ART-03, ART-04, REP-01, REP-04, SAFE-02, HUM-03, HUM-04, HUM-05.

21. **INT-020 — Prove uncertain write outcomes do not cause duplicate commits.**

    Inject Save-applied/confirmation-lost behavior and hand-back while the write is settling. Use permitted UI verification to distinguish applied, rejected, and unknown effects. If attribution remains uncertain, stay paused or fail explicitly. Demonstrate invalid input, denial, and cancelled review without stored changes.

    **Done when:** the write demo records exactly one intended commit where confirmed and never dispatches a second Save merely because confirmation was lost. Safe evidence distinguishes verified success from uncertainty and captures human actions. **Depends on:** INT-019. **Acceptance:** REP-05, REP-07, REP-08, SAFE-02, HUM-04, OBS-02.

## Follow-on: deeper persistence and restart recovery

22. **INT-017 — Extend persistence failure and restart recovery (follow-on).**

    After baseline readiness, deepen the existing safe-stop and transaction behavior: request fingerprint/retention edge cases, pending-command retries, evidence-file orphan/missing-reference reconciliation, regenerable exports, and automated leftover-session cleanup. Include provider-session creation interrupted before its ID was saved. Preserve baseline no-redispatch/admission-blocking rules throughout.

    **Done when:** controlled crash/lost-response scenarios preserve explicit uncertainty and cannot duplicate actions; exports regenerate without another workflow; stale claims do not restore access; cleanup reconciliation handles or clearly reports leftover sessions/files. These tests extend the baseline rather than gate its report/evidence. **Depends on:** INT-008, INT-014, INT-016, INT-022. **Acceptance:** additional assurance for REP-07, HUM-02, HUM-05, OBS-01, DEL-01; baseline coverage is provided by INT-007/INT-008/INT-014/INT-016.

## Milestone boundaries

| Milestone | Exit point | Observable result |
| --- | --- | --- |
| Provider fit | INT-003 | Delegated control, deterministic action, and same-session handoff are technically viable. |
| First discovery/replay slice | INT-011 | Real balance discovery, saved capability, and changed-input replay with zero inference. This is not yet the full assessment baseline. |
| Required runtime behavior assembled | INT-016 | Business outcomes, bounded recovery/failure, real discovery/replay takeover, safe stopping/session cleanup, and safety/evidence work together. |
| Assessment baseline ready | INT-022 | All required acceptance criteria pass; curated evidence, runnable README, and concise report are ready. Required public-repository visibility is confirmed; sending the submission link remains a separate delivery action. |
| Both workflows demonstrated | INT-020 | Follow-on read/write demonstrations share the app; uncertain writes do not trigger duplicate commits. |
| Additional restart assurance | INT-017 | Deeper recovery/failure-injection scenarios pass without being prerequisites for baseline readiness or the write workflow. |

The required critical path reaches INT-016 → INT-021 → INT-022. INT-018–INT-020 and INT-017 remain planned follow-on work and are not ancestors of baseline readiness. If completed, add their real evidence and update the report/Cuts; do not imply pending features are part of the implemented submission.

If a dependency changes, update affected items explicitly while preserving IDs. Do not expand into desktop implementation, multi-tenant infrastructure, a general capability catalog, or extra automation frameworks to compensate for unresolved core behavior.
