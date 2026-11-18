# PostgreSQL persistence (INT-005)

The workspace uses **PostgreSQL 18.7**, the pinned official Bookworm image, **pg 8.23.1**, and explicit SQL migrations. The image digest is recorded in [compose.database.yaml](compose.database.yaml); dependency versions are in the workspace catalog and lockfile. The shared `@interface-ai/postgres` package contains connection, transaction, and migration helpers only. Target business data stays in the demo app.

## Start and initialize

Install workspace dependencies and start Docker Desktop, then run from the repo root:

```sh
pnpm db:up
pnpm db:setup
```

`db:up` creates an ignored `.env.database` with independent random local secrets and starts the project container at **127.0.0.1:55432**. It adds only the automation runtime URL/fingerprint key to `apps/automation/.env` and only the demo runtime URL to `apps/demo-api/.env`. Existing Browserbase settings are preserved. An existing nonempty, conflicting application setting causes a failure rather than being replaced. Private files are written with mode 0600; credentials are never printed or committed.

`.env.database` is used only by setup/migration/test tooling. It contains the local admin, migrator, and runtime-role credentials plus the fingerprint key. Keep this file with the persistent development volume; generating different secrets does not reset an existing PostgreSQL volume or safely rotate receipt fingerprints. Neither runtime app receives the other app's URL or the administrative/migration credentials.

`db:setup` creates the isolated databases and roles, applies migrations, grants runtime permissions, and resets the four synthetic baseline members and their accounts. Repeating setup preserves automation history, verifies existing role/database ownership, applies only new migrations, and resets those known demo fixture records. It does not adopt an existing database with another owner or change existing role passwords.

## Commands

| Command | Effect |
| --- | --- |
| `pnpm db:up` | Initialize local private configuration and start the pinned container; wait for its health check |
| `pnpm db:setup` | Provision roles/databases, migrate, grant runtime access, and seed/reset baseline demo data |
| `pnpm db:migrate` | Apply new migrations to both existing databases and refresh runtime grants; does not reset fixtures |
| `pnpm db:reset-demo` | Transactionally restore only the known synthetic baseline members/accounts |
| `pnpm test:db` | Run the real database integration suite in new, uniquely named test databases |
| `pnpm check:db` | Run normal typecheck/tests/builds, then the real PostgreSQL suite |
| `pnpm db:down` | Stop/remove the project container and network while preserving its data volume |

The normal `pnpm check` remains independent of Docker. Database tests are explicitly separate; `test:db` fails if configuration/PostgreSQL is unavailable. The suite creates `interface_test_<random>_*` databases and four test-only roles, then removes those exact resources. It does not clear the development databases. There is no command here to delete the development volume or reset automation history.

## Database and role boundaries

| Database / schema | Runtime role | Permissions |
| --- | --- | --- |
| `interface_ai_automation` / `automation` | `interface_ai_automation_app` | Read/insert capability versions and events; read/insert/update runs, interventions, and receipts |
| `interface_ai_demo` / `demo` | `interface_ai_demo_app` | Read baseline members/accounts and fixture version; no direct writes |

Each database has a separate `*_migrator` owner used only by tooling. All four component roles lack superuser, database-creation, role-creation, and replication privileges. PUBLIC database access is revoked; runtime roles receive CONNECT only to their own database and no CREATE in the public schema. Runtime roles do not own the application schema or tables and cannot switch into the other app's role. Demo write permissions for the later contact workflow require an explicit later migration/grant.

The bootstrap superuser is limited to this dedicated development cluster and is never used by either runtime repository. The Docker port is loopback-only. This is reproducible local infrastructure, not production credential provisioning or backup management. See [PostgreSQL privileges](https://www.postgresql.org/docs/18/ddl-priv.html).

## Migrations and constraints

Migrations live in `apps/automation/migrations` and `apps/demo-api/migrations`. Each component stores its applied filename and SHA-256 checksum in its own `schema_migrations` table. An advisory transaction lock serializes migration attempts. Schema changes and history insertion commit together; a failed migration rolls back its DDL. An applied file whose content changed, or an applied migration absent from the supplied history, fails validation. Add new forward migrations instead of rewriting applied files.

The automation schema contains the four domain tables and one supporting table:

- **`runs`:** exact capability/config references, pinned non-secret configuration snapshots/checksums, session/control/lifecycle fields, input binding names, safe result, and transactional event counter. Raw goals and invocation values are not persisted.
- **`capabilities`:** immutable JSONB format-v1 artifacts, composite `(capability_id, version)` key, and a unique source discovery run. A deferred constraint requires publication to commit with a completed successful source discovery and matching capability reference. Runtime UPDATE/DELETE privileges are absent; a trigger also prevents owner-level row updates/deletes.
- **`interventions`:** same-run/session references and a partial unique index allowing at most one open/claimed/validating intervention per run. A run's active-intervention reference must belong to that run.
- **`run_events`:** append-only runtime permissions, per-run sequence uniqueness, safe structured details, actor category, and optional intervention reference. Event insertion increments the run counter in the same transaction, so failed writes do not consume a sequence.
- **`request_receipts`:** protected request identity/fingerprint, key version/identifier, state, safe resource reference, and finite retry window. A unique principal/scope/key-digest tuple prevents duplicate acceptance.

There is a partial unique index for one nonterminal run. It reserves database admission, not browser ownership: later coordinator logic must still account for in-flight UI actions, provider cleanup, and restart reconciliation before releasing admission. Session references cannot be silently replaced once assigned. Run identity/configuration and terminal outcomes are protected against rewriting.

Target/policy definitions are versioned, non-secret JSON files in `apps/automation/config`. Every accepted run retains the validated content and checksum alongside its ID/version references; edits to a file cannot change a past run's interpretation. No target/policy catalog table is introduced. The retained initial target points at the local Vite portal URL. INT-006 verifies the built portal through a temporary target-only tunnel; INT-007 onward must bind an appropriate reachable target and enforce policy before real automation execution. Do not overwrite retained configuration versions with expired tunnel URLs.

## Repository transaction boundaries

`AutomationRepository.acceptRun` validates the request and pinned target/policy, then commits the pending run, receipt, initial event, and single-run reservation together. Existing receipts are checked before new-run capacity. An identical retry returns the original references; a changed payload using the same key raises `IDEMPOTENCY_KEY_REUSED`. Replay also validates the exact saved capability version, target compatibility, and actual invocation values.

Receipt keys and validated canonical payloads use separate HMAC domains with a persisted private server key. The database stores digests, key version, and a non-secret key identifier, not the raw key/body/response. A changed or unavailable key fails closed against retained receipts rather than silently accepting old requests as new work. Rotation is not implemented. The initial retry window is **24 hours**; active runs remain deduplicated past that deadline, and a retained expired receipt for terminal work raises `IDEMPOTENCY_WINDOW_EXPIRED`. No receipt purge is implemented here.

`publishCapability` validates the artifact and actual output values, checks input names and pinned target compatibility, and checks source events for confirmed reads/actions with the expected actor. Manual contributions must match the recorded intervention. It commits the immutable artifact, successful run result, and completion event together. Transient outputs are validated then omitted from storage with `not_retained`; explicit synthetic retention is allowed only for the demo application family. This database validation does not prove the meaning of UI actions; INT-008 must construct/verify the artifact from actual execution history.

Transactions use a single checked-out pg client with BEGIN/COMMIT/ROLLBACK and unconditional release. Browser/model/filesystem operations do not occur inside repository transactions. Connection/statement/query waits are finite. See [node-postgres transaction guidance](https://node-postgres.com/features/transactions).

These are callable persistence methods, not new HTTP routes. Authentication, raw JSON duplicate-key rejection, HTTP error mapping, and API idempotency enforcement are INT-008 work. The APIs start independently; their health endpoints do not claim database readiness. INT-006 target workflow routes use the demo repository and return safe service errors when unavailable.

## Synthetic seed and target repository

Fixture version 1 creates M1001–M1004, with coherent account foreign keys and at most one primary savings account per member. M1001's savings has current balance 125034 and available balance 120034 minor units; M1002's reordered savings row has current 8765 and available 7600. M1003 has only checking; M1004 exists with account access denied; M9999 is absent. Names are explicitly synthetic.

`DemoRepository` uses parameterized member/account queries, preserves deterministic account ordering, distinguishes member existence/access, and converts PostgreSQL bigint balances into checked safe integer minor units. Seeding/reset uses the demo migrator role and one transaction. Automation never imports the seed or receives its database credentials. Test/setup code may provision/reset fixtures independently of the UI-only execution path. INT-006 connects this repository to the staff portal through its independent target API; see [PORTAL.md](PORTAL.md).

## Verification

Verified on 2026-11-17 against the pinned PostgreSQL 18.7 container:

- Both development databases migrated from empty state and seeded successfully; a second migration run applied zero changes.
- `pnpm check` passed typechecking, 106 default tests, and all package/application builds.
- `pnpm test:db` passed 12 real database tests. The suite checks migration history/DDL rollback, concurrent request deduplication and receipt uniqueness, raw-value exclusion, fingerprint-key mismatch/expiry, atomic acceptance/publication rollback, concurrent event sequencing, exact version persistence across new connections, immutable records/configuration/session identity, source provenance, deterministic seed resets, and cross-database/role/DDL/write denials.
- PostgreSQL reported `fsync=on` and `synchronous_commit=on`. Runtime privileges were tested with actual separate connections, not mocked authorization checks.

Database tests and synthetic records are persistence evidence only. They are not live model discovery or deterministic UI replay evidence, and do not mark the broader assessment criteria complete.
