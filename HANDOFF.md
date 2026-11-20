# Live session handoff

INT-014/015 connect the existing workflow worker, coordinator, authenticated API, and minimal Mantine operator page. Verification status and actual run references belong in the implementation plan and `evidence/int-014-015/`; an SDK spike or target-control check alone is not proof of this integrated flow.

## Run the demo

Use the existing [database](DATABASE.md) and [workflow](WORKFLOWS.md) setup. Configure Browserbase credentials and `AUTOMATION_API_TOKEN` only in `apps/automation/.env`. Stop other automation API instances/watchers before running the demo; the coordinator admits one active run.

```sh
pnpm db:up
pnpm db:migrate
pnpm automation:configure
pnpm demo:serve
# Separate terminal:
cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate
# Separate terminal:
pnpm dev:operator
# Separate terminal, using the current tunnel's HTTPS root:
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com/ pnpm handoff:demo
```

The demo creates temporary, ignored target/policy configuration with unique versions, starts the automation API on `127.0.0.1:3001`, and prints each run ID and every newly encountered intervention. Do not start another automation API alongside it. The target setup harness selects the scenario separately from the automation worker; no target business API/database access is granted to automation.

Open http://127.0.0.1:5173. Enter the **automation API token**, not the Browserbase key, and the printed run ID. The token stays in page memory; it is neither embedded in the bundle nor stored in browser storage. It must be entered again after reloading the page.

1. Discovery for M1001 may request help before the scenario dialog, for example at **Member Overview**. Claim that pause, click **Account Inquiry** once, then **Validate and resume**. Do not wait for a dismissal control on Account Inquiry: the servicing review appears only when an account is opened. When discovery subsequently pauses at **Servicing review required**, claim the new intervention, click **Dismiss servicing review**, then **Validate and resume**. The model continues after validation and publishes a capability accounting for each human contribution.
2. The verifier starts a separate API process and replays that exact saved version for M1002, with inference forbidden. Open the second printed run ID. If the capability preserved the earlier manual navigation boundary, claim it and click **Account Inquiry**. At **Staff session expired**, click **Restore staff session**, then **Validate and resume**. If expiry is a separate intervention, claim that intervention first. Replay rechecks the saved condition and identities before continuing.

The page displays controller/revision, step, reason, checkpoint context, session reference, and deadline. Refresh session view if the screen changes. Manual buttons operate the existing hosted browser through the mediated executor. The PNG view is refreshed on demand; it is not an unrestricted remote-control iframe. Each action consumes its observation; refresh before the next action.

The verifier checks typed outputs, manual events, control transitions, exact artifact references, distinct processes/members, zero replay inference, and confirmed browser cleanup. Private run reports go to ignored `apps/automation/runtime/int-014-015/`. It resets the next target session to baseline and closes its API/browser after each run. Stop the target, operator page, and tunnel afterward. The verifier requires real operator actions; it does not secretly resolve interventions itself.

For a model-free check using the earlier genuine balance capability, run the same command with `HANDOFF_REPLAY_ONLY=1`. This publishes an explicitly authored rule/environment-binding revision, then exercises only the replay takeover. It requires the earlier persisted discovery under the demo operator; it does not fabricate discovery or mark the discovery handoff verified. [Actual replay handoff evidence](evidence/int-014-015/README.md).

## Control and continuation

- Automation closes admission and drains/account for its current browser command before opening an intervention. Existing run, browser, input bindings, and captured variables stay in memory. The browser is never replaced on resume.
- Claim increments the persisted control revision and assigns the authenticated operator. Request bodies cannot choose an operator identity. Only the run's authorized principal can access its intervention; manual observation/images also require operator access.
- Manual observation and input are serialized with resume. Observation IDs and fingerprints reject stale page input; semantic targeting, uniqueness, actionability, allowed origins/actions, and allowed field types are still enforced at dispatch.
- Policy v4 adds `manualClickNames` for the two synthetic resolution controls. These names do not become automation permissions. Existing ordinary allowlists still apply. Arbitrary navigation is not offered by this operator surface, and typed values/resolution notes are not retained in events or artifacts.
- Human events contain the intervention, operator, control revision, safe control name, operation, and completion/uncertainty. Mutation receipts are HMAC fingerprinted and prevent a repeated accepted manual request from dispatching twice. Inspect an operation receipt after a lost response rather than issuing a new action key blindly.
- Resume closes human admission and enters `validating_resume`, with no human/automation owner. The executor validates the explicit continuation condition and member/account guards. Failed validation returns to `waiting_for_human` with a new revision and requires a fresh claim. Successful validation returns control to automation and releases the suspended workflow.
- A known intervention guard encountered during discovery is represented by a `runtime_guard` manual contribution referencing that declared guard and actual human completion events. The contribution never turns a human-only click into unattended automation. An explicit planner help request is represented by a required intervention step. Replay honors those recorded manual boundaries and never invokes the model.
- Discovery may derive an unknown destination checkpoint from the resolved UI; replay must validate the checkpoint already recorded in its artifact. An action that completed before the pause is not executed again merely because the operator handed back.

## Deadlines, uncertainty, and limits

Human waiting consumes the intervention and overall deadlines, including a shorter timeout declared by an explicit artifact intervention step. Accounted pause time is excluded from the active execution budget; automation/validation admission counts and recovery-attempt budgets are preserved. Manual actions have their normal finite execution deadline and a maximum of 32 confirmed actions per intervention. Provider session expiry remains fixed. Closing the operator tab does not release control or start automation; an abandoned claim times out or can be cancelled.

Cancellation closes both control paths. A command already sent to the browser may have an unknown effect; cancellation and lost transport preserve that uncertainty and never trigger a retry. Stale revision requests are rejected. Session loss is a hard stop; process restart interrupts the run and uses the existing reconciliation path rather than reconstructing a continuation from missing volatile input state.

This is a single-principal local assessment console, not a multi-user support product. There is no collaborative cursor, websocket streaming, claim heartbeat, or automatic reassignment. Provider debugging/control URLs are not exposed. Screen PNGs may contain the synthetic portal's record values: they are authenticated, returned with `no-store`, held only in the operator page, and never included in artifacts or retained evidence. Retained richer failure evidence continues to use the sanitized structural snapshot boundary. Full policy/redaction verification remains INT-016.

## API additions

All routes require the existing bearer token. Mutation routes require `Idempotency-Key`; claims/resume/actions also require `expectedControlRevision`.

| Route | Behavior |
| --- | --- |
| `GET /v1/interventions/:id` | Owned intervention and blocked context. |
| `GET /v1/interventions/:id/context` | Operator-only volatile discovery goal, if this process still has it. |
| `POST /v1/interventions/:id/claim` | Acquire the waiting intervention at the expected revision. |
| `GET /v1/interventions/:id/observation?revision=N` | Operator-only safe controls and a fresh observation ID. |
| `GET /v1/interventions/:id/image?revision=N` | Operator-only current browser PNG; no persistence. |
| `POST /v1/interventions/:id/actions` | One permitted click/fill using the fresh observation and current revision. |
| `POST /v1/interventions/:id/resume` | Validate continuation, then return ownership or reject hand-back. |

Existing run/event/operation/cancel routes remain available. `CONTROL_CONFLICT`, `STALE_OBSERVATION`, and `RESUME_VALIDATION_FAILED` are HTTP 409. A read-only identity cannot perform manual observation or view the screen. Sensitive goal text and typed values are not placed in event details or receipts; the authenticated context endpoint is volatile.

This prototype requires at least one confirmed manual UI action before accepting hand-back; inspection-only approval is not implemented. A stop without a recorded continuation cannot be claimed through the operator page and must be inspected/cancelled rather than silently restarted.

New discovery runs pin `openai/gpt-4.1` through the existing Browserbase Model Gateway. GPT-5 completed some decisions but also exceeded request/active deadlines in verification; a small GPT-4.1 probe completed in about eight seconds. The same sanitized planner, policy checks, finite budgets, and model-free replay path apply. Earlier GPT-5 evidence remains historical evidence for its original runs.
