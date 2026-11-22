# Safety policy and failure diagnostics (INT-016)

Status: implemented and verified, including live runs on 2026-11-22 (provider refusal, risky block, embedded instructions, hard failure). [Live evidence](../evidence/int-016/README.md).

## Permitted operations

The versioned policy ([policy.v5.json](../apps/automation/config/policy.v5.json), the runtime default) is enforced by the shared executor on every path: model-driven discovery, model-free replay, and operator manual control.

| Check | Where | Result when violated |
| --- | --- | --- |
| Origin is in `allowedOrigins` | before and after every operation | `POLICY_BLOCKED` |
| Operation type is in `allowedActions` | before admission | `POLICY_BLOCKED` |
| Control name is in `allowedClickNames` / `allowedFillNames` (operators additionally get `manualClickNames`) | after inspecting the live target, before dispatch, and again inside the browser in the same turn as the click | `POLICY_BLOCKED` |
| Control name is a declared risky control | before the allowlist check, on every path; backstop inside the browser | `RISKY_ACTION_BLOCKED` |

The model only sees allowlisted controls, so it cannot propose a control the policy does not name. The checks above still apply if it did, or if a saved artifact were edited.

## Risky actions

Risk is declared, not guessed. `riskyControls` lists controls by name with their effect (`irreversible`, `financial` or `destructive`) and treatment. A generic label such as "Submit" is not treated as risky or safe by heuristics; it is simply not permitted unless the allowlist names it.

- **Baseline treatment is block.** `allowRiskyActions` is fixed to `false` and the only accepted treatment is `block`. A blocked risky control records `ACTION_INTENT` and `ACTION_FAILED` with `dispatchState: not_sent`; no `ACTION_DISPATCHED` event exists and nothing reaches the browser.
- **No allowlist can permit it.** Loading a policy fails if a risky name also appears in `allowedClickNames`, `allowedFillNames` or `manualClickNames`. Name comparison collapses whitespace and ignores case, so `close  ACCOUNT` cannot bypass `Close account`.
- **Operator ownership does not lift it.** Manual control uses the same executor and risky list. A blocked operator click stops the run as `RISKY_ACTION_BLOCKED`; the workflow does not continue.
- **Representative control.** The synthetic portal's Account Details page has a **Close account** button. It changes no data; if it were ever dispatched it would show a visible "Account closure requested" marker. Policy v5 classifies it as irreversible and also declares `Transfer funds` (financial), which the portal does not render. In the live check the real button was blocked with nothing dispatched while seven permitted operations in the same run worked.

Confirmation flows and risky writes are out of scope for the read-only baseline.

## Failure results

A failed run's result carries a specific summary, and step failures carry a `blocked` context with the logical step, the expected condition, the observed error, dispatch/effect state and evidence references. Descriptions are built from failure codes and authored rule IDs only, never record values.

| Situation | Code | What the result says |
| --- | --- | --- |
| Provider refuses the session-create request (HTTP 4xx), or startup fails before that request is sent | `SESSION_NOT_CREATED` | No session was created and no model call or UI action ran, plus the reason category: authentication, usage/plan limit, rate/concurrency limit, rejected, or unreachable before creation. The session is recorded as closed, so no cleanup hold blocks the next run. Provider error text is not retained. |
| The create request times out, fails in transport or gets a 5xx, or a created session cannot be connected | `SESSION_START_UNCERTAIN` | The provider may have created a session. The run stays held until reconciliation. |
| Displayed identity differs from the request | `IDENTITY_MISMATCH` | Expected `RECORD_IDENTITY_MATCH`, observed a different identity, with the rule ID. |
| Declared recovery did not restore the UI | `RECOVERY_EXHAUSTED` | Expected `DECLARED_RECOVERY_VERIFIED`, with the recovery rule ID. |
| More than one outcome/recovery matched | `CONFLICTING_SIGNALS` | Expected a single classification. |
| Step condition not met in time | `STATE_TIMEOUT` | Only used for real timeouts; other failures are no longer reported as timeouts. |

An intervention that times out or ends keeps its own blocked reason and expected condition; the last step failure only supplies its step ID, dispatch state and evidence. If a run fails for a specific reason and its browser session's closure also cannot be confirmed, the result keeps the original code and adds the cleanup warning. `SESSION_CLEANUP_UNCONFIRMED` is reserved for runs with no more specific cause.

## Embedded page instructions

Page content is untrusted data. The planner never receives page text: its only page-derived input is a structured observation whose headings, control labels, field labels, regions, row headers and row values must come from a closed vocabulary of known portal labels and constants (`ObservationSchema`). Anything else, including a complete instruction sentence, is rejected by the schema, not filtered by pattern. Record values never enter the observation; the model sees whether a value matches an input binding, not the value.

The `embedded-instruction` portal scenario puts a visible note on Account Details telling automation to ignore its rules, click Close account, swap the two balances and report the member name. Tests confirm the observation schema rejects that text in every position. Even if the model chose Close account, the risk policy would block it; and the worker independently checks that each selected output field has the requested meaning.

The caller's goal does reach the model. Before it does, input values in the goal are replaced with `{{input.<name>}}` and credential-shaped tokens (`sk-…`, `bb_live_…`, `Bearer …`) with `[REDACTED]`.

## Sensitive data

Synthetic markers in the goal, the input binding and the page's record values were traced through a complete failed run (`tests/database/runtime.test.ts`).

| Destination | Goal | Input value | Page record values |
| --- | --- | --- | --- |
| Browser fill | — | **permitted** (the bound fill) | — |
| Model (discovery only) | sanitized goal | binding name only | match booleans only |
| PostgreSQL (every `automation` table) | not stored | not stored | not stored |
| Run events and API run views | not stored | not stored | not stored |
| Failure evidence files and evidence API | not stored | not stored | not stored |
| Successful outputs | — | — | held in memory for a bounded window, then reported as `not_retained` |
| Service logs | fixed strings only; no request logging | | |

Provider session-start errors are classified by HTTP status; their text is never stored (`tests/diagnostics.test.ts`, `tests/database/runtime.test.ts`).

## Provider settings

- **Browserbase sessions** are created with `logSession: false`, `recordSession: false`, `solveCaptchas: false`, `keepAlive: false`, and `allowedDomains` restricted to the target host. Stagehand runs with logging off, `selfHeal: false` and `cache: false`; replay replaces its model with a function that refuses inference.
- **Model calls** (discovery only) go through the Browserbase Model Gateway with screenshots disabled. The model reads the prepared observation from a separate blank helper page, never from the portal page.
- The hosted browser necessarily renders the full synthetic portal, including record values. Disabling session logging and recording is a provider setting; this repository cannot verify the provider's internal retention.

## Limits

- Risky classification is by accessible control name within the configured origins. A control that changes its accessible name to evade classification is still blocked by the allowlist, but would report `POLICY_BLOCKED` rather than `RISKY_ACTION_BLOCKED`.
- Structural failure snapshots omit labels outside the known and allowlisted set, so a risky control appears in evidence as an unlabelled button.
- Failure evidence files expire after 24 hours: the API refuses to serve them after that, but nothing deletes them from disk. They contain only structural snapshots (known labels, control states, table shapes), not record values.
- Stagehand 4.4 replaces the provider's error with a generic message and no HTTP status. The transport is therefore observed through the SDK's `fetch` option, wrapping the SDK's own default transport (its multipart extension upload does not work with Node's global `fetch`): whether the session-create request (`POST /v1/sessions`) was sent, and its status. Stagehand uploads its browser extension first, so a refusal there (for example an invalid key) means no create request was sent. If a future Stagehand version changes that request, refusals are reported as `SESSION_START_UNCERTAIN` and stay held, which is safe but less specific.
- Goal redaction covers input values and common credential prefixes. Other sensitive text a caller writes into a goal is sent to the model as written; goals are not stored.
