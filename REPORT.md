# Report

Interface AI discovers a back-office task with an LLM once, saves it as a typed capability, and replays it without the model. The implemented slice is a read-only account inquiry on a synthetic credit-union staff portal: find a member, open the requested account, return typed identity and balance fields. Everything here describes running code; [evidence/](evidence/README.md) holds the real runs.

## Architecture

```text
agent ─HTTP─▶ Automation API ─▶ Coordinator ─▶ Worker ─────────▶ Executor ─▶ BrowserSurface ─▶ Browserbase browser ─▶ portal
              token, idempotency  one run, durable  discovery loop or   policy, targeting,  Stagehand/CDP;
                                  log, control rev.  artifact replay     waits, dispatch-once DOM code in page
operator page ─HTTP─▶ same API (claim, act, resume)      Planner (discovery only): gpt-4.1 via Browserbase Model Gateway
```

- **One engine, two drivers.** Discovery and replay share the coordinator, executor, rule engine and browser adapter. Discovery's worker asks a planner which control to use next; replay's worker interprets a saved artifact. Policy, targeting, evidence and handoff therefore behave the same on both paths.
- **The model chooses, the system records.** The planner sees a sanitized observation: known headings, controls and fields as opaque references, row context, and whether a value matches an input. It never sees values, selectors or DOM. It returns a reference. The worker converts it to a semantic target, dispatches it, confirms the resulting UI condition, and only then records a step citing the confirming event. Artifacts are built from confirmed actions, never from transcripts.
- **Durable control, transient data.** PostgreSQL holds runs, events, control revisions, interventions, idempotency receipts and immutable capability versions. Inputs are kept only as HMAC fingerprints; outputs stay in memory for a bounded window.
- **Deliberately simple.** One coordinator runs one session at a time, enforced by a database constraint, with no queue. Control transfer and cleanup stay provable; scale comes from more coordinators, not a scheduler.
- **Trade-offs.** A hosted browser gives isolation and a live session an operator can join, but the target must be reachable over HTTPS (the local portal needs a tunnel). Stagehand provides transport and the model gateway only; its self-healing actions are off, so replay never improvises a locator.

## Artifact schema

A capability ([example](evidence/capability.json), [schema](packages/contracts/src/capability.ts)) is one immutable, versioned JSON document. It is validated structurally and semantically: references resolve, variables are captured before use, outputs match their declared types.

| Part | Purpose |
| --- | --- |
| `capabilityId`, `version`, `name`, `description` | Identity. A new version never mutates an old one. |
| `sourceDiscoveryRunId`; each step's `source` | Provenance: the producing run and the event that confirmed each step. |
| `surfaceRequirements` | Surface kind, application family, compatible target versions, required features. A mismatch is refused (`INCOMPATIBLE_TARGET`). |
| `inputSchema`, `outputSchema` | Bounded JSON Schema: the contract a calling agent reads. |
| `targets`, `steps` | Named semantic targets; ordered `navigate`/`fill`/`click`/`wait`/`capture`/`intervene` steps, each with `before`/`after` predicates and a timeout. |
| `outputs`, `successCondition` | Typed extractions (`usd-minor` turns "$1,250.34" into 125034); final conditions plus identity bindings. |
| `outcomeRules`, `recoveryRules`, `runtimeGuards`, `manualContributions` | Declared runtime behavior and recorded human boundaries. |

A target describes what an operator recognizes, not a selector:

```json
{ "scope": { "kind": "frame", "frames": [{ "attribute": "title", "value": "Member servicing workspace" }] },
  "within": [{ "kind": "tableRow", "tableCaption": "Member search results",
               "cells": [{ "columnHeader": "Member ID", "equals": { "kind": "input", "name": "memberId" } }] }],
  "locator": { "kind": "role", "role": "button", "name": "Open", "exact": true }, "expectedMatches": 1 }
```

Accessible roles, labels, captions and column headers survive restyling and need no test IDs. Frame and container scopes handle legacy iframe layouts. Row predicates bind to inputs or captured values, so "the Open button in this member's row" is parameterized, not positional, and a different account order replays correctly. `expectedMatches: 1` makes ambiguity an error rather than a first-match guess. Each step's `after` predicate is a checkpoint, so success is verified step by step.

## Determinism & error handling

Replay is a model-free interpreter: its planner is a function that refuses inference, and every replay reports zero model calls and tokens. For each step the executor checks control ownership and origin, resolves the target to exactly one visible match, checks the policy, records intent before touching the browser, dispatches once, and polls until the `after` condition holds or the step times out. While waiting it classifies the screen against the capability's declared rules, in a fixed order:

| Class | Examples | Behavior |
| --- | --- | --- |
| Runtime guard | different member or account shown; unexpected dialog; session expired | hard failure (`IDENTITY_MISMATCH`) or human intervention |
| Business outcome | no matching member; no primary savings; access denied | `business_outcome` with a code; "not found" must name the searched ID |
| Recovery | servicing notice; transient inquiry failure | only declared clicks or waits, bounded attempts; then `RECOVERY_EXHAUSTED` |
| Conflict | two outcomes, or an outcome and a recovery | `CONFLICTING_SIGNALS`; stop rather than guess |

The result is `success` (outputs) | `business_outcome` (code) | `failure` (code, step, expected and observed condition, dispatch/effect state, evidence) | `cancelled`. Failures name what actually failed: [this replay](evidence/int-016/hard-failure.json) reports `IDENTITY_MISMATCH` at `step-006`, expected `RECORD_IDENTITY_MATCH`, rule `member-identity-0`, with a structural snapshot. An action with an unknown effect is never retried. Discovery is bounded at 30 model calls, 300 actions, 10 s per step and 15 min overall.

The rules are **authored** for this portal (`source: authored`) and attached when a capability is saved. Discovery learns the route; it does not learn error semantics. Nineteen live conditions are exercised against one saved capability in [int-012-013](evidence/int-012-013/README.md); the end-to-end demo includes a [not-found replay](evidence/replay-not-found.json). **UI drift** fails closed: capabilities are bound to target versions, and a missing or duplicated control stops with `TARGET_NOT_FOUND` or `AMBIGUOUS_TARGET` plus evidence. Nothing self-heals in production.

## Heterogeneity & multi-tenant

**Surface seam.** Steps, predicates, targets and rules know nothing about Stagehand or the DOM. The surface sits behind a small `BrowserSurface` interface (`observe`, `inspect`, `dispatch`, `navigate`, `snapshot`, `image`), and target kinds are accessibility concepts (role and name, label, field, cell by column header).

- **Legacy web** is already partly covered by frame and table-row scopes. Non-semantic markup needs new locator kinds, such as text adjacent to a label, under the same unique-match rule.
- **Desktop** is an adapter for UI Automation or AX implementing the same interface, declared with `surfaceRequirements.kind: "desktop"`.
- **Screenshot plus coordinates** would be a last-resort, lower-trust adapter that needs approval.

The design assumes meaningful accessible names that are stable per application version.

**Reuse across institutions.** One vendor capability is shared, specialized safely per tenant, and checked for drift:

```json
{ "capability": "corecu-member-balance", "base": { "version": 4, "applicationFamily": "corecu", "compatibleVersions": ["7.2", "7.3"] },
  "tenant": "first-valley-cu",
  "binding": { "entryPoint": "https://cu.example/teller", "origins": ["https://cu.example"], "applicationVersion": "7.3", "policy": "fvcu-policy@2" },
  "override": { "labels": { "Member ID": "Member Number" },
                "addOutcomeRules": [{ "id": "dormant", "code": "ACCOUNT_DORMANT", "when": { "kind": "visible", "target": "dormantBanner" } }] } }
```

- **Precedence:** vendor base → vendor-version patch → tenant override → tenant policy.
- **What an override may do:** rename labels or frame titles, add outcome or recovery rules, narrow versions and tighten policy. It may never add actions, relax success checks or permit risky controls.
- **Materialization:** the resolved artifact becomes a new immutable version with lineage to its base. This exists in miniature today: authored revisions are new versions with `base_version` lineage, and the database rejects a revision that changes the recorded steps, targets, contract or success condition.
- **Drift is caught at three points:**
  1. The binding's application version is not compatible, so replay refuses before opening a browser. This check is implemented.
  2. A preflight fingerprint of entry screens (expected labels present and unique) fails.
  3. A runtime target is not found or is ambiguous, recorded with evidence.

  Persistent drift routes to a supervised re-discovery in that tenant, which produces a candidate override for review rather than a silent fork.

## Escalation & handoff

**Detecting "stuck."** A run asks for a person when:

- in discovery, the planner asks for help or a declared guard matches;
- in replay, an intervention guard matches (unexpected dialog, expired session) or a recorded manual boundary is reached.

Exhausted recovery, identity mismatch and policy blocks fail instead: a person should investigate them, not click through them.

**Taking control.**

- **Pause:** the coordinator closes its dispatch gate, drains the in-flight command and captures a structural snapshot. It then opens an intervention with step, reason, expected checkpoint, session reference and deadline; the operator page also shows the goal or capability. The run waits in `waiting_for_human` with its browser, bindings and captured variables intact.
- **Claim:** an operator claims it. The control revision increments, the operator becomes the controller, and stale requests are rejected by revision. Automation cannot dispatch while a human owns the run.
- **Manual actions:** the operator acts through the same executor, with the same origins, allowlists and risky blocks, plus a few human-only resolution controls. Each action is recorded as a `human` event, and idempotent receipts prevent double dispatch.

**Handing back.**

- Resume enters `validating_resume` with no controller. The recorded checkpoint and member/account identity are re-checked before automation regains control; a failed check returns the run to `waiting_for_human`.
- Completed actions are not repeated. A missed deadline ends the run as `INTERVENTION_TIMEOUT`.
- Human steps taken during discovery are saved as manual contributions, so replay keeps them as human boundaries rather than automating them.

[int-014-015](evidence/int-014-015/README.md) shows a real operator resolving pauses in a live discovery and a live replay. The operator page is deliberately minimal: on-demand screenshots and mediated buttons, not co-browsing.

## Safety

- **Allowlist:** a versioned policy lists allowed origins, operation types, and click and fill control names. It is checked before dispatch and again in the page during the same browser turn. The model only sees allowlisted controls.
- **Risky actions are blocked.** The policy declares risky controls by name and effect (`Close account`: irreversible; `Transfer funds`: financial). It does not infer risk from words like "Submit". Risky controls are checked before the allowlists on every path, including operator control, and a policy that also permits one fails to load. Blocking rather than confirming fits a read-only baseline; confirmation belongs to the handoff flow (see Cuts). Live, the real Close account button was refused with nothing dispatched while seven permitted actions worked.
- **Data:** inputs are never stored; events hold codes, not values; outputs expire from memory; failure evidence keeps structure, not record values. Page text cannot reach the model, because the observation accepts a closed vocabulary; an instruction planted in the page had no effect. Goals have input values and credential-like tokens redacted. A synthetic-marker sweep finds no goal, input or page values in any table, event, evidence file or API response. Browserbase logging and recording are off.
- **Limits:**
  - The hosted browser renders real values, and provider retention cannot be verified here.
  - Expired evidence is refused but not deleted.
  - A renamed risky control is caught by the allowlist, not the risk list.
  - Free text in a goal reaches the model.
  - Details: [docs/SAFETY.md](docs/SAFETY.md).

## Cuts

**Cut deliberately:**

- **Writes.** The planned contact edit, with review and confirmation screens, plus duplicate-commit protection, so that an uncertain write never commits twice.
- **Confirmation for risky actions.** Today they are blocked.
- **Local-browser replay.** Replay still needs Browserbase and a tunnel.
- **Desktop and legacy-web adapters, and tenant overrides.** Designed above, not built.
- **Live co-browsing** in the operator page.
- **Arbitrary goals.** Goals are free text, but outputs use a bounded account-inquiry vocabulary.
- **Scale-out, queues and stability scoring.**
- **An evidence purge job.**

**Next, in order:**
1. A local-browser replay adapter, which also proves the surface seam with a second implementation.
2. Tenant overrides with materialized versions and preflight fingerprints.
3. The contact-edit workflow, with a confirmation handoff for its commit step.
4. A capability catalog exposing saved capabilities as typed agent tools.
5. Approval gating (draft → approved) driven by repeated-replay stability.
