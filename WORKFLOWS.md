# Discovery and saved-capability replay (INT-009–011)

Discovery supports bounded account inquiry from a supplied goal, explicit typed output contract, target, and `memberId` input. The requested names, meanings (including current versus available balance), and account criteria inform one generic planner; the worker independently validates those choices and constructs the saved artifact. New runs use `openai/gpt-4.1` through Browserbase Model Gateway. No expected balance, member record, or authored route is supplied to the planner. See [request format and two-goal verification](GOAL_OUTPUTS.md). The INT-009–011 evidence below remains the original historical balance milestone.

## Run the real demo

Configure the databases and server-only credentials using [DATABASE.md](DATABASE.md) and [BROWSERBASE_SETUP.md](BROWSERBASE_SETUP.md). `apps/automation/.env` needs its automation `DATABASE_URL`, `REQUEST_FINGERPRINT_KEY`, `AUTOMATION_API_TOKEN`, `BROWSERBASE_API_KEY`, and `BROWSERBASE_PROJECT_ID`. `pnpm automation:configure` creates a missing operator token without printing it. The existing Browserbase key authorizes Model Gateway; no separate model-provider key is needed.

Stop any automation API or development watcher first: one coordinator owns the database. Start Docker Desktop, then run:

```sh
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm db:reset-demo
pnpm automation:configure
pnpm check:db
pnpm demo:serve
```

In a second terminal, expose only the synthetic portal on port 3002:

```sh
cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate
```

In a third terminal, use that tunnel's current HTTPS root:

```sh
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm workflow:demo
```

This makes real paid browser/model requests. It launches an authenticated loopback automation API child, discovers for M1001, exports the capability through its authorized API, and waits for confirmed browser closure. It stops that process, starts another API process, loads the exact saved capability version from PostgreSQL, and replays for M1002. The second member has a different balance and account order. The command checks process IDs, exact capability references, typed UI outputs, model metrics, and session cleanup; any discrepancy exits nonzero. No automation code imports target fixtures or calls target business APIs.

Expected results: M1001/S2001 returns `currentBalanceMinor: 125034`; replay for M1002/S2002 returns `8765`. Both return savings/USD. The runner's assertions use these synthetic QA expectations; those values are never planner inputs or replay steps. Successful replay has zero model calls, tokens, and forbidden-inference attempts. [Actual exported evidence](evidence/int-009-011/README.md).

To repeat only replay while the original tunnel/binding remains available:

```sh
WORKFLOW_REPLAY_ONLY=1 BROWSERBASE_PORTAL_URL=https://your-original-tunnel.trycloudflare.com pnpm workflow:demo
```

This uses the prior successful private `result.json` and its unchanged binding version; it does not rediscover or change the target URL behind a retained version. An expired/different tunnel requires a new full demonstration.

The private `result.json` retains the last successful discovery/replay pair for replay-only use; per-mode reports reflect their latest attempt, so correlate run IDs. Private reports, the actual capability, and fresh versioned target/policy bindings are written under ignored `apps/automation/runtime/int-009-011`. Each invocation creates a new binding version and capability ID; retained versions are not overwritten. A failed discovery produces no capability. If it pauses, the runner inspects the owned intervention, requests cancellation, and cleans up. Stop the tunnel and demo server with Ctrl+C afterward. The runner stops its API children; PostgreSQL can remain running.

For the real API outside this verifier, set `AUTOMATION_TARGET_FILE` and `AUTOMATION_POLICY_FILE` to a paired reachable configuration before starting `pnpm dev:automation`. Both files are required together. The default committed target v3 points to loopback and is unsuitable for a hosted Browserbase browser. New discovery requires the explicit output contract. Invalid contracts fail transport validation; malformed member bindings stop with `INVALID_BINDING` before opening a session. Unsupported goals may require one bounded model decision before stopping with `UNSUPPORTED_GOAL`; there is no keyword pre-gate. Valid transport still receives an asynchronous accepted-run reference first.

## How discovery constructs the artifact

The fixed browser observer traverses visible same-origin portal documents and the named servicing iframe. It emits known headings, permitted controls, semantic frame/container/table-row descriptors, static account classifications, and booleans indicating matches to input bindings. Record IDs, names, balances, input values, raw DOM, and arbitrary UI text are omitted from model context. A local digest includes UI values and control state for proposal freshness; the digest is not sent to the model.

A separate `about:blank` helper document contains only that sanitized observation, input names, prepared goal, requested output contract, and static action history. Stagehand `extract` with screenshots/cache disabled requests one structured next action or completion/help decision. The controlled portal is never masked or rewritten. The gateway schema is structural; stricter local UUID, reference, length, and action checks follow. Model inference is bounded to 120 seconds per request and the remaining active/overall deadline. The existing policy also limits total model calls, actions, and waits.

The planner chooses a control reference, and a fill names an input binding rather than supplying a literal. The engine rejects stale observations, disabled/unknown controls, and invalid bindings. The shared executor independently resolves uniqueness, policy, and readiness before dispatch. There is no automatic model repair in replay.

After a successful operation, the builder records its actual confirmed event sequence, learned targets, bindings, and before/after conditions. Selecting an account first captures its ID from the selected UI row into a typed variable; the Open step and final identity check reuse that variable. The account ID is not baked into the artifact. A finish decision must reference the requested semantic fields within Account Details: a current-balance request cannot use Available Balance, and the reverse is also rejected. The executor verifies member/account identity, the requested account type/designation/status, typed output values, and context after capture. Output names and schemas come from the caller contract.

Publication is transactional. It requires actual model usage, confirmed step events with matching step IDs/operation types, and the complete ordered mutation history. Missing, duplicated, mismatched, or omitted mutation sources cannot publish a capability. The artifact contains data and references, never executable generated code or a model transcript.

## Replay contract

Replay retrieves an exact owned capability version and validates inputs before session creation. It interprets each step through the same executor, binds the new member ID, captures account/output variables through UI reads, and checks the recorded conditions and final identity. It rereads declared outputs and checks the final context before returning success. Amount parsing uses checked integer minor units.

A fresh session's first step must be configured entry navigation; its `before` condition is the `fresh-session` location. Artifact-level entry preconditions apply **after that first navigation**, when the target exists. Later navigation is rejected by this interpreter. This convention is explicit rather than assuming the new browser already has portal state.

The replay Stagehand instance uses a model callback that counts and rejects every inference attempt. Cache and self-healing are disabled. The worker does not call the planner or use AI extraction. Run events and `SESSION_FINISHED` record usage and cleanup; successful outputs remain in the authorized five-minute memory buffer, while durable results record non-retention. Curated synthetic exports are explicit separate files.

## Current limits

Discovery remains bounded to the known same-origin portal, account criteria, fields, formats, and conversions in [GOAL_OUTPUTS.md](GOAL_OUTPUTS.md). It supports explicit current/available contracts and renamed outputs; arbitrary tasks and applications remain outside scope. [Authored outcome/recovery rules](SCENARIOS.md) and [live human handoff](HANDOFF.md) are supported. Missing-primary-savings rules are scoped to that requested account family. Every authored declaration remains distinguished from the model-selected action history.

Hard model/action/time limits stop the run. Earlier GPT-5 timeout evidence remains historical; current discovery uses GPT-4.1. A model-service failure is a hard failure, not a fabricated business outcome or a resumable checkpoint. There is no automatic retry that hides failed attempts.

Offline tests use injected planners/surfaces to exercise construction, changed-input replay, provenance, current/available balance mapping, identity rejection, unsupported goals/bindings, and the sanitized gateway document. They are distinguished from the real hosted runs. `pnpm check:db` additionally verifies transactional publication, omitted-history rejection, intervention ownership/session retention/cancellation, and the earlier lifecycle boundaries. The full assessment and final submission report remain later work.

The default runtime now uses committed target v3 and policy v4. Earlier bindings and saved artifacts remain unchanged. Existing capabilities need an explicit immutable rule revision to gain the new declarations; the scenario verifier creates one without inventing another discovery.

Integrated operator claim, manual actions, and validated resume are documented in [HANDOFF.md](HANDOFF.md). Real discovery and exact-artifact replay handoffs are verified in [evidence/int-014-015](evidence/int-014-015/README.md), including explicit human contribution provenance and zero replay inference. Use `handoff:demo` for operator verification; this baseline `workflow:demo` verifier still cancels unexpected interventions for cleanup.
