# Local replay without hosted services

Produced on 2026-11-22 by `pnpm replay:local` on the final code. Each run replayed the committed [capability](../capability.json) (`account-read-b6ae807a…` v1, from the genuine discovery in [../discovery.json](../discovery.json)) against the portal served by `pnpm demo:serve` on `http://127.0.0.1:3002`, in a local headless Chrome. The Browserbase credentials, automation database URL and API token were removed from the environment: no hosted browser, tunnel, model or automation database was used. Replay ran the same worker, executor, rule engine and policy v5 as the hosted path.

| File | Input / portal scenario | Result |
| --- | --- | --- |
| [success.json](success.json) | M1002 / baseline | `success`: S2002, savings, USD, `currentBalanceMinor: 8765` |
| [not-found.json](not-found.json) | M9999 / baseline | `business_outcome` `MEMBER_NOT_FOUND` |
| [recovered.json](recovered.json) | M1002 / servicing notice | `success` with `recoveries: [{ ruleId: "acknowledge-notice", attempts: 1 }]` — the declared notice was dismissed once and verified |
| [identity-mismatch.json](identity-mismatch.json) | M1001 / wrong member shown | `failure` `IDENTITY_MISMATCH` at `step-006`: expected `RECORD_IDENTITY_MATCH`, rule `member-identity-0`; no later step ran |
| [identity-mismatch-evidence.json](identity-mismatch-evidence.json) | — | The structural failure snapshot for that step |

Every run reports zero model calls and zero inference attempts, and the browser closed. Each record holds the full event log; synthetic values appear only in its own result. Files were scanned for credentials and tokens before export.

Local replay binds the capability to a local environment: the application family must match, but the recorded target version is not required, since nothing is persisted. Records are written to the ignored `apps/automation/runtime/local-replay/` rather than PostgreSQL. Local mode has no operator, so a step that would ask a person for help ends as `HUMAN_HELP_REQUIRED`. Only loopback targets are accepted.
