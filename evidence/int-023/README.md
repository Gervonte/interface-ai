# INT-023: goal and output contract drive discovery

Verified on 2026-11-21 (America/New_York); UTC timestamps extend into November 22. All four runs are real Browserbase/Stagehand sessions against the synthetic PostgreSQL-backed staff portal, run by `pnpm goal:demo` with configuration version `1795313449`. Each run used a separate API process and browser session.

| Request | Run | Process | Capability | Member / account | Output |
| --- | --- | --- | --- | --- | --- |
| [Current balance](current/request.json) | [discovery](current/discovery.json) `ba60b64e…` | 16867 | [`account-read-8b836f3e…`](current/capability.json) v1 | M1001 / S2001 | `currentBalanceMinor: 125034` ($1,250.34) |
| Current balance | [replay](current/replay.json) `5d12caa5…` | 17379 | same exact version | M1002 / S2002 | `currentBalanceMinor: 8765` ($87.65) |
| [Available balance](available/request.json) | [discovery](available/discovery.json) `c96b083d…` | 17616 | [`account-read-a66a8d8a…`](available/capability.json) v1 | M1001 / S2001 | `availableBalanceMinor: 120034` ($1,200.34) |
| Available balance | [replay](available/replay.json) `302820e7…` | 18117 | same exact version | M1002 / S2002 | `availableBalanceMinor: 7600` ($76.00) |

- **Same implementation, different request.** Both discoveries used the same planner prompt and worker; only the goal text and `outputContract` differ. Each discovery made 7 `openai/gpt-4.1` calls with positive token usage (11297/654 and 11323/700 input/output tokens).
- **Distinct UI fields.** The current artifact extracts `currentBalanceMinor` from the field labelled **Current Balance**; the available artifact extracts `availableBalanceMinor` from **Available Balance**. Both use the `usd-minor` conversion, and each artifact's output schema equals the schema derived from its request.
- **Parameterized artifacts.** Each 13-step capability names its discovery run as `sourceDiscoveryRunId` and contains no M1001/S2001 or balance literals.
- **Model-free changed-input replay.** Each replay loaded the exact saved capability version for M1002, whose account order and balances differ, and reported zero model calls, inference attempts, input tokens, output tokens and model events. Member/account identity and account type/currency matched the request.
- **Cleanup.** All four sessions report `closed`. The verifier restored the target's baseline scenario on exit.

[Runner result](result.json) holds the verifier's summary of all four runs. The run views contain each run's own transient output values once, in its result; the synthetic member/account IDs and balances there are intended demo data. Files were scanned for credentials, bearer tokens, provider URLs and tunnel hostnames before export; none are present. No screenshots, raw DOM or model transcripts are included.

Local checks at the time of the live runs: 218 default tests, 37 PostgreSQL tests, typechecking and production builds pass (`pnpm check:db`).

[Earlier blocked attempt](blocked-attempt/verification-blocked.json): before these runs, Browserbase session creation returned HTTP 402 (usage/plan restriction) before any model call or UI action. That attempt published nothing and is kept for the record; its run reported the misleading code `SESSION_CLEANUP_UNCONFIRMED`, which is tracked under INT-016.

[Request contract, supported meanings and how to rerun](../../GOAL_OUTPUTS.md).
