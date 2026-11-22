# Verification history

Milestone-by-milestone verification notes, moved here from the README. They record what was checked at each point and are not updated as later work changed the system; current behavior is described in the [README](../README.md) and [REPORT](../REPORT.md), and current evidence starts at [evidence/README.md](../evidence/README.md).

### INT-001 verification

Verified with the pinned Node/pnpm versions on 2026-11-16: workspace typechecking (including test/config files), six real HTTP integration tests, and production builds of both APIs and both frontends. The root development command starts all four processes; both browser pages report their own API connected. This is scaffold verification only; remaining assessment criteria are not marked complete.

### INT-002 verification

Verified on 2026-11-16: a real hosted Browserbase session loaded the staff-shell/iframe/table fixture, passed 27 concurrent automation API health checks (maximum 24 ms), and terminated with confirmed `COMPLETED` status. `pnpm check` passes typechecking, 33 tests, and all builds. [Setup and start/stop commands](BROWSERBASE_SETUP.md); [sanitized live evidence](../evidence/int-002/README.md). Model inference and same-session takeover on this fixture are verified separately in INT-003; the complete portal remains INT-006.

### INT-003 verification

Verified on 2026-11-16 (America/New_York): genuine Gateway action proposals, serialized action execution with changed input and inference forbidden, semantic targeting across reordered rows, actual user takeover and validated hand-back in the same session, synthetic failure captures, and confirmed session termination. `pnpm check` passes typechecking, 51 tests, and all builds. Run the temporary local operator tool with `pnpm browserbase:spike` after starting the fixture/tunnel. [Steps and adapter decisions](SDK_COMPATIBILITY.md); [curated live evidence](../evidence/int-003/README.md). This is SDK compatibility verification; the final artifact executor, coordinator, and assessment workflow remain later tasks.

### INT-004 verification

Verified on 2026-11-17: typed public requests/results/control, versioned capability structure and semantic reference checks, actual embedded input/output validation, scoped targets/conditions/extractions, authored outcome/recovery rules, and manual-contribution representations. `pnpm check` passes typechecking, 106 tests, and all builds. [Format, usage, and finite defaults](CONTRACTS.md); [authored balance contract fixture](../examples/README.md). Persistence is implemented separately in INT-005; HTTP run endpoints, real discovery artifact construction, and the interpreter remain later work.

### INT-005 verification

Verified on 2026-11-17: both PostgreSQL databases migrated from empty state, synthetic baseline seeds reset predictably, and a repeated migration applied zero changes. `pnpm check:db` passes typechecking, 106 default tests, 12 real PostgreSQL integration tests, and all builds. The database suite verifies isolation, SQL constraints, concurrent receipts/events, transaction rollback, immutable exact versions/configuration, and retained source provenance. [Setup and schema details](DATABASE.md). This is persistence verification; the connected staff portal is INT-006 and run orchestration remains later work.

### INT-006 verification

The PostgreSQL-backed staff shell and servicing iframe implement Member Search, Member Overview, Account Inquiry, and Account Details. Member/account identities, statuses, designation, currency, and distinct balance fields remain visible. Back/new-search/Clear and late-response handling prevent stale member data. `pnpm check:db` passes typechecking, 113 default tests, 13 real database tests, and all builds. A real Browserbase UI check verified M1001/M1002, reordered repeated Open controls, negative states, zero inference, and confirmed session termination. [Portal walkthrough/setup](PORTAL.md); [curated evidence](../evidence/int-006/README.md). Full discovery/executor/coordinator behavior remains later work.

To use only the target after database setup:

```sh
pnpm demo:serve
```

Open http://127.0.0.1:3002. To verify hosted reachability, follow the target-only tunnel and `pnpm browserbase:portal-check` instructions in [PORTAL.md](PORTAL.md#browserbase-verification).

### INT-007/008 verification

`pnpm check:db` passes typechecking, 147 default tests, 24 real PostgreSQL tests and all builds. The real shared executor traversed both members through Browserbase, verified identity/current/available balances, then deliberately failed on ambiguous Open controls with no dispatch and a sanitized structural snapshot. Inference counters stayed zero and provider termination was confirmed. API tests cover authorization, asynchronous acceptance/deduplication, cancellation, exact versions, transient outputs, singleton ownership and real process death with blocked session reconciliation. [Commands/API/limits](RUNTIME.md); [curated hosted evidence](../evidence/int-007-008/README.md).

After `pnpm db:migrate`, run `pnpm automation:configure` once, then `pnpm dev:automation`. In a second terminal, `pnpm automation:smoke` checks the initial API without displaying its token. `DISCOVERY_NOT_IMPLEMENTED` was the INT-008 milestone result; the current configured worker performs the balance discovery/replay profile. Stop the API before using `pnpm executor:check` or `pnpm automation:reconcile`, since they acquire the same coordinator lock.

### Safety policy and diagnostics (INT-016)

Policy v5 blocks declared risky controls (such as the portal's Close account button) before dispatch on every path, page text cannot reach the planner, synthetic sensitive markers stay out of storage, events and evidence, and failures name the condition that actually failed. `pnpm safety:demo` reruns the live checks. See the [safety guide](SAFETY.md) and [INT-016 evidence](../evidence/int-016/README.md).

### Requested goal outputs (INT-023)

New discovery bodies include an explicit output contract. See [typed request examples and current/available verification](GOAL_OUTPUTS.md); `pnpm goal:demo` runs both real discoveries and their exact-artifact, changed-input replays. Existing replay request shapes and saved artifacts remain valid. Live current and available balance discoveries and their model-free M1002 replays are verified. [INT-023 evidence](../evidence/int-023/README.md).
