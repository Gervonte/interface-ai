# Interface AI — Computer-use automation

A TypeScript workspace for the computer-use automation assessment. INT-001 provides independent app shells and public health/error contracts. INT-002 adds a synthetic compatibility fixture and a verified Browserbase connection check. Discovery, replay, the complete staff portal, and PostgreSQL persistence remain later tasks.

## Requirements

- Node.js **26.2.0** (`nvm install` and `nvm use` read `.nvmrc`).
- pnpm **10.32.1**. Use your existing pnpm installation, or install that exact version with `npm install --global pnpm@10.32.1`.

The root `packageManager`, engine constraints, exact dependency catalog, and committed lockfile define the verified toolchain. Stagehand is pinned and initialized only by the explicit Browserbase check; normal app startup does not open hosted sessions.

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

Each frontend proxies `/api/*` to its own backend; run the matching API to see its connected status. Ports are strict so the frontends do not silently move when a port is occupied. An individual command builds public contracts first. Restart it after changing the shared contracts; continuous rebuilding of shared packages is not configured yet.

## Configuration and data boundaries

The scaffold runs **without API keys, PostgreSQL, or live services**. Optional `.env.example` files live in the backend app directories. Copy one to `.env` in that same directory to override HOST/PORT; it is loaded by Node from that app's working directory. If API ports change, update the corresponding Vite proxy target as well.

Browserbase credentials and fixture connectivity are documented in [BROWSERBASE_SETUP.md](BROWSERBASE_SETUP.md). The explicit `pnpm browserbase:check` command opens one hosted session; `pnpm dev:fixture` serves its separate synthetic-only target on port 3003. Do not place secrets in frontend `VITE_*` variables or shared public contracts. `.env` files, runtime storage, browser profiles, captures, and build output stay ignored. Curated sanitized evidence will live separately under `evidence/` in later tasks.

The demo app has its own backend. Automation imports only public transport schemas; it has no access to target fixtures or business database credentials. Later PostgreSQL setup will provision separate application databases/roles.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
# Or all three:
pnpm check
```

Vitest runs real HTTP integration checks for independent service identity, safe errors, and the synthetic fixture boundary. Injected-provider tests cover connection cleanup, termination verification, API health, and configuration validation. These tests are not discovery or replay evidence. Tests use ephemeral loopback ports and need no live service credentials. Builds run in workspace dependency order; both frontends output `dist/`, and APIs output runnable server modules.

After building, start one backend with `pnpm --filter @interface-ai/automation start` or `pnpm --filter @interface-ai/demo-api start`. Built frontend deployment/proxying is not configured in INT-001; Vite development URLs are local previews. INT-002 uses a separate fixture-only server and temporary tunnel for Browserbase access; see [setup](BROWSERBASE_SETUP.md).

## Workspace

```text
apps/
  automation/       Express automation API; later coordinator/Browserbase adapter
  operator/         React + Vite + Mantine operator UI
  demo-api/         Independent Express target backend
  demo-web/         React + Vite + Mantine target UI
packages/
  contracts/        Public Zod schemas/types only
tests/              Service/fixture HTTP checks and provider lifecycle tests
```

## Planning documents

- [Implementation plan](IMPLEMENTATION_PLAN.md)
- [Acceptance checklist](ACCEPTANCE.md)
- [System design](SYSTEM_DESIGN.md)
- [Stack decisions](STACK.md)
- [Demo workflows](DEMO_WORKFLOW.md)

The genuine goal → discovery → artifact → replay commands and assessment evidence will be added when those features exist (INT-009–INT-011). No paid session is opened by these setup commands.

## INT-001 verification

Verified with the pinned Node/pnpm versions on 2026-11-16: workspace typechecking (including test/config files), six real HTTP integration tests, and production builds of both APIs and both frontends. The root development command starts all four processes; both browser pages report their own API connected. This is scaffold verification only; remaining assessment criteria are not marked complete.

## INT-002 verification

Verified on 2026-11-16: a real hosted Browserbase session loaded the staff-shell/iframe/table fixture, passed 27 concurrent automation API health checks (maximum 24 ms), and terminated with confirmed `COMPLETED` status. `pnpm check` passes typechecking, 33 tests, and all builds. [Setup and start/stop commands](BROWSERBASE_SETUP.md); [sanitized live evidence](evidence/int-002/README.md). Model inference and same-session takeover remain INT-003; the complete portal remains INT-006.
