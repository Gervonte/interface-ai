# Implementation Plan

Status: INT-001 through INT-011 are implemented and verified at their stated scope. INT-009/010/011 form the first live discovery, saved-artifact, and fresh-process replay milestone. Scenario recovery and full operator handoff remain INT-012 onward. Completion details are linked below. This plan does not authorize publishing/submission.

Selected stack: TypeScript/Node.js, Express, Zod, PostgreSQL, React + Vite + Mantine, and Browserbase/Stagehand. See [STACK.md](STACK.md), [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md), [DEMO_WORKFLOW.md](DEMO_WORKFLOW.md), and [ACCEPTANCE.md](ACCEPTANCE.md).

Work in dependency order. Keep IDs stable; append new IDs rather than renumbering existing work. Mark an item complete only with code/run/test evidence. Verification belongs with its implementing task; later review checks the assembled system. Mocked tests can verify contracts but never substitute for genuine discovery evidence.

Assessment baseline: one complete balance workflow, including real discovery, saved artifact, changed-input replay, business outcomes/recovery/failure, same-session human help, safe evidence, and the required documentation. The preferred-email update remains planned follow-on work; neither it nor the deeper restart-recovery suite blocks baseline readiness. Its proposed human Save boundary is finalized with its implementation and must remain explicit in the capability.

Execution order follows the dependencies and sections below, not the numeric ID. Existing IDs are preserved: INT-021/INT-022 now precede the follow-on INT-018–INT-020 and INT-017 work.

## Foundation and provider validation

1. **INT-001 — Scaffold the TypeScript workspace. (Complete)**

    Set up separate automation backend, operator frontend, and demo-target applications, with shared public contracts where useful. Select workspace/package tooling and a meaningful unit/integration test runner; pin compatible Node, SDK, UI, and TypeScript versions. Add development/build/typecheck scripts, ignored runtime storage, and secret-free configuration examples. Keep target business access out of shared automation packages.

    **Done when:** the minimal Express apps and React/Vite/Mantine frontends start independently, build and typecheck; a documented root command starts the local components. **Depends on:** none. **Acceptance:** DEL-01, SAFE-04.

    **Verified:** pinned pnpm workspace, separate Express APIs and Mantine frontends, public contracts, safe configuration examples, six HTTP boundary tests, passing typecheck/build, and root startup with both UI/API connections. See [README verification](README.md#int-001-verification). DEL-01/SAFE-04 are only partially supported here; their complete assessment checks remain pending.

2. **INT-002 — Establish Browserbase access and fixture connectivity. (Complete)**

    Configure runtime Browserbase credentials securely without committing them. Select and record a supported discovery model/configuration through Model Gateway. Provide one small synthetic fixture using the planned staff-shell/frame and repeated account-table control patterns from DEMO_WORKFLOW.md, at an address reachable by the hosted browser. This is a compatibility fixture, not a substitute for the staff portal in INT-006. Choose the minimum deployment/connectivity mechanism and document start/stop and required configuration.

    **Done when:** TypeScript creates a real hosted session, loads the fixture, records its non-secret ID, and terminates the session; the backend stays responsive during the operation. No business-data shortcut is used. **Depends on:** INT-001. **Acceptance:** SAFE-04, DEL-02.

    **Verified:** real hosted session loaded the synthetic staff shell, servicing iframe, and repeated account-row controls; 27 concurrent automation API health requests passed; explicit close was followed by provider status `COMPLETED`. Selected Gateway configuration is `openai/gpt-5` with self-healing/cache disabled; actual inference remains INT-003. Setup uses a dedicated fixture-only server and temporary Cloudflare Quick Tunnel. Typecheck, 33 tests, and builds pass. See [setup](BROWSERBASE_SETUP.md) and [live evidence](evidence/int-002/README.md). SAFE-04/DEL-02 remain broader assessment checks, not fully passed by this spike.

3. **INT-003 — Prove the delegated SDK supports our execution boundaries. (Complete)**

    Obtain a real Stagehand model-proposed action; inspect it before mutation, execute and serialize it, then apply a changed synthetic value using deterministic methods with self-healing disabled. Verify targeting, readiness, text extraction, inference instrumentation, same-session manual action capture/control hand-back, and capture/cleanup behavior. Use the smallest temporary operator surface needed for this proof; do not build the full console yet.

    **Done when:** a short recorded result identifies what Browserbase/Stagehand supplies, proves a deterministic action path with inference forbidden, and demonstrates manual input in the same session. Unsupported details have a concrete TypeScript adapter solution or a clearly identified gap before broader implementation. This fixture proof is not the final discovery demo. **Depends on:** INT-002. **Acceptance:** REP-01, REP-03, HUM-02, HUM-03, HUM-05, DES-01.

    **Verified:** real Gateway proposals were inspected before mutation, a serialized descriptor was rebound to changed input and executed with a verified rejecting inference callback, positional targeting was rejected after row reordering, and real manual actions were captured with exclusive ownership and validated same-session resumption. Screenshot/snapshot capture and provider `COMPLETED` cleanup passed. Typecheck, 51 tests, and builds pass. Use semantic frame/table/row targeting and mediated manual control; generic policy/redaction and durable coordination remain later tasks. See [SDK results and adapter decisions](SDK_COMPATIBILITY.md) and [live evidence](evidence/int-003/README.md). These fixture proofs do not fully pass the linked assessment-wide criteria.

## First balance discovery and replay slice

4. **INT-004 — Implement the public contracts and capability schema. (Complete)**

    Define Zod request/result/action/envelope contracts and the constrained serializable input/output schema representation with its runtime validator. Define versioned steps, scoped targets, parameter references, pre/postconditions, output extraction, and business-outcome/recovery representations. Resolve the balance contract against the workflow document; include blocked-run context and a representation for supported manual contributions/intervention requirements; add write-specific commit semantics with the second capability. Choose finite initial budgets and document them as adjustable configuration.

    **Done when:** valid contracts round-trip; unknown versions/operations, missing references, invalid bindings, and executable content are rejected. Embedded invocation/output schemas actually validate values; parsing the envelope alone is insufficient. **Depends on:** INT-003. **Acceptance:** ART-02, ART-03, ART-04, ART-05.

    **Verified:** public Zod request/result/control contracts, a bounded data-only capability format, semantic frame/table/row targets, typed references/captures, independent terminal identity checks, UI output extraction, scoped outcomes/recovery, and explicit manual contribution/intervention representations. Capability-aware validators check actual input/output values, not just envelopes. The complete authored balance contract round-trips; unsupported versions/code/operations, unresolved/forward references, invalid bindings, and inconsistent run state are rejected. Initial finite server budgets are documented. Typecheck, 106 tests, and all builds pass. See [contract specification and limits](CONTRACTS.md) and [authored example](examples/README.md). This is format/validation support for ART-02–ART-05; real discovery-derived artifacts and UI evaluation remain later tasks.

5. **INT-005 — Set up PostgreSQL persistence and isolated target data. (Complete)**

    Select database access/migration tooling. Create automation migrations for capabilities, runs, interventions, events, and request receipts with version/sequence/receipt uniqueness and consistent references. Create a separate demo database/application role. Add deterministic seed/reset commands for synthetic members/accounts and retained non-secret configuration versions.

    **Done when:** migrations work from an empty development database; fixtures reset predictably; automation credentials cannot read the target's business tables. Core repository transactions and receipt uniqueness have meaningful integration coverage. **Depends on:** INT-001, INT-004. **Acceptance:** DEL-01, SAFE-04.

    **Verified:** PostgreSQL 18.7 is pinned by Docker image digest; pg 8.23.1 and checksummed transactional SQL migrations create the five automation tables plus a separate synthetic demo database. Separate runtime/migration roles enforce cross-database isolation. Development setup and no-op migration rerun passed. Real PostgreSQL tests cover atomic acceptance/publication rollback, scoped receipts and key/expiry behavior, concurrent event ordering, exact immutable capabilities/configuration/session references, confirmed source provenance, deterministic seeds, and access denial. Configuration versions are retained as immutable per-run snapshots. `pnpm check:db` passes typechecking, 106 default tests, 12 database integration tests, and all builds. See [database setup, schema, and verification](DATABASE.md). This supports DEL-01/SAFE-04; HTTP orchestration and full assessment verification remain later work.

6. **INT-006 — Build the credit-union staff portal and balance workflow. (Complete)**

    Implement the fictional Demo Credit Union staff console specified in DEMO_WORKFLOW.md: persistent institution/operator/branch/session context, active-member context, usable Member Search, Member Overview, Account Inquiry, and Account Details. Build connected React/Vite/Mantine screens backed by the separate target application/database. Use an outer staff shell and actual framed servicing workspace, dense account tables, and repeated Open controls. Include member/account IDs and statuses, primary-savings designation, separately labeled Current/Available Balance and currency, and the distinct balances/account ordering for M1001/M1002.

    Implement ordinary loading, empty search, and field-validation states plus Back/Clear/new-search behavior that cannot retain the wrong member's details. Keep visible labels/headers and meaningful UI identifiers; targeting must not require generated library IDs/classes, positional selectors, or test IDs. Full exception injection belongs to INT-012 and Contact Maintenance to INT-018. Keep automation controls/diagnostics in the separate operator app.

    **Done when:** a person can navigate Staff workspace → Member Search → Member Overview → Account Inquiry → Account Details for both members, verify consistent member/account identity, and distinguish Current Balance from the different Available Balance. Back/new-search transitions behave coherently and do not expose stale results. The working path traverses the intended frame/table controls, is reachable by Browserbase, and uses only synthetic target data. A generic shell/search card or hard-coded answer display does not satisfy completion. **Depends on:** INT-002, INT-005. **Acceptance:** DISC-02, REP-02, SAFE-04.

    **Verified:** connected PostgreSQL-backed React/Mantine staff shell and same-origin servicing iframe, search/overview/inquiry/details, persistent staff/member identity, repeated row-scoped Open controls, distinct current/available balances and reordered M1001/M1002 accounts. Server context revisions and client cancellation reject stale searches/account reads; Back/Clear/new search behave coherently. A real Browserbase session verified both accounts and four negative states, used zero inference, and terminated with provider status `COMPLETED`. `pnpm check:db` passes typechecking, 113 default tests, 13 real PostgreSQL tests, and all builds. See [portal setup/limits](PORTAL.md) and [curated UI evidence](evidence/int-006/README.md). This implements the target surface; discovery, artifact replay, full exception injection, and assessment-wide acceptance remain later tasks.

7. **INT-007 — Implement the shared executor and safe recording boundary. (Complete)**

    Wrap supported SDK operations with policy, owner/revision checks, action serialization, scoped unique targeting, bounded state waits, and deterministic extraction. Preserve unknown action outcomes and stop/escalate rather than repeat uncertain actions; this safety behavior is baseline, not deferred restart hardening. Record safe action intent/result events and richer evidence through a sanitization boundary before storage. Do not implement speculative fallback locators, model recovery, or blind action retries.

    **Done when:** allowed operations execute, disallowed/ambiguous operations dispatch nothing, deadlines stop waiting, and a representative failure produces a useful sanitized snapshot or screenshot. Synthetic sensitive markers are excluded from retained event/capture fields. **Depends on:** INT-003, INT-004, INT-005. **Acceptance:** REP-03, SAFE-01, SAFE-03, OBS-01, OBS-02.

    **Verified:** semantic frame/container/table-row/cell/field targeting, atomic uniqueness/actionability/policy checks, owner/revision fencing, serialized dispatch, cumulative action/time budgets, bounded waits, checked deterministic extraction, no blind retry of uncertain commands, and allowlisted structural failure evidence. The actual hosted executor traversed both baseline members, verified their identity/balances, and stopped on two unscoped Open controls with zero dispatches for that target. Its richer failure snapshot shows the screen/control/table structure without record values. Zero inference and provider `COMPLETED` cleanup passed. See [runtime boundaries and limitations](RUNTIME.md) and [live executor evidence](evidence/int-007-008/README.md). Full privacy/scenario verification remains INT-012–INT-016.

8. **INT-008 — Implement run coordination and the initial API. (Complete)**

    Add Express/Zod endpoints for starting and reading runs, exact capability retrieval, events, and safe cancellation. Run UI work outside request handlers. Pin configurations, enforce one active run including human pauses, provide basic authentication/authorization, and atomically associate accepted mutations with request receipts. Define safe result/output-availability behavior. Enforce one coordinator for the runtime store and finite session lifetimes. On restart, leave interrupted work stopped and mark it explicitly; require confirmed closure/expiry of its old session before admitting another run. Documented manual reconciliation is acceptable for the baseline; automatic cleanup/reconciliation scenarios are follow-on INT-017.

    **Done when:** run creation returns a reference promptly; callers can inspect progress/results; duplicate creation requests resolve to one run and a second distinct active run is rejected. Invalid requests, capability inputs, and authorization failures return the documented contracts. Stopping or restarting the backend never silently redispatches interrupted UI work; session cleanup uncertainty blocks new admission. **Depends on:** INT-004, INT-005, INT-007. **Acceptance:** DISC-01, DISC-03, REP-07, DEL-01.

    **Verified:** authenticated asynchronous create/read/exact-capability/events/receipt/cancel/evidence routes; safe errors and duplicate-key JSON rejection; transactional principal-scoped receipts/capacity; frozen and persisted configuration; one coordinator lock; finite provider sessions; safe cancellation/drain; startup interruption without redispatch; unconfirmed session/launch cleanup blocks new runs until verified closure or conservative expiry. Tests include actual child-process death during session creation, in-flight cancellation, authorization, exact versions, request deduplication and transient-output expiry. `pnpm check:db` passes typechecking, 147 default tests, 24 PostgreSQL tests, and all builds. The local smoke command verifies the initial API; at that milestone discovery/replay requests still used explicit unavailable-mode results, superseded by INT-009/010 below. See [API setup and reconciliation](RUNTIME.md). This is orchestration support, not completed discovery/replay acceptance.

9. **INT-009 — Implement model-driven discovery and artifact construction.**

    Use Stagehand's AI primitives to propose next UI actions from the goal and observed state, under a bounded TypeScript loop. Execute through INT-007 and derive steps from confirmed action history with explicit parameter bindings. Verify UI completion and typed outputs before transactionally publishing a capability version. Treat authored recovery rules as such; do not infer their correctness from the happy path. Discovery dead-ends or unsafe next actions must raise structured intervention context through the shared coordinator; reaching a hard budget limit still stops clearly. INT-014/INT-015 complete and verify this handoff path.

    **Done when:** the system accepts a goal and target, performs genuinely model-selected UI actions, and saves a reloadable parameterized capability traceable to the run. Invalid construction or goal completion fails clearly rather than fabricating a capability. **Depends on:** INT-006, INT-007, INT-008. **Acceptance:** DISC-01, DISC-02, DISC-03, ART-01, ART-02, ART-03, ART-04, ART-05.

    **Verified:** Genuine Gateway-selected portal actions produce the parameterized capability; strict UI completion and confirmed-history checks gate publication. Discovery failures expose owned intervention context; claim/resume remains later work. `pnpm check:db` passes typechecking, 156 default tests, 26 PostgreSQL tests, and all builds. [Workflow setup](WORKFLOWS.md) · [Live evidence](evidence/int-009-011/README.md). This is the first balance slice, not completed assessment-wide recovery/handoff acceptance.

10. **INT-010 — Implement deterministic capability replay.**

    Interpret an exact saved capability version with new inputs, resolving targets and conditions through the shared executor. Read outputs through deterministic UI operations, verify member/account identity and amounts, and distinguish terminal success/outcome/failure. Keep the replay path free of model-dependent discovery/extraction and self-healing.

    **Done when:** a saved capability is loaded in a later process and replays for another member; observed UI outputs match its contract. Instrumented model access fails on any attempted inference. Wrong-record/invalid-output checks prevent success. **Depends on:** INT-009. **Acceptance:** REP-01, REP-02, REP-03, REP-04, ART-04.

    **Verified:** The exact persisted capability replays for M1002 in a fresh API process with a rejecting inference callback, identity checks, typed UI reads, and zero model metrics. `pnpm check:db` passes typechecking, 156 default tests, 26 PostgreSQL tests, and all builds. [Workflow setup](WORKFLOWS.md) · [Live evidence](evidence/int-009-011/README.md). This is the first balance slice, not completed assessment-wide recovery/handoff acceptance.

11. **INT-011 — Capture the first real end-to-end milestone.**

    Reset fixtures, run live discovery for M1001, export the actual artifact, then replay that version for M1002 with inference forbidden. Retain sanitized run logs/results and the model/configuration identity. Document the exact reproducible commands. Diagnose and fix integration failures before expanding scope.

    **Done when:** a reviewer can follow goal → genuine discovery → saved artifact → changed-input replay with the expected different balance and zero replay model calls. Evidence is real and clearly distinguished from fixture tests or illustrative examples. **Depends on:** INT-010. **Acceptance:** DISC-02, ART-01, REP-01, REP-02, REP-04, OBS-01, DEL-02, DEL-04.

## Baseline exceptions and human intervention

    **Verified:** The real exported capability and discovery/replay logs show M1001/S2001 at 125034 minor units and M1002/S2002 at 8765, distinct processes, positive discovery usage, zero replay inference, and confirmed session closure. `pnpm check:db` passes typechecking, 156 default tests, 26 PostgreSQL tests, and all builds. [Workflow setup](WORKFLOWS.md) · [Live evidence](evidence/int-009-011/README.md). This is the first balance slice, not completed assessment-wide recovery/handoff acceptance.

12. **INT-012 — Add repeatable target scenarios.**

    Extend the actual staff workflow with setup-controlled missing-member/no-primary-savings/access-denied outcomes, slow/failed inquiry, a known servicing notice, unexpected servicing modal, synthetic staff-session expiry/restoration, validation error, and wrong/duplicate member/account states. Render each inside its natural screen/context as specified in DEMO_WORKFLOW.md; avoid disconnected error demo pages. Trigger them through separate fixture setup, not undocumented powers given to the automation agent. Add a way for a person to resolve the manual cases inside the live UI. The blocking-modal/restoration scenario must be triggerable independently during discovery and replay.

    **Done when:** each scenario resets predictably at a defined portal transition, exposes explicit visible state/context, and has the required permitted manual resolution where applicable. Baseline fixtures still work; role/member denial cannot be mistaken for a missing record. Browser destruction and synthetic staff-session expiry are tested separately. **Depends on:** INT-006, INT-011. **Acceptance:** REP-05, REP-06, REP-08, HUM-01.

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

    Add Contact Maintenance from the same staff Member Overview, preserving member/operator context through preferred-email edit, before/after review, Save/Cancel, confirmation, and reopening the persisted record. Show a UI-visible change reference tied to that member and field. Add invalid-email, already-current, and delayed-confirmation scenarios. Use synthetic addresses only; no email delivery. Keep the target backend/database separate.

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
