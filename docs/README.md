# Documentation

| Topic | Document |
| --- | --- |
| Design write-up (the seven assessment headings) | [../REPORT.md](../REPORT.md) |
| Full system design: requirements, data model, API, deep dives | [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) |
| Artifact and run contracts | [CONTRACTS.md](CONTRACTS.md) |
| Goal and output contracts | [GOAL_OUTPUTS.md](GOAL_OUTPUTS.md) |
| Discovery and replay workflow | [WORKFLOWS.md](WORKFLOWS.md) |
| Runtime conditions, rules and recovery | [SCENARIOS.md](SCENARIOS.md) |
| Human handoff, step by step | [HANDOFF.md](HANDOFF.md) |
| Safety policy, data handling and diagnostics | [SAFETY.md](SAFETY.md) |
| API, runtime configuration and limits | [RUNTIME.md](RUNTIME.md) |
| Portal, database and Browserbase setup | [PORTAL.md](PORTAL.md), [DATABASE.md](DATABASE.md), [BROWSERBASE_SETUP.md](BROWSERBASE_SETUP.md) |
| Stack choices and SDK compatibility | [STACK.md](STACK.md), [SDK_COMPATIBILITY.md](SDK_COMPATIBILITY.md) |
| Plan, acceptance checklist, milestone history | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [ACCEPTANCE.md](ACCEPTANCE.md), [VERIFICATION_HISTORY.md](VERIFICATION_HISTORY.md) |

## Calling the API directly

The automation API (`pnpm dev:automation`, port 3001) is what an agent would call. Requests need `Authorization: Bearer <AUTOMATION_API_TOKEN>` (from `pnpm automation:configure`) and an `Idempotency-Key`. The target's `entryPoint` and allowed origin must point at the tunnel; `pnpm demo:e2e` writes such a configuration for you, and [RUNTIME.md](RUNTIME.md) explains how to supply your own.

```sh
# Discovery: goal + output contract + inputs. Returns 202 with a runId.
curl -s -X POST http://127.0.0.1:3001/v1/runs -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' -d @examples/discovery-current.json
# Poll the run; on success its result names the saved capability {id, version}.
curl -s http://127.0.0.1:3001/v1/runs/$RUN_ID -H "Authorization: Bearer $TOKEN"
# Replay: an exact capability version + inputs. No model is consulted.
curl -s -X POST http://127.0.0.1:3001/v1/runs -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' -d '{"mode":"replay","targetId":"demo-credit-union","capability":{"id":"<id>","version":1},"inputs":{"memberId":"M1002"}}'
```

Also: `GET /v1/runs/:id/events` (the structured log), `GET /v1/capabilities/:id/versions/:version` (the artifact), `GET /v1/runs/:id/evidence/:evidenceId` (failure snapshots) and `POST /v1/runs/:id/cancel`.

## Repository layout

```text
apps/automation/   Automation API: coordinator, executor, discovery worker, replay, rules, Browserbase and local browser adapters
apps/operator/     Operator page for interventions (React + Mantine)
apps/demo-api/     The target portal's backend and scenario harness (Express + PostgreSQL)
apps/demo-web/     The target portal's staff UI (React + Mantine)
packages/contracts Public schemas: capability artifact, run requests/results, output contracts
packages/postgres  Connection, transaction and migration helpers
scripts/           Database tooling and the live demos/verifiers
tests/             Unit/contract tests; tests/database/ holds the PostgreSQL suite
examples/          Example discovery requests and an example capability contract
evidence/          Curated real-run evidence
docs/              These documents
```
