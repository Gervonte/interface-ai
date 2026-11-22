# Evidence

Everything here comes from real runs: Browserbase-hosted browsers operating the synthetic PostgreSQL-backed credit-union staff portal in this repository. Discovery used a real LLM (`openai/gpt-4.1` through the Browserbase Model Gateway, earlier milestones `openai/gpt-5`). Nothing here is mocked or hand-edited. Test-only and authored material is labelled where it appears.

## End-to-end demonstration (start here)

Produced on 2026-11-22 by `pnpm demo:e2e` (the [README demo path](../README.md#demo-goal--discovery--saved-capability--replay)) on the final code. One discovery produced one capability; both replays consumed that exact version. Each run used its own automation API process and browser session, and every session reports `closed`.

| File | What it is |
| --- | --- |
| [request.json](request.json) | The caller's input: natural-language goal, typed output contract, target and `memberId` binding (M1001). |
| [discovery.json](discovery.json) | Discovery run `c8c13c74-e1bc-4d3c-b037-35c4895bc8a9` (process 9394). Seven model decisions (11325 input / 664 output tokens), the browser actions they led to, verified reads and the typed result: M1001 / S2001, savings, USD, `currentBalanceMinor: 125034` ($1,250.34). |
| [capability.json](capability.json) | The saved artifact `account-read-236d0fa56936446887d29fbe0f393114`, version 1, with `sourceDiscoveryRunId` = the discovery run above. 13 parameterized steps; every step's `source` points at the discovery event that confirmed it. No member IDs, account IDs or balances appear in it. |
| [replay.json](replay.json) | Replay run `aef005d0-e6c7-4076-a0b8-1223f8cea8d2` (process 9881) of that exact version for M1002: S2002, `currentBalanceMinor: 8765` ($87.65). Zero model calls, inference attempts and tokens. |
| [replay-not-found.json](replay-not-found.json) | **Exceptional replay** `09425a08-63a4-4132-8b3a-dd27c6ead777` (process 10090) of the same version for M9999, a member the portal does not have. The search screen shows "No matching member" for the searched ID, the capability's `member-not-found` rule matches at `step-004`, and the result is the business outcome `MEMBER_NOT_FOUND`, not a failure. Zero model use; no later step ran. |

The capability's outcome, recovery and runtime-guard rules are **authored** declarations attached by the discovery worker (marked `source.kind: authored`); the steps, targets and output fields are what discovery recorded from the model-selected route. Run views contain each run's own synthetic outputs once, in its result. Files were scanned for credentials, tokens, cookies and tunnel hostnames before export.

## Detailed evidence by area

| Area | Evidence | Highlights |
| --- | --- | --- |
| Goal-driven discovery | [int-023](int-023/README.md) | Current vs. available balance from the same planner and worker: two discoveries select different UI fields, each replayed for another member with zero inference. |
| Runtime conditions and recovery | [int-012-013](int-012-013/README.md) | 19 live scenario checks on one saved capability: business outcomes (not found, no primary savings, access denied), delays, notice and inquiry recovery, exhausted recovery, validation error, wrong member/account, duplicates, conflicting signals, browser loss, intervention requests. Uses an authored rule revision (v3) of an earlier genuine discovery; the original v1 and its discovery are in [int-009-011](int-009-011/README.md). |
| Human handoff | [int-014-015](int-014-015/README.md) | A real operator took control of the live session in both discovery and replay, performed a manual action, and handed back; both runs resumed and completed. Claim, manual action and validated return are separate events in one run record. |
| Safety and hard failures | [int-016](int-016/README.md) | Provider refusal reported precisely; the real Close account control blocked before dispatch while permitted actions work; discovery unaffected by instructions embedded in the page; a hard `IDENTITY_MISMATCH` failure with step, expected/observed conditions, rule ID and a structural snapshot. |
| First discovery and replay | [int-009-011](int-009-011/README.md) | The original genuine discovery → capability → changed-input replay, plus a model-timeout run that stopped safely. |
| Executor and coordinator | [int-007-008](int-007-008/README.md) | Shared executor driving the portal; an ambiguous control dispatches nothing. |
| Portal and connectivity | [int-006](int-006/README.md), [int-003](int-003/README.md), [int-002](int-002/README.md) | Hosted-browser access to the portal, iframe and table rows; SDK boundary checks. |

Historical folders keep their original run IDs and capability references. Later code changed the artifact names (`balance-…` → `account-read-…`) and added fields; those artifacts are not rewritten to look current.

## What is not here

No credentials, API keys, cookies, provider session or replay URLs, screenshots, raw DOM, model transcripts, runtime databases or browser profiles. Failure evidence is a structural snapshot: known labels, control states and table shapes, without record values or arbitrary page text. See [docs/SAFETY.md](../docs/SAFETY.md) for the data-handling rules these exports follow.
