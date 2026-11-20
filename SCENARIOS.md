# Repeatable portal scenarios and bounded recovery (INT-012/013)

The staff portal has setup-controlled scenarios at its normal search, account inquiry, and account-details transitions. Automation sees only their rendered UI effects. There is no scenario-selection endpoint, invocation input, hidden browser flag, or automation permission that can change a scenario.

## Setup and run

Use the existing private database and Browserbase configuration described in [WORKFLOWS.md](WORKFLOWS.md). Start Docker Desktop, then:

```sh
pnpm db:up
pnpm db:migrate
pnpm db:reset-demo
pnpm demo:scenario baseline
pnpm check:db
pnpm demo:serve
```

In a second terminal, expose only port 3002:

```sh
cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate
```

Stop other automation coordinators/watchers before the live checks. Use the printed HTTPS root:

```sh
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm scenario:check
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm scenario:controls
```

`scenario:check` needs a successful persisted balance discovery. If the database is new, run the real `pnpm workflow:demo` first as described in the workflow guide. The checker selects the latest owned balance capability, or an explicit `SCENARIO_CAPABILITY_ID`. It adds authored scenario rules as a new immutable version, retaining all discovered actions, bindings, targets, source events, and observed recovery history. It uses that exact revision for the whole scenario matrix. This is rule specialization of a real capability, not a fabricated new discovery.

The checker uses the real coordinator, PostgreSQL lifecycle/events, shared executor, and hosted browser. It changes scenarios through separate local setup between runs and uses the UI for all business reads/actions. Its health-only preflight checks target reachability before opening a paid browser. It makes no model calls. Each case checks its expected result, ordinary-step dispatch counts, recovery limits, session identity, zero inference, and verified closure. Expected failures count as passing tests only when the precise expected behavior and cleanup are confirmed.

Reports and the versioned configuration/capability are private and ignored under `apps/automation/runtime/int-012-013`. To complete an interrupted verifier without rerunning already-passing cases or publishing another revision:

```sh
SCENARIO_RESUME=1 BROWSERBASE_PORTAL_URL=https://your-original-tunnel.trycloudflare.com pnpm scenario:check
```

Resume requires the original binding URL, retained configuration, and exact owned capability version. Each unfinished test gets a new synthetic run/session; this does not resume or redispatch an interrupted production run. An expired tunnel needs a fresh full invocation/binding. `SCENARIO_CASES=servicing-notice,failed-inquiry` selects a subset for diagnosis. A normal full invocation always checks the complete matrix.

`scenario:controls` is separate authored UI QA. Its explicit QA policy permits the restoration/dismissal buttons, verifies their real UI effects and member/account identity in the same browser, then closes it. The automation policy does not permit those buttons. This check does not claim operator ownership transfer, human-action capture, or validated hand-back; those are INT-014/015.

Stop the target and tunnel with Ctrl+C afterward. Both checkers reset setup to baseline and close their owned browser sessions on ordinary completion/failure. PostgreSQL can remain running.

## Configure a scenario manually

```sh
pnpm demo:scenario --list
pnpm demo:scenario servicing-notice
pnpm demo:scenario slow-inquiry 1200
pnpm demo:scenario transient-inquiry 1000 2
pnpm demo:scenario baseline
```

Arguments are `NAME [DELAY_MS] [FAILURES_BEFORE_SUCCESS]`; setup validates an allowlisted name, a 0–15,000 ms delay, and 1–10 transient failures. The command atomically writes ignored `apps/demo-api/runtime/scenario.json`. The target snapshots that configuration when creating a **new** staff session; existing sessions retain their setup. Use a new private browser context when switching scenarios manually. Missing setup means baseline; malformed setup fails closed. No database mutation or server restart is needed to switch setup for the next session.

| Setup | Natural transition and visible effect | Runtime behavior |
| --- | --- | --- |
| `baseline` | Normal connected staff flow | Return the declared typed UI outputs. |
| `member-not-found` | Search has submitted Member ID and explicit No matching member state | `MEMBER_NOT_FOUND`, after checking the searched ID. |
| `no-primary-savings` | Inquiry loads accounts with no primary savings designation and an explicit notice | `NO_PRIMARY_SAVINGS_ACCOUNT`, after matching active member and loaded table. |
| `access-denied` | Valid selection; inquiry explicitly denies staff/member access | `ACCESS_DENIED`; no privilege workaround. |
| `slow-search` | Search displays loading before its bound result | Wait within the original step deadline; do not resubmit Search. |
| `slow-inquiry` | Inquiry displays loading before its response | Wait within deadline; an excessive delay stops `STATE_TIMEOUT`. |
| `transient-inquiry` | Inquiry temporarily fails, then succeeds after configured failures | Click only the scoped Try again control, with at most two declared attempts. |
| `failed-inquiry` | Inquiry remains unavailable | Stop `RECOVERY_EXHAUSTED` after at most two recovery attempts. |
| `servicing-notice` | Named servicing notice blocks inquiry | Acknowledge only that known notice, then verify the loaded inquiry. |
| `persistent-notice` | The same notice remains after acknowledgment | Stop `RECOVERY_EXHAUSTED`; never loop indefinitely. |
| `unexpected-modal` | Opening details shows Servicing review required | Pause with `UNEXPECTED_DIALOG`; the portal offers Dismiss servicing review for manual resolution. |
| `session-expired` | Inquiry suspends the synthetic staff session while the browser remains live | Pause with `SESSION_EXPIRED`; Restore staff session preserves the selected member and requires normal context revalidation. |
| `validation-error` | A well-formed submitted ID gets a target field-validation error | Stop `TARGET_VALIDATION_ERROR`; do not repeatedly submit. |
| `duplicate-account` | Duplicate eligible account rows/Open controls | Stop `AMBIGUOUS_TARGET`, without choosing an arbitrary row. |
| `wrong-member` | Inquiry displays a member inconsistent with the request/shell | Stop `IDENTITY_MISMATCH`. |
| `wrong-account` | Details disagree with the ID captured from the selected account row | Stop `IDENTITY_MISMATCH` before returning outputs. |
| `conflicting-outcomes` | Valid accounts coexist with contradictory negative signals | Stop `CONFLICTING_SIGNALS`, never report a negative or success arbitrarily. |

The verifier additionally destroys a real browser session and expects `SESSION_LOST`. Browser destruction is independent of synthetic staff-session expiry: an expired staff session retains a live browser and a manual restoration path; a destroyed browser cannot be restored by replacing it silently.

## Rule execution and provenance

A rule-enhanced capability contains typed outcome rules, recovery rules, and runtime guards. All are explicitly authored and scoped to subscribed step IDs. New discovery under policy v3 attaches the profile automatically. Existing capabilities can receive an immutable authored-rule revision through the setup verifier; no caller can rewrite an existing version or turn an unrelated script into discovered actions.

The interpreter checks blockers/identity/conflict guards before accepting a business outcome or applying recovery. A visible negative cue alone is insufficient: the relevant submitted/active member must match the binding, with the required loaded screen/table context. A missing control is never treated as proof of a negative business result. Multiple matching outcomes, contradictory account evidence, or multiple recovery rules stop safely.

Read-only classification batches semantic target reads in one browser turn. Missing optional predicate targets evaluate false; invalid bindings, ambiguous scopes, unsupported reads, and transport failures remain errors. Classification snapshots are volatile and never written as raw DOM or model context. Action dispatch independently rechecks uniqueness, readiness, policy and ownership in its own browser turn.

Only recorded recovery actions may execute. Rules declare the permitted dispatch phase, expected postcondition, attempt ceiling and timeout. Attempt counts are cumulative for the run and capped by policy. Before/action/after phases share the step deadline; recovery does not reset the active/overall run deadline. Ordinary workflow actions are not retried. An unknown in-flight outcome closes admissions and cannot enter recovery.

During discovery, an actually executed recovery records confirmed event sequences in its authored rule source. Publication validates those events, their operation/target, phase/order, and the complete mutation history alongside the normal discovered steps. Revisions cannot remove or reinterpret that observed history. Data-only predicates, targets and rule actions are validated before replay; model extraction/self-healing remain disabled.

The new database migrations add `base_version` lineage while retaining one original artifact per discovery and immutable versions/results. A follow-up trigger migration corrects SQL expression grouping from the first applied revision migration; earlier migration history was not rewritten. Both are applied by `pnpm db:migrate` and tested from empty databases and through a no-op rerun.

## Verification scope

[Live results and selected sanitized logs](evidence/int-012-013/README.md) distinguish the 19-case capability replay matrix from target-control QA. Default tests additionally exercise negative discovery, authored-rule attachment, recovery provenance, conflict/identity precedence, finite deadlines, stale-context rejection, and explicit closed-client transport classification. Database tests cover immutable rule revisions, preserved recovery history, and confirmed negative discovery completion without an invented capability.

Paused cases expose an owned intervention and retain their session. The verifier inspects that state, then cancels for cleanup. Operator claim/manual-action/resume APIs and the genuine discovery/replay human takeover demonstrations remain INT-014/015. Full privacy and adversarial scenario acceptance remains INT-016; this milestone does not declare the entire assessment complete.
