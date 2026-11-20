# Interface AI — Computer-use automation

A TypeScript workspace for the computer-use automation assessment, with a PostgreSQL-backed synthetic credit-union staff portal and separate automation/operator applications.

Implemented through INT-013: typed capability/run contracts, isolated persistence, the staff portal, a policy-checked executor, authenticated run APIs, live model-driven balance discovery, and saved-capability replay in a separate process with inference forbidden. Repeatable portal scenarios, declared business outcomes, bounded recovery, and safe escalation are implemented. Operator claim/manual actions/hand-back remain INT-014/015. [Portal setup](PORTAL.md) · [Runtime/API limits](RUNTIME.md) · [Discovery/replay guide and evidence](WORKFLOWS.md) · [Scenario and recovery guide](SCENARIOS.md).


## Requirements

- Node.js **26.2.0** (`nvm install` and `nvm use` read `.nvmrc`).
- pnpm **10.32.1**. Use your existing pnpm installation, or install that exact version with `npm install --global pnpm@10.32.1`.
- Docker Desktop with Compose for the local PostgreSQL setup and database integration tests; the shell apps/default tests still run independently.

The root `packageManager`, engine constraints, exact dependency catalog, and committed lockfile define the verified toolchain. Stagehand is pinned. Normal startup opens no hosted session. Accepted supported discovery/replay requests and explicit Browserbase checks use hosted browsers; discovery also makes model calls.

## Install and run

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` builds public contracts, starts both Express APIs and both Vite frontends, and stops the group if any child exits. Ctrl+C stops the app group. All servers bind to loopback for local development.

| App | Address | Independent command |
| --- | --- | --- |
| Automation API | http://127.0.0.1:3001/healthz | `pnpm dev:automation` |
| Operator UI | http://127.0.0.1:5173 | `pnpm dev:operator` |
| Demo API | http://127.0.0.1:3002/healthz | `pnpm dev:demo-api` |
| Demo UI | http://127.0.0.1:5174 | `pnpm dev:demo-web` |

Each frontend proxies `/api/*` to its own backend; run the matching API to use the UI. The staff portal also needs the demo database setup below. Ports are strict so the frontends do not silently move when a port is occupied. An individual command builds public contracts first. Restart it after changing the shared contracts; continuous rebuilding of shared packages is not configured yet.

## Configuration and data boundaries

Health endpoints, the operator shell, and default tests run **without API keys or PostgreSQL**. The connected staff portal requires its separate PostgreSQL database. Optional `.env.example` files live in the backend app directories. Copy one to `.env` in that same directory to override HOST/PORT; it is loaded by Node from that app's working directory. If API ports change, update the corresponding Vite proxy target as well.

Browserbase credentials and fixture connectivity are documented in [BROWSERBASE_SETUP.md](BROWSERBASE_SETUP.md). The explicit `pnpm browserbase:check` command opens one hosted session; `pnpm dev:fixture` serves its separate synthetic-only target on port 3003. Do not place secrets in frontend `VITE_*` variables or shared public contracts. `.env` files, runtime storage, browser profiles, captures, and build output stay ignored. Curated synthetic verification evidence lives under `evidence/`; private runtime output remains ignored.

The demo app has its own backend. Automation imports only public transport schemas; it has no access to target fixtures or business database credentials. INT-005 provisions separate application databases and least-privilege roles. See [DATABASE.md](DATABASE.md) for setup, migration, seed/reset, and shutdown commands. The staff portal uses the demo repository through its own target API. The automation run API now executes the supported balance discovery/replay profile; see [WORKFLOWS.md](WORKFLOWS.md).

## Local PostgreSQL

With Docker Desktop running:

```sh
pnpm db:up
pnpm db:setup
pnpm check:db
```

PostgreSQL binds only to `127.0.0.1:55432`. Setup creates private ignored configuration and separate automation/demo databases. `pnpm db:down` stops the project container while retaining its volume. [Full database guide](DATABASE.md).

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
# Or all three:
pnpm check
```

Vitest runs HTTP, executor, transport and contract checks. The explicit database suite also verifies authenticated run coordination and actual process-death recovery. Injected-provider tests cover connection cleanup, termination verification, API health, and configuration validation. These tests are not discovery or replay evidence. Tests use ephemeral loopback ports and need no live service credentials. Builds run in workspace dependency order; both frontends output `dist/`, and APIs output runnable server modules.

After building, start one backend with `pnpm --filter @interface-ai/automation start` or `pnpm --filter @interface-ai/demo-api start`. Use `pnpm demo:serve` to build and serve the complete target UI/API at http://127.0.0.1:3002. The operator UI still uses its Vite development preview. INT-002 uses a separate fixture-only server and temporary tunnel for Browserbase access; see [setup](BROWSERBASE_SETUP.md).

## Real discovery and changed-input replay

After configuring credentials/database and stopping any automation API/watcher:

```sh
pnpm db:up
pnpm db:migrate
pnpm db:reset-demo
pnpm automation:configure
pnpm demo:serve
# In another terminal:
cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate
# In a third terminal, use the printed current HTTPS root:
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm workflow:demo
```

This performs real model-driven discovery for M1001, exports the actual capability, restarts the API in another process, and replays that exact saved version for M1002 with a rejecting model callback. Expected balances are $1,250.34 and $87.65; replay must report zero inference. The command writes private ignored reports and closes its browser/API processes. Stop the target and tunnel afterward. [Full setup, data boundary, limits, and troubleshooting](WORKFLOWS.md) · [Real capability and run logs](evidence/int-009-011/README.md).

## Scenario and recovery checks

After a successful persisted balance discovery, with the portal and its current tunnel running and other automation coordinators stopped:

```sh
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm scenario:check
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm scenario:controls
```

The first command publishes an immutable authored-rule revision and exercises 19 live cases with zero inference. The second is separate target-control UI QA for restoration/dismissal in the same browser; actual operator takeover follows in INT-014/015. Use `pnpm demo:scenario --list` for setup names and `pnpm demo:scenario baseline` to reset the next staff session. [Setup, scenario table, limits, and verifier resume](SCENARIOS.md) · [Curated live evidence](evidence/int-012-013/README.md).

## Workspace

```text
apps/
  automation/       Express automation API; later coordinator/Browserbase adapter
  operator/         React + Vite + Mantine operator UI
  demo-api/         Independent Express target backend
  demo-web/         React + Vite + Mantine target UI
packages/
  contracts/        Public Zod schemas/types and constrained capability/data validation
  postgres/         Shared connection/transaction/migration helpers; no business fixtures
scripts/            Local database provisioning/migration/seed tooling
tests/              HTTP/provider/contracts tests; separate real PostgreSQL suite
```

## Planning documents

- [Implementation plan](IMPLEMENTATION_PLAN.md)
- [Acceptance checklist](ACCEPTANCE.md)
- [System design](SYSTEM_DESIGN.md)
- [Stack decisions](STACK.md)
- [Demo workflows](DEMO_WORKFLOW.md)

The genuine goal → discovery → artifact → replay commands and assessment evidence will be added when those features exist (INT-009–INT-011). Normal app/database setup does not open a paid session; explicit Browserbase check commands do.

## INT-001 verification

Verified with the pinned Node/pnpm versions on 2026-11-16: workspace typechecking (including test/config files), six real HTTP integration tests, and production builds of both APIs and both frontends. The root development command starts all four processes; both browser pages report their own API connected. This is scaffold verification only; remaining assessment criteria are not marked complete.

## INT-002 verification

Verified on 2026-11-16: a real hosted Browserbase session loaded the staff-shell/iframe/table fixture, passed 27 concurrent automation API health checks (maximum 24 ms), and terminated with confirmed `COMPLETED` status. `pnpm check` passes typechecking, 33 tests, and all builds. [Setup and start/stop commands](BROWSERBASE_SETUP.md); [sanitized live evidence](evidence/int-002/README.md). Model inference and same-session takeover on this fixture are verified separately in INT-003; the complete portal remains INT-006.

## INT-003 verification

Verified on 2026-11-16 (America/New_York): genuine Gateway action proposals, serialized action execution with changed input and inference forbidden, semantic targeting across reordered rows, actual user takeover and validated hand-back in the same session, synthetic failure captures, and confirmed session termination. `pnpm check` passes typechecking, 51 tests, and all builds. Run the temporary local operator tool with `pnpm browserbase:spike` after starting the fixture/tunnel. [Steps and adapter decisions](SDK_COMPATIBILITY.md); [curated live evidence](evidence/int-003/README.md). This is SDK compatibility verification; the final artifact executor, coordinator, and assessment workflow remain later tasks.

## INT-004 verification

Verified on 2026-11-17: typed public requests/results/control, versioned capability structure and semantic reference checks, actual embedded input/output validation, scoped targets/conditions/extractions, authored outcome/recovery rules, and manual-contribution representations. `pnpm check` passes typechecking, 106 tests, and all builds. [Format, usage, and finite defaults](CONTRACTS.md); [authored balance contract fixture](examples/README.md). Persistence is implemented separately in INT-005; HTTP run endpoints, real discovery artifact construction, and the interpreter remain later work.

## INT-005 verification

Verified on 2026-11-17: both PostgreSQL databases migrated from empty state, synthetic baseline seeds reset predictably, and a repeated migration applied zero changes. `pnpm check:db` passes typechecking, 106 default tests, 12 real PostgreSQL integration tests, and all builds. The database suite verifies isolation, SQL constraints, concurrent receipts/events, transaction rollback, immutable exact versions/configuration, and retained source provenance. [Setup and schema details](DATABASE.md). This is persistence verification; the connected staff portal is INT-006 and run orchestration remains later work.

## INT-006 verification

The PostgreSQL-backed staff shell and servicing iframe implement Member Search, Member Overview, Account Inquiry, and Account Details. Member/account identities, statuses, designation, currency, and distinct balance fields remain visible. Back/new-search/Clear and late-response handling prevent stale member data. `pnpm check:db` passes typechecking, 113 default tests, 13 real database tests, and all builds. A real Browserbase UI check verified M1001/M1002, reordered repeated Open controls, negative states, zero inference, and confirmed session termination. [Portal walkthrough/setup](PORTAL.md); [curated evidence](evidence/int-006/README.md). Full discovery/executor/coordinator behavior remains later work.

To use only the target after database setup:

```sh
pnpm demo:serve
```

Open http://127.0.0.1:3002. To verify hosted reachability, follow the target-only tunnel and `pnpm browserbase:portal-check` instructions in [PORTAL.md](PORTAL.md#browserbase-verification).

## INT-007/008 verification

`pnpm check:db` passes typechecking, 147 default tests, 24 real PostgreSQL tests and all builds. The real shared executor traversed both members through Browserbase, verified identity/current/available balances, then deliberately failed on ambiguous Open controls with no dispatch and a sanitized structural snapshot. Inference counters stayed zero and provider termination was confirmed. API tests cover authorization, asynchronous acceptance/deduplication, cancellation, exact versions, transient outputs, singleton ownership and real process death with blocked session reconciliation. [Commands/API/limits](RUNTIME.md); [curated hosted evidence](evidence/int-007-008/README.md).

After `pnpm db:migrate`, run `pnpm automation:configure` once, then `pnpm dev:automation`. In a second terminal, `pnpm automation:smoke` checks the initial API without displaying its token. `DISCOVERY_NOT_IMPLEMENTED` is the expected current worker result. Stop the API before using `pnpm executor:check` or `pnpm automation:reconcile`, since they acquire the same coordinator lock.
