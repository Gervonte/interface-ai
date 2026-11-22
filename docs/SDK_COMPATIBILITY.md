# SDK execution boundaries (INT-003)

This compatibility check qualifies the pinned Stagehand 4.4.0 / Browserbase SDK 2.27.0 integration before building the artifact executor and durable coordinator. It uses the synthetic INT-002 fixture, not the complete assessment portal. See [the implementation plan](IMPLEMENTATION_PLAN.md).

**Verified on 2026-11-16 (America/New_York):** genuine model proposals, serialized action execution, changed-input execution with inference forbidden, real human takeover and hand-back in the same session, failure captures, and confirmed session cleanup. See [the recorded evidence](../evidence/int-003/README.md).

## Reproduce

Follow [BROWSERBASE_SETUP.md](BROWSERBASE_SETUP.md) to configure the server-only Browserbase key/project, start `pnpm dev:fixture`, and start the fixture-only Cloudflare tunnel. Keep the fixture and tunnel running. Set `BROWSERBASE_FIXTURE_URL` to the current HTTPS tunnel hostname plus `/compatibility`.

From the repo root:

```sh
BROWSERBASE_FIXTURE_URL=https://your-current-tunnel.trycloudflare.com/compatibility pnpm browserbase:spike
```

Open **http://127.0.0.1:3004** in a local browser. Click **Start live check** when ready. The local tool itself opens no hosted session until that button is clicked. It uses one session for proposals, changed-input deterministic execution, manual control, and resumption. Each check opens a paid Browserbase session and makes two Gateway observation requests; normal development and tests do neither.

The automatic phase:

1. Calls the selected Gateway model, `openai/gpt-5`, to propose filling Member ID with M1001. It verifies that observation did not mutate the UI and inspects the proposal before dispatch.
2. Checks the proposal's method/arguments, uniqueness, visibility, and geometric agreement with an independently scoped input inside the servicing iframe. Hidden account-form inputs are excluded by search-form scope. It serializes the data-only descriptor to disk, reloads it, and executes it using `act(Action)`.
3. Obtains and checks a model proposal for the Primary Savings row's repeated “Open” control; executes it and verifies M1001 / S2001 / Current Balance independently from the Available Balance.
4. Closes the discovery Stagehand client, then attaches another client to the **same browser and page** with a local `generate` callback that throws on every inference attempt. A deliberate `observe` request must hit this callback and fail, proving the guard is connected. Failed calls are recorded by our counter even though SDK token metrics do not count them.
5. Rebinds the saved fill descriptor to M1002 and executes it without inference. It checks the raw saved row selector against the reordered table, blocks it if it now targets another control, then opens the semantically scoped Primary Savings row. It verifies M1002 / S2002, current balance 8765 minor units, and available balance 7600 minor units.
6. Exercises a missing-target bounded wait and captures the actual synthetic session as a PNG and iframe-inclusive SDK snapshot. No uncertain mutating command is issued for this failure probe.
7. Returns to M1002's account table, closes automation admission, and waits for a person.

When **waiting_for_human** appears:

1. Click **Claim control**.
2. Enter **M1001** in the local Member ID field and click **Set Member ID**. This fills the actual hosted target input.
3. Click **Find member**, then **Open Primary Savings**.
4. Check the session image shows **M1001 / S2001**, with Current Balance **$1,250.34** and Available Balance **$1,200.34**.
5. Click **Hand back to automation**.

Automation must be blocked during human ownership. Manual commands carry the current control revision and observation ID, use a fixed set of controls, and must match a recent DOM fingerprint. Commands from old views/revisions are rejected before dispatch. The tool records actor, target, dispatch, and completion; it does not retain the typed value in action events. Refresh the session view if it expires after 60 seconds. Failed hand-back leaves admission closed and requires a new claim.

Hand-back validates the actual requested member/account/balances and at least three completed manual actions. It then invalidates the old human revision, verifies that stale input cannot dispatch, resumes automation on the same session, and returns to Account Inquiry once. A note or button click alone cannot assert success.

The check writes `apps/automation/runtime/int-003/result.json`, the serialized fill action, and synthetic failure captures. A completed result must have `success: true`, no deterministic-phase inference attempts, zero replay SDK metrics, verified manual results, and provider status `COMPLETED`. If it fails, inspect the safe `failurePhase` and action history; raw authenticated provider errors are not printed. A failed check is not a completed INT-003 proof.

The installed runtime throws when a selector wait expires. A boolean return type does not imply that timeouts resolve to `false`. The missing-target probe handles the rejection, confirms the browser still responds and the target count remains zero, then captures evidence. Other failures still fail the check. Production waits need an explicit timeout/error adapter.

Use Ctrl+C to stop the local tool. It closes the hosted session on ordinary completion/failure/shutdown. The provider timeout is 15 minutes, and the human intervention deadline is 10 minutes. Model proposals have 45-second budgets, deterministic input actions 5–10 seconds, and state waits 10 seconds. These are compatibility-check limits, not the final coordinator's run budgets. Stop the tunnel and fixture afterward as described in the setup guide. Port 3004 is a local-only operator tool and must not be tunneled.

## Delegation and adapter decisions

| Concern | Provider/SDK contribution | TypeScript responsibility |
| --- | --- | --- |
| Session | Hosted Chromium, iframe traversal, explicit release | Own lifecycle and confirm terminal provider status |
| Discovery | Gateway inference; `observe` returns Action data before execution | Inspect methods/arguments, scope targets, and check pre/postconditions |
| Deterministic execution | `act(Action)`, page/locator primitives, disabled self-healing | Bind inputs; supply independent readiness and output checks; forbid inference |
| Reordered rows | SDK can resolve the recorded descriptor | Reject wrong-record targets and bind semantic frame/table/row scope; no automatic model repair |
| Evidence | Screenshot, snapshot, usage metadata | Retain selected synthetic evidence and safe action events |
| Human control | Browser remains alive; deterministic input methods operate it | Local mediated view, exclusive dispatch gate, revision/freshness checks, action history, validated hand-back |

The fixture target check compares locator centroids only after asserting uniqueness and visibility. This is a narrow check of a static synthetic layout; it is not the general semantic target resolver. The production adapter needs explicit frame/table/row/record context and policy checks in INT-007. The raw model selector is never assumed reusable solely because its SDK action succeeded.

Browserbase Live View supplies interactive access, but its documented read-only example uses CSS pointer-event suppression. That does not establish server-side revocation or capture every manual action. We therefore use the already-designed mediated input path for this proof. We do not expose a provider control URL or credentials to the local UI. This is a documentation-based fit decision, not a claim that a future provider API could never replace the mediated path.

## Scope and remaining work

This local tool is a single-process compatibility spike. It is bound to loopback with a fixed Host check, per-process operator token, same-origin mutation checks, constrained synthetic inputs, and no arbitrary selector/script endpoint. It does not implement production operator authentication, durable claims, idempotency, run persistence, every policy rule, or a full remote desktop. The durable admission/claim/action/hand-back semantics remain INT-013 and the Mantine operator console remains INT-014.

Provider recording/logging and Stagehand self-healing/cache are disabled. Screenshot/snapshot retention here is permitted only for the all-synthetic fixture. Generic sensitive-field redaction and richer policy enforcement remain INT-007/INT-012; a screenshot is not automatically safe on an arbitrary target. Runtime storage stays ignored; curated evidence is reviewed separately before committing.

These fixture proofs inform REP-01, REP-03, HUM-02, HUM-03, HUM-05, and DES-01. They do not pass those assessment-wide criteria or replace genuine discovery/artifact/replay/handoff evidence on the final workflow.

## Primary references

- [Observe returns inspectable actions](https://docs.stagehand.dev/v4/basics/observe)
- [Action execution and self-healing](https://docs.stagehand.dev/v4/basics/act)
- [Iframe locators and bounded operations](https://docs.stagehand.dev/v4/reference/locator)
- [Stagehand lifecycle and per-instance metrics](https://docs.stagehand.dev/v4/reference/stagehand)
- [Browserbase Live View](https://docs.browserbase.com/platform/browser/observability/session-live-view)

Actual runtime results, where verified, are recorded separately from these provider claims.

## Shared runtime integration (INT-007/008)

The compatibility spike remains historical evidence. The shared executor now supplies an atomic semantic DOM adapter over the hosted Stagehand page, with policy/actionability checks, deterministic extraction, safe failure snapshots and application-owned lifecycle/dispatch fencing. This avoids reliance on positional descriptors or first-match dispatch behavior. [Runtime guide](RUNTIME.md); [real shared-executor evidence](../evidence/int-007-008/README.md). Its same-origin/native-DOM limitations are explicit; model-driven discovery and fresh-process capability replay are now verified separately in [INT-009–011](../evidence/int-009-011/README.md). The production planner uses Stagehand extract over a sanitized helper document; it does not transmit the controlled portal DOM. [Workflow details](WORKFLOWS.md).
