# Interface AI — computer-use automation for legacy back-office apps

An LLM operates a back-office web application once to accomplish a goal. The system records what worked as a typed, versioned **capability**. Afterwards that capability is **replayed deterministically**, with no model in the loop, for any valid input. Replay distinguishes success, expected business outcomes (such as "no such member") and hard failures. When automation cannot safely continue, a human takes over the same live browser session and hands it back. A policy allowlist and risky-action block apply on every path.

The target is a synthetic credit-union staff portal built in this repository: a PostgreSQL-backed member servicing app with an iframe workspace, table-based results and no test IDs, plus scenarios for runtime errors. The browser is hosted by Browserbase and driven through Stagehand; discovery uses `openai/gpt-4.1` through the Browserbase Model Gateway.

- **[REPORT.md](REPORT.md)** — design write-up: architecture, artifact schema, determinism and error handling, heterogeneity and multi-tenant, escalation and handoff, safety, cuts.
- **[evidence/](evidence/README.md)** — real discovery and replay logs, the saved capability, an exceptional replay, and detailed evidence for scenarios, handoff and safety.
- **[docs/](docs/)** — supporting guides and the full design and plan (index [below](#documentation)).

## Requirements

- Node.js **26.2.0** (`nvm use` reads `.nvmrc`) and pnpm **10.32.1**.
- Docker Desktop with Compose, for the local PostgreSQL databases.
- A **Browserbase** account: API key and project ID. Discovery's model calls go through Browserbase's Model Gateway on the same credentials, so no separate model-provider key is needed.
- `cloudflared`, to give the hosted browser an HTTPS route to the locally served portal.

**Replay needs no model, but it still needs a browser.** Every discovery and every replay runs in a Browserbase-hosted browser, which must reach the portal over HTTPS. Without Browserbase credentials and a tunnel you can run the checks below, but not discovery or replay. A local-browser replay adapter is listed under [Cuts](REPORT.md#cuts).

## Setup (once)

```sh
pnpm install --frozen-lockfile
cp apps/automation/.env.example apps/automation/.env
# Edit apps/automation/.env: set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.
pnpm db:up                 # private local database config + container on 127.0.0.1:55432
pnpm db:setup              # databases, roles, migrations, synthetic members M1001–M1004
pnpm automation:configure  # generates the local automation API token
```

Secrets live only in ignored `.env` files under `apps/automation/` and `apps/demo-api/` and in `.env.database`. [Database guide](docs/DATABASE.md) · [Browserbase guide](docs/BROWSERBASE_SETUP.md).

## Checks without live services

```sh
pnpm check      # typecheck, 258 unit/contract tests, production builds — no keys, database or network
pnpm check:db   # the above plus 42 PostgreSQL integration tests (Docker running, after setup)
```

The unit tests drive the real workflow worker, executor, rule engine and coordinator against injected fake browser surfaces and planners, and the real Stagehand launch path against a fake transport. They check behavior and safety properties; they are **not** evidence of a genuine discovery. That evidence is in [evidence/](evidence/README.md).

## Demo: goal → discovery → saved capability → replay

Start the portal and a tunnel, each in its own terminal:

```sh
pnpm demo:serve                                                # portal on http://127.0.0.1:3002
cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate  # prints https://<random>.trycloudflare.com
```

Then, in a third terminal, with the printed HTTPS root (keep the trailing slash):

```sh
pnpm automation:reconcile   # clears any leftover session hold from an interrupted run
BROWSERBASE_PORTAL_URL=https://<random>.trycloudflare.com/ pnpm demo:e2e
```

`demo:e2e` runs three steps, each in a fresh automation API process and browser session:

1. **Discovery.** It sends the goal in [examples/discovery-current.json](examples/discovery-current.json) ("Find the current balance and currency of the member's active primary savings account…", member `M1001`) with its typed output contract. The model observes the live portal and chooses each action, and the system saves a capability once the outputs are verified.
2. **Replay** of that exact capability version for `M1002`, with model inference refused.
3. **Exceptional replay** of the same version for `M9999`, a member the portal does not have. Expected result: the business outcome `MEMBER_NOT_FOUND`.

Expected output: discovery returns `currentBalanceMinor: 125034` ($1,250.34) for M1001, replay returns `8765` ($87.65) for M1002, and the third run returns `{"kind":"business_outcome","code":"MEMBER_NOT_FOUND"}`. Both replays report zero model calls. Run records go to the ignored `apps/automation/runtime/demo/<version>/` (`request`, `discovery`, `capability`, `replay`, `replay-not-found`, `summary`). [evidence/](evidence/README.md) contains one such run.

Other goals use the same command. `--request examples/discovery-available.json` asks for the available balance instead; the same code selects a different UI field and saves a different capability. Write a new request file to change the goal, output names or account criteria ([contract guide](docs/GOAL_OUTPUTS.md)). `--replay-member` and `--missing-member` change the replay inputs.

### Calling the API directly

The automation API (`pnpm dev:automation`, port 3001) is what an agent would call. Requests need `Authorization: Bearer <AUTOMATION_API_TOKEN>` and an `Idempotency-Key`. The target's `entryPoint` and allowed origin must point at the tunnel; `demo:e2e` writes such a configuration for you, and [docs/RUNTIME.md](docs/RUNTIME.md) explains how to supply your own.

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

Also: `GET /v1/runs/:id/events` (the structured log), `GET /v1/capabilities/:id/versions/:version` (the artifact), `GET /v1/runs/:id/evidence/:evidenceId` (failure snapshots), and `POST /v1/runs/:id/cancel`. [API and runtime limits](docs/RUNTIME.md).

## Error, outcome and safety demos

With the portal and tunnel running:

| Command | What it shows |
| --- | --- |
| `pnpm scenario:check` | 19 live runtime conditions against one saved capability: not-found / no-primary-savings / access-denied outcomes, slow loads, dismissible notices, retried inquiries, exhausted recovery, validation errors, wrong member or account, duplicates, conflicting signals, lost browser, unexpected dialog, expired session. Needs an earlier discovery in the database. [Guide](docs/SCENARIOS.md) |
| `pnpm safety:demo` | A provider refusal at session start, the risky Close account control blocked before dispatch, discovery with instructions embedded in the page, and a hard identity-mismatch failure with its expected/observed diagnosis. [Guide](docs/SAFETY.md) |
| `pnpm goal:demo` | Current and available balance discovered by the same code into two different capabilities, each replayed for another member. [Guide](docs/GOAL_OUTPUTS.md) |

`pnpm demo:scenario <name>` switches the portal into a single scenario for manual exploration (`--list` shows them; `baseline` restores normal behavior).

## Human handoff walkthrough

```sh
pnpm dev:operator   # operator page on http://127.0.0.1:5173 (portal and tunnel still running)
BROWSERBASE_PORTAL_URL=https://<random>.trycloudflare.com/ pnpm handoff:demo
```

The demo puts the portal into scenarios that automation will not resolve on its own. It runs a discovery that pauses at a servicing-review dialog, then a replay that pauses at an expired staff session; either may pause more than once. Each pause prints a run ID. On the operator page:

1. Enter the **automation API token** (not the Browserbase key) and the run ID. The page shows the goal or capability, the controller and revision, the step, the reason, the checkpoint and the current screen.
2. **Claim** the intervention. Automation is now paused and the operator owns the same live browser.
3. Perform the action, for example **Dismiss servicing review** or **Restore staff session**. The click runs in that browser and is recorded as a human event.
4. **Validate and resume.** The system checks the recorded checkpoint and member/account identity, then returns control to automation, which finishes the run.

[Full walkthrough, control model and limits](docs/HANDOFF.md) · [Evidence of a real handoff](evidence/int-014-015/README.md).

## Stopping safely

- **Ctrl+C** in a demo terminal stops it. Verifiers cancel their active run, close the hosted browser, stop their API processes and reset the portal scenario to `baseline`.
- If a run was interrupted mid-session, `pnpm automation:reconcile` closes or expires its provider session before the next run is admitted. One run holds the session slot at a time.
- Stop the tunnel and `demo:serve` with Ctrl+C. `pnpm db:down` stops the database but keeps its volume.
- Run records under `apps/automation/runtime/` are ignored by Git. Failure snapshots expire from the API after 24 hours.

## Repository layout

```text
apps/automation/   Automation API: coordinator, executor, discovery worker, replay, rules, Browserbase adapter
apps/operator/     Operator page for interventions (React + Mantine)
apps/demo-api/     The target portal's backend and scenario harness (Express + PostgreSQL)
apps/demo-web/     The target portal's staff UI (React + Mantine)
packages/contracts Public schemas: capability artifact, run requests/results, output contracts
packages/postgres  Connection, transaction and migration helpers
scripts/           Database tooling and the live demos/verifiers
tests/             Unit/contract tests; tests/database/ holds the PostgreSQL suite
examples/          Example discovery requests and an example capability contract
evidence/          Curated real-run evidence
docs/              Supporting guides, design and plan
```

## Documentation

| Topic | Document |
| --- | --- |
| Full system design (requirements, data model, API, deep dives) | [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) |
| Artifact and run contracts | [docs/CONTRACTS.md](docs/CONTRACTS.md) |
| Goal and output contracts | [docs/GOAL_OUTPUTS.md](docs/GOAL_OUTPUTS.md) |
| Discovery and replay workflow | [docs/WORKFLOWS.md](docs/WORKFLOWS.md) |
| Runtime conditions, rules and recovery | [docs/SCENARIOS.md](docs/SCENARIOS.md) |
| Human handoff | [docs/HANDOFF.md](docs/HANDOFF.md) |
| Safety policy, data handling and diagnostics | [docs/SAFETY.md](docs/SAFETY.md) |
| API, runtime configuration and limits | [docs/RUNTIME.md](docs/RUNTIME.md) |
| Portal, database, Browserbase setup | [docs/PORTAL.md](docs/PORTAL.md), [docs/DATABASE.md](docs/DATABASE.md), [docs/BROWSERBASE_SETUP.md](docs/BROWSERBASE_SETUP.md) |
| Stack choices and SDK compatibility | [docs/STACK.md](docs/STACK.md), [docs/SDK_COMPATIBILITY.md](docs/SDK_COMPATIBILITY.md) |
| Plan, acceptance checklist, milestone history | [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md), [docs/VERIFICATION_HISTORY.md](docs/VERIFICATION_HISTORY.md) |
