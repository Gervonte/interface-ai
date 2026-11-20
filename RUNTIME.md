# Shared executor and run API (INT-007–013)

The runtime implements policy-checked browser operations, sanitized structural evidence, authenticated asynchronous run APIs, single-coordinator ownership, cancellation, and restart reconciliation. Declared outcome/recovery/runtime-guard handling and setup-controlled target scenarios are documented in [SCENARIOS.md](SCENARIOS.md). Supported primary-savings discovery now constructs a capability from real model-selected actions, and replay interprets the exact saved version without inference. [Discovery/replay commands and limits](WORKFLOWS.md).

## Start and test

From the repository root, after installing dependencies and starting Docker Desktop:

```sh
pnpm db:up
pnpm db:migrate
pnpm automation:configure
pnpm dev:automation
```

`automation:configure` creates an ignored, private `AUTOMATION_API_TOKEN` in `apps/automation/.env` if one is missing. It preserves existing credentials and never prints the token. Normal startup needs `DATABASE_URL`, `REQUEST_FINGERPRINT_KEY`, and this token to enable run routes; health-only startup remains available without the full configuration. It does not run migrations automatically. `/healthz` identifies the process; it is not an assertion that run admission is available.

In a second terminal:

```sh
pnpm automation:smoke
```

The smoke command loads the private token itself, checks unauthenticated access is denied, creates a run, retries the same request key, and polls the same run. At this milestone, **`failed` with `UNSUPPORTED_GOAL` is the expected smoke result** (the smoke request deliberately uses an unsupported goal). No paid browser session or model call is made. A capacity error means another run/session still occupies execution; inspect it and reconcile rather than deleting database rows.

Run the broader checks independently:

```sh
pnpm check:db
```

The default suite does not need provider credentials or a database. The explicit database suite creates and disposes isolated test databases/roles, including a real child-process kill/restart test. Test workers and authored capability fixtures verify boundaries; they are not model-driven discovery evidence.

Stop development servers with Ctrl+C. For a built API, run `pnpm build`, then `pnpm --filter @interface-ai/automation start`. Stop other coordinators before starting another API or the hosted executor verifier.

## HTTP interface

Run routes require `Authorization: Bearer <server-only token>`. The configured local identity is `demo-operator`; raw tokens and provider connection URLs are never returned. The app factory supports scoped identities for authorization tests; registration/user administration is outside scope. Keep this API on loopback. The target-only tunnel described below must never expose the automation API or its credentials.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/v1/runs` | Validate discovery/replay request; atomically accept with a receipt; return `202` with `runId`, `statusUrl`, and `operationUrl` |
| GET | `/v1/runs/:runId` | Read the caller's progress, controller, result and failure context |
| GET | `/v1/runs/:runId/events?afterSequence=0&limit=100` | Read ordered allowlisted events; maximum page size 200 |
| GET | `/v1/capabilities/:capabilityId/versions/:version` | Retrieve an exact capability owned through its source run |
| GET | `/v1/runs/:runId/operations/:receiptId` | Inspect a mutation's safe state/reference |
| POST | `/v1/runs/:runId/cancel` | Request safe cancellation with `{ "reason": "USER_REQUESTED" }`; return `202` while stopping, `200` when already cancelled |
| GET | `/v1/interventions/:interventionId` | Inspect the caller's structured intervention; see HANDOFF.md for control routes |
| GET | `/v1/runs/:runId/evidence/:evidenceId` | Read linked, unexpired, sanitized structural evidence belonging to that run |

Mutations require an `Idempotency-Key` of 8–128 letters/digits/underscores/hyphens. The receipt window is 24 hours. Same principal/scope/key/payload returns the same logical operation; a changed valid payload returns `409`. Receipt lookup precedes target/capacity checks for accepted retries. Active work cannot expire into a second run. Fingerprint-key loss/change fails closed. Inputs/goals/raw request keys are not persisted; values exist only in the current process's worker context.

JSON transport rejects duplicate keys, including escaped aliases, dangerous prototype keys, excessive nesting, and oversized bodies. Errors use safe envelopes: `400` invalid transport/shape, `401/403` authentication/permission, `404` unavailable owned resource, `409` state/key/capacity conflict, `422` invalid capability values or incompatible target, `503` infrastructure/unconfigured service. Authorized retrieval of a failed run itself returns `200`. Responses containing run data/evidence are `no-store`.

Intervention claim, manual observation/image/action, and resume routes are implemented; see [HANDOFF.md](HANDOFF.md). Real operator discovery and exact-artifact replay takeovers are verified, including same-session validation and zero replay inference. Unknown endpoints do not grant provider-session access.

## Executor boundary

`apps/automation/src/execution` contains the gate, executor, browser adapter, provider lifecycle, and evidence recorder. Discovery/replay workers must call this executor rather than directly mutating a browser. The coordinator owns its factory, session, and cleanup; the request handler only commits acceptance and schedules asynchronous work.

- Operations are configured-entry navigation, input-bound fill, semantic click, bounded wait, and deterministic capture. An `intervene` step preserves an explicit human boundary with same-session ownership transfer and validated resume; it is never silently executed as a browser action. Replay also supports conditional `runtime_guard` manual contributions. Included/precondition contribution handling remains unsupported by this worker and stops explicitly.
- Targets use explicit same-origin frame chains, named containers, exact labels/roles/text/attributes, captioned tables with named-column row predicates, named cells, and definition-list fields. Ambiguous scope or targets fail. Column offsets are derived from unique visible headers; durable descriptors never contain ordinal rows, generated IDs/classes, raw CSS/XPath, or coordinates.
- The fixed browser function receives descriptors/values as JSON data. It resolves the target, checks cardinality/actionability and allowed control names, and dispatches in the same browser turn. It does not tag/mask the live DOM or select a first match. The native input setter and input/change events support the React target; `.click()` dispatches the UI event. Browserbase/Stagehand supply browser transport/session control; the TypeScript adapter owns this semantic/policy boundary.
- Policy origin and operation allowlists, explicit click/fill control-name allowlists, controller/revision checks, finite cumulative action/time budgets, and serialized admissions apply before mutation. Save-like controls are absent from the baseline policy. Off-origin form/link targets, new windows/downloads, password/hidden/file inputs, and inaccessible frames are blocked. Frame readiness can poll an initial blank document only when its declared source has an allowed origin.
- Dispatch intent is persisted before crossing into the browser. A command timeout/transport failure is treated as an unknown action outcome, closes admission, and never causes a blind retry. Closing/cancelling a gate does not free an unresolved command's slot. Cancellation returns promptly while cleanup/drain proceeds.
- Waits poll observations only. Every branch of a compound condition is evaluated; an error cannot be hidden by a true `any` branch or false `all` branch. Amount conversion uses checked integer minor units; invalid formats/overflow and wrong read types stop execution.
- The replay provider client rejects model calls and disables SDK self-healing/cache and provider recording/logging/CAPTCHA solving. Discovery has a separate sanitized model-proposal channel with cumulative model/time budgets; see [WORKFLOWS.md](WORKFLOWS.md).

Supported surface limits: the current adapter targets the known synthetic DOM and same-origin frames. It does not implement full accessible-name computation, arbitrary shadow DOM/cross-origin frames, complex spanned tables, trusted physical input events, or a desktop adapter. Unsupported structures fail closed. Control-name/origin allowlists express the known target contract; they cannot infer business effects in an arbitrary hostile application. Full scenario/policy/privacy verification remains INT-016 and subsequent handoff acceptance.

## Sessions, cancellation, and restart

A dedicated PostgreSQL advisory-lock connection permits one coordinator per automation database. Run acceptance and capacity reservation are transactional. The one-active-run index and occupied-session state keep capacity reserved through cancellation/cleanup; a terminal run with unconfirmed session closure still blocks another run. Losing the lock closes local admission and aborts the worker. Executor event writes also fence on persisted lifecycle/controller/revision.

Session creation records a local session reference, `creating` state, and conservative expiry **before** contacting the provider. The provider UUID is associated as soon as returned, including late creation during cancellation. The browser cannot silently be replaced within the run. Provider sessions have a finite configured lifetime; the current adapter supports up to 1,800 seconds and uses the admitted overall timeout. The local conservative expiry includes 120 seconds for launch latency/verification margin, with zero launch-request retries.

Cancellation closes admission, accounts for unresolved dispatch, drains for a bounded interval, requests browser closure, and verifies provider termination. A cancelled result preserves unknown dispatch/effect state where appropriate. Unknown closure leaves `uncertain` occupancy. On restart, pending/running work becomes `cancelled` with reason `INTERRUPTED`; raw goals/inputs are gone and no browser operation is redispatched. Known provider IDs are released/checked. A launch with no saved provider ID remains blocked until its conservative expiry; no operator flag can simply assert it closed.

To retry reconciliation after stopping the API/coordinator:

```sh
pnpm automation:reconcile
```

This uses the existing private database/provider configuration, obtains the coordinator lock, and verifies closure or elapsed conservative expiry. It exits nonzero while sessions still occupy capacity. If a provider launch timed out before returning its ID, inspect the provider dashboard as needed and retain the admission block until expiry. Do not delete rows, reset the database, or manufacture a closure marker to continue. More elaborate orphan cleanup/crash recovery is INT-017 follow-on work.

Validated successful outputs are transient: durable results record `not_retained`, with a bounded memory buffer of at most 32 results for five minutes, removed at expiry/process exit. Authorized reads during that window can return the values; later reads explicitly report `OUTPUTS_NOT_RETAINED`. Outputs are validated before storage/discard. Synthetic curated QA results are a separate explicit export.

## Failure evidence and retention

Action events retain logical operation/target/step, binding names, dispatch/effect state, timestamps and internal evidence UUIDs. They do not retain typed input values, raw goals, URL paths, arbitrary exceptions, or raw browser content. The terminal failure links the failing step and safe expected/observed summaries to its evidence.

The structural snapshot retains known screen labels, permitted control labels/enabled state, table headers/row counts and frame depth. Unknown text becomes null; all record IDs, names, balances, input values, URLs, hidden attributes and unrelated text are omitted. The recorder validates this actual outbound payload again before writing a private file. Unsupported/unsafe capture is suppressed; raw screenshots, DOM dumps, network traces and video are not fallback artifacts. This is a structural JSON artifact, not an image.

Runtime evidence files are ignored, private, UUID-addressed and readable only through the authorized linked run route. Access expires after 24 hours. Physical file purging/orphan reconciliation is not automated in this milestone; stop the service and remove obsolete runtime evidence as a local maintenance task. Curated `evidence/` exports are reviewed synthetic records retained with the repo. Provider recording/logging is disabled; no claim is made about provider-internal operational retention or memory zeroization.

## Hosted executor verification

Start `pnpm demo:serve` with the demo database initialized, then expose only the built target:

```sh
cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate
```

Stop the automation API first, then run with the printed HTTPS root and existing server-only Browserbase credentials:

```sh
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm executor:check
```

The check uses the actual coordinator, PostgreSQL event recorder, executor, and Browserbase adapter. It traverses both members' UI paths, reads member/account identity and both balances, then intentionally targets the two unscoped Open controls. That final run is expected to fail `AMBIGUOUS_TARGET`, with **zero dispatches for that target**, useful sanitized structural evidence, zero inference, and confirmed `COMPLETED` provider cleanup. It does not call the target API or import its repository/seed. It is authored executor QA, not discovery or saved-capability replay.

The command writes ignored results/events/evidence and uniquely versioned target/policy binding files under `apps/automation/runtime/int-007-008`. Stop the tunnel/target afterward. [Curated live result](evidence/int-007-008/README.md).

Normal API startup defaults to committed target v3 and policy v4 (built portal on port 3002); previous configuration files remain unchanged. Policy v4 adds explicit human-only resolution controls without extending the automation click allowlist. For a reachable browser binding, `AUTOMATION_TARGET_FILE` and `AUTOMATION_POLICY_FILE` can select absolute paths to a paired, validated versioned configuration. Both are required together. Accepted runs retain the exact snapshots/checksums; never edit retained versions to point at a different tunnel. The hosted verifier creates a fresh version for each ephemeral binding.

## Scenario rules and revisions (INT-012/013)

Read-only condition classification can batch target inspection into a single browser turn. Missing optional predicate targets return false; malformed bindings and ambiguity still fail. Rule guards run before terminal outcomes/recovery, with explicit context checks and finite per-step/run budgets. Ordinary actions and uncertain dispatches are never blindly retried. Explicit SDK transport-closed errors become `SESSION_LOST`; the scenario checker verifies real browser destruction separately from synthetic staff expiry. [Rules, provenance, verification, and limits](SCENARIOS.md).

## Integrated handoff work

The operator page and authenticated claim/manual observation/action/resume API are implemented in INT-014/015 and pass local ownership, stale-request, validation, and cancellation checks. Real operator discovery and replay handoffs are verified in [evidence/int-014-015](evidence/int-014-015/README.md), including publication with manual provenance and exact-version replay for another member with zero inference. These are integrated demonstrations beyond the earlier SDK spike/target-control QA. See [HANDOFF.md](HANDOFF.md) for the same-session continuation model, volatile screen views, explicit manual permissions, operation receipts, and the live verifier.
