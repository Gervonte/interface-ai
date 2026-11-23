# Report

Interface AI discovers a back-office task with an LLM once, saves it as a typed capability, and replays it without the model. The slice built is a read-only account inquiry on a synthetic credit-union portal; [evidence/](evidence/README.md) holds the real runs.

## Architecture

An agent calls the **Automation API**. A **coordinator** owns one run and browser session at a time; a **worker** drives it, with a planner (`gpt-4.1`) choosing actions in discovery and the saved artifact in replay. Both use the same **executor** (policy, targeting, waits, dispatch-once) and `BrowserSurface` adapter (Stagehand over Browserbase or local Chrome). The operator page uses the same API.

The model sees only known controls as opaque references, never values or DOM. Each decision is logged in plain labels (`click` · `Account Inquiry` · `continue`) and becomes a step only once its UI condition is confirmed, so artifacts come from confirmed actions, not transcripts.

**Decisions.** TypeScript/Zod for one validated contract set; Browserbase for sessions an operator can join (local replay needs none); Stagehand's self-healing off; `gpt-4.1` over `gpt-5` (30–107 s per decision); a legacy-shaped synthetic portal (iframes, tables, no test IDs, injectable errors). Mocked: the target, the minimal operator page and the authored rules.

## Artifact schema

A capability ([example](evidence/capability.json), [schema](packages/contracts/src/capability.ts)) is one immutable, versioned JSON document. It holds a generated description, provenance to the discovery run and each confirming event, compatible versions, typed input/output schemas with per-output descriptions, semantic `targets`, steps with `before`/`after` predicates, typed extractions (`usd-minor`: "$1,250.34" → 125034), a success condition with identity bindings, and declared rules.

A target describes what an operator recognizes, not a selector:

```json
{ "scope": { "kind": "frame", "frames": [{ "attribute": "title", "value": "Member servicing workspace" }] },
  "within": [{ "kind": "tableRow", "tableCaption": "Member search results",
               "cells": [{ "columnHeader": "Member ID", "equals": { "kind": "input", "name": "memberId" } }] }],
  "locator": { "kind": "role", "role": "button", "name": "Open", "exact": true }, "expectedMatches": 1 }
```

Roles, labels and headers need no test IDs. Row predicates bind to inputs, so "the Open button in this member's row" is parameterized, not positional. `expectedMatches: 1` makes ambiguity an error, and every `after` predicate is a checkpoint.

## Determinism & error handling

Replay is a model-free interpreter (zero model calls). Per step, the executor checks ownership and origin, resolves exactly one match, checks policy, records intent, dispatches once, and polls until the `after` condition holds, classifying the screen against declared rules:

| Class | Examples | Behavior |
| --- | --- | --- |
| Runtime guard | wrong member; unexpected dialog; expired session | hard failure or human intervention |
| Business outcome | member not found; access denied | `business_outcome` with a code |
| Recovery | servicing notice; transient failure | declared actions only, bounded |
| Conflict | two rules match | stop rather than guess |

Results are `success` | `business_outcome` | `failure` | `cancelled`, listing any `recoveries` applied. A failure names the step, expected and observed condition, and evidence, e.g. [`IDENTITY_MISMATCH` at `step-006`](evidence/int-016/hard-failure.json), rule `member-identity-0`. Actions with unknown effect are never retried. Rules are **authored** (discovery learns the route, not error semantics) and exercised by [19 live conditions](evidence/int-012-013/README.md) and a [not-found replay](evidence/replay-not-found.json). Drift fails closed (`TARGET_NOT_FOUND`, `AMBIGUOUS_TARGET`); nothing self-heals.

## Heterogeneity & multi-tenant

**Surface seam.** Steps, targets and rules never touch Stagehand or the DOM: the surface sits behind `BrowserSurface` (`observe`, `inspect`, `dispatch`, `navigate`), and targets are accessibility concepts. Legacy web adds locator kinds (text beside a label) under the same unique-match rule; desktop is a UI Automation/AX adapter; screenshots are a last resort. It assumes accessible names stable per version.

**Reuse across institutions.** One vendor capability is shared, specialized per tenant, and checked for drift:

```json
{ "capability": "corecu-member-balance@4", "family": "corecu", "compatibleVersions": ["7.2", "7.3"],
  "tenant": "first-valley-cu", "binding": { "entryPoint": "https://cu.example/teller", "version": "7.3" },
  "override": { "labels": { "Member ID": "Member Number" }, "addOutcomeRules": ["ACCOUNT_DORMANT"] } }
```

Precedence: vendor base → version patch → tenant override → tenant policy. Overrides may rename labels, add rules or tighten policy, but never add actions or relax checks. Each becomes a new immutable version with lineage, as authored revisions already do; the database rejects revisions that change steps, targets or contract. Drift is caught by refusing incompatible versions before a browser opens (implemented), a preflight label check, and runtime target failures; persistent drift triggers supervised re-discovery.

## Escalation & handoff

A run asks for a person on an intervention guard (unexpected dialog, expired session), a recorded manual boundary, or a planner help request; exhausted recovery, identity mismatch and policy blocks fail instead. The coordinator closes its dispatch gate, drains in-flight work and opens an intervention (step, reason, checkpoint, deadline, snapshot, goal); the browser stays intact. An operator **claims** it (the control revision increments and automation cannot dispatch), acts through the same executor and policy, with each action recorded as a `human` event, then **resumes**: checkpoint and identity are re-checked before automation regains control, and completed actions never repeat. A missed deadline ends the run as `INTERVENTION_TIMEOUT`. A real operator did this in a [live discovery and replay](evidence/int-014-015/README.md) through a deliberately minimal page.

## Safety

A versioned policy allows specific origins, operations and control names, checked before dispatch and in the page. **Risky controls are blocked**: declared by name (`Close account`: irreversible), not guessed from "Submit", checked first on every path including operator control. Blocking suits a read-only baseline (a write workflow would route its commit step to a person); live, the real Close account button was refused. Inputs are never stored, events hold codes not values, page text cannot reach the model, and a synthetic-marker sweep finds no sensitive values in storage. **Limits:** the hosted browser sees real values; expired evidence is refused, not deleted; goal text reaches the model. [Details](docs/SAFETY.md).

## Cuts

**Cut:** writes and risky-action approval; desktop/legacy adapters and tenant overrides (designed only); outputs beyond account inquiry; co-browsing and scale-out. **Next:** local sessions in the coordinator, tenant overrides, a write workflow with a confirmation handoff, a typed capability catalog, and approval gating by replay stability.
