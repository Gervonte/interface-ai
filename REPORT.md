# Report

Interface AI discovers a back-office task with an LLM once, saves it as a typed capability, and replays it without the model. The implemented slice is a read-only account inquiry on a synthetic credit-union staff portal. Everything here describes running code; [evidence/](evidence/README.md) holds the real runs.

## Architecture

```text
agent ─▶ Automation API ─▶ Coordinator ─▶ Worker (discovery loop | artifact replay) ─▶ Executor ─▶ BrowserSurface ─▶ browser ─▶ portal
operator page ─▶ same API (claim, act, resume)             Planner, discovery only: gpt-4.1 via Browserbase Model Gateway
```

- **One engine, two drivers.** Discovery and replay share the coordinator, executor, rule engine and browser adapter; only the worker differs. Policy, targeting, evidence and handoff behave the same on both paths.
- **The model chooses, the system records.** The planner sees a sanitized observation: known controls and fields as opaque references, never values, selectors or DOM. Each turn it returns one structured decision, which the log records in plain labels (`click` · `Account Inquiry` · `continue`). The worker dispatches it, confirms the resulting UI condition, and only then records a step citing that event. Artifacts come from confirmed actions, never transcripts.
- **Durable control, transient data.** PostgreSQL holds runs, events, control revisions, interventions and immutable capability versions. Inputs are kept only as HMAC fingerprints; outputs stay in memory briefly.
- **Deliberately simple.** One coordinator owns one session at a time (a database constraint), with no queue, so control transfer and cleanup stay provable.

**Decisions.**

- **TypeScript with Zod:** one set of contracts shared everywhere and validated at every boundary.
- **Browserbase with Stagehand:** isolated hosted sessions an operator can join, at the cost of a tunnel to the local portal. Stagehand's self-healing is off, so replay never improvises a locator. Replay also runs in local Chrome (`pnpm replay:local`) with no hosted browser or model.
- **`gpt-4.1`:** replaced `gpt-5`, whose decisions took 30–107 s.
- **Target:** a legacy-shaped synthetic portal (iframes, tables, no test IDs, injectable errors, no real PII).
- **Mocked:** the target, the minimal operator page, and the authored rule set. Discovery, replay and handoff are real.

## Artifact schema

A capability ([example](evidence/capability.json), [schema](packages/contracts/src/capability.ts)) is one immutable, versioned JSON document, validated structurally and semantically: references resolve, variables are captured before use, outputs match their types.

| Part | Purpose |
| --- | --- |
| `capabilityId`, `version`, `name`, `description` | Identity, plus a description generated from the request contract. Versions never mutate. |
| `sourceDiscoveryRunId`; each step's `source` | Provenance: the producing run and the event that confirmed each step. |
| `surfaceRequirements` | Surface kind, application family, compatible target versions. A mismatch is refused (`INCOMPATIBLE_TARGET`). |
| `inputSchema`, `outputSchema`, `outputDescriptions` | The agent-facing contract: bounded JSON Schema plus what each output means. |
| `targets`, `steps` | Semantic targets; ordered `navigate`/`fill`/`click`/`wait`/`capture`/`intervene` steps with `before`/`after` predicates and timeouts. |
| `outputs`, `successCondition` | Typed extractions (`usd-minor` turns "$1,250.34" into 125034); final conditions plus identity bindings. |
| `outcomeRules`, `recoveryRules`, `runtimeGuards`, `manualContributions` | Declared runtime behavior and recorded human boundaries. |

A target describes what an operator recognizes, not a selector:

```json
{ "scope": { "kind": "frame", "frames": [{ "attribute": "title", "value": "Member servicing workspace" }] },
  "within": [{ "kind": "tableRow", "tableCaption": "Member search results",
               "cells": [{ "columnHeader": "Member ID", "equals": { "kind": "input", "name": "memberId" } }] }],
  "locator": { "kind": "role", "role": "button", "name": "Open", "exact": true }, "expectedMatches": 1 }
```

Roles, labels and column headers survive restyling and need no test IDs; frame scopes handle legacy iframes. Row predicates bind to inputs, so "the Open button in this member's row" is parameterized, not positional. `expectedMatches: 1` makes ambiguity an error, not a guess, and every `after` predicate is a checkpoint.

## Determinism & error handling

Replay is a model-free interpreter: its planner refuses inference, and every replay reports zero model calls. For each step the executor checks ownership and origin, resolves exactly one visible match, checks policy, records intent, dispatches once, and polls until the `after` condition holds or the step times out. While waiting it classifies the screen against the declared rules, in order:

| Class | Examples | Behavior |
| --- | --- | --- |
| Runtime guard | wrong member or account; unexpected dialog; session expired | hard failure (`IDENTITY_MISMATCH`) or human intervention |
| Business outcome | no matching member; no primary savings; access denied | `business_outcome` with a code |
| Recovery | servicing notice; transient inquiry failure | declared clicks or waits only, bounded; then `RECOVERY_EXHAUSTED` |
| Conflict | two outcomes, or outcome plus recovery | `CONFLICTING_SIGNALS`; stop rather than guess |

The result is `success` (outputs) | `business_outcome` (code) | `failure` | `cancelled`. Success and outcomes list any `recoveries` applied. A failure gives the code, step, expected and observed condition, and evidence: [this replay](evidence/int-016/hard-failure.json) reports `IDENTITY_MISMATCH` at `step-006`, expected `RECORD_IDENTITY_MATCH`, rule `member-identity-0`. An action with an unknown effect is never retried. Discovery is capped at 30 model calls, 300 actions and 15 minutes.

The rules are **authored** for this portal and attached at save time: discovery learns the route, not error semantics. Nineteen live conditions run against one capability in [int-012-013](evidence/int-012-013/README.md), and the demo includes a [not-found replay](evidence/replay-not-found.json). **UI drift** fails closed with `TARGET_NOT_FOUND` or `AMBIGUOUS_TARGET` plus evidence; nothing self-heals.

## Heterogeneity & multi-tenant

**Surface seam.** Steps, targets and rules know nothing about Stagehand or the DOM. The surface sits behind a small `BrowserSurface` interface (`observe`, `inspect`, `dispatch`, `navigate`, `snapshot`), and target kinds are accessibility concepts (role and name, label, field, column header).

- **Legacy web:** frame and table-row scopes already help; non-semantic markup needs new locator kinds, such as text adjacent to a label, under the same unique-match rule.
- **Desktop:** a UI Automation or AX adapter behind the same interface, declared as `surfaceRequirements.kind: "desktop"`.
- **Screenshot plus coordinates:** a last resort, with approval.

The assumption is accessible names that are stable per application version.

**Reuse across institutions.** One vendor capability is shared, specialized per tenant, and checked for drift:

```json
{ "capability": "corecu-member-balance", "base": { "version": 4, "applicationFamily": "corecu", "compatibleVersions": ["7.2", "7.3"] },
  "tenant": "first-valley-cu",
  "binding": { "entryPoint": "https://cu.example/teller", "origins": ["https://cu.example"], "applicationVersion": "7.3", "policy": "fvcu-policy@2" },
  "override": { "labels": { "Member ID": "Member Number" },
                "addOutcomeRules": [{ "id": "dormant", "code": "ACCOUNT_DORMANT", "when": { "kind": "visible", "target": "dormantBanner" } }] } }
```

- **Precedence:** vendor base → version patch → tenant override → tenant policy.
- **Override limits:** an override may rename labels, add outcome or recovery rules, narrow versions and tighten policy. It may never add actions, relax success checks or permit risky controls.
- **Materialization:** the result is a new immutable version with lineage. This exists in miniature: authored revisions carry `base_version` lineage, and the database rejects any revision that changes steps, targets, contract or success condition.
- **Drift detection:**
  1. An incompatible application version is refused before a browser opens (implemented).
  2. A preflight fingerprint checks expected entry-screen labels.
  3. Runtime target-not-found or ambiguity is recorded with evidence.

  Persistent drift routes to supervised re-discovery in that tenant, producing a candidate override for review.

## Escalation & handoff

**Stuck** means a declared intervention guard matches (unexpected dialog, expired session), a recorded manual boundary is reached, or the discovery planner asks for help. Exhausted recovery, identity mismatch and policy blocks fail instead: they need investigation, not a click-through.

**Taking control.**

- The coordinator closes its dispatch gate, drains the in-flight command, captures a snapshot and opens an intervention: step, reason, expected checkpoint, deadline, plus the goal or capability. The browser and run state stay intact.
- An operator **claims** it. The control revision increments, stale requests are rejected, and automation cannot dispatch.
- The operator acts through the same executor and policy (risky controls stay blocked). Each action is recorded as a `human` event.

**Handing back.** Resume re-checks the checkpoint and member/account identity before automation regains control. A failed check returns the run to waiting, and a missed deadline ends it as `INTERVENTION_TIMEOUT`. Completed actions never repeat. Human steps from discovery are saved as manual boundaries, so replay never automates them. [int-014-015](evidence/int-014-015/README.md) shows a real operator doing this in a live discovery and a live replay; the operator page is deliberately minimal (screenshots and mediated buttons).

## Safety

- **Allowlist:** a versioned policy of origins, operation types and control names, checked before dispatch and again in the page. The model only sees allowlisted controls.
- **Risky actions are blocked.** Risky controls are declared by name and effect (`Close account`: irreversible; `Transfer funds`: financial), not guessed from words like "Submit". They are checked first on every path, including operator control, and no allowlist may name one. Blocking fits a read-only baseline; a write workflow would route its declared commit step to a person for approval. Live, the real Close account button was refused while seven permitted actions worked.
- **Data:** inputs are never stored, events hold codes not values, outputs expire, and failure evidence keeps structure only. Page text cannot reach the model; a planted instruction had no effect. A synthetic-marker sweep finds no sensitive values in any table, event, evidence file or API response.
- **Limits:** the hosted browser renders real values, and provider retention can't be verified. Expired evidence is refused, not deleted. Free text in a goal reaches the model. [Details](docs/SAFETY.md).

## Cuts

**Cut deliberately:**

- **Writes:** the contact-edit workflow and its duplicate-commit protection; risky-action approval.
- **Designed, not built:** desktop and legacy-web adapters, and tenant overrides.
- **Bounded goals:** goals are free text, but outputs use a bounded account-inquiry vocabulary.
- **Also out:** co-browsing, scale-out, stability scoring, evidence purging.

**Next:**
1. Local sessions in the coordinator, so local replay also gets persistence and handoff.
2. Tenant overrides with preflight fingerprints.
3. The contact-edit workflow, with a confirmation handoff for its commit step.
4. A capability catalog exposing capabilities as typed agent tools.
5. Approval gating driven by replay stability.
