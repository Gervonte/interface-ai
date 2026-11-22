# Stack and Delegation Decisions

Status: TypeScript, Express, Zod, PostgreSQL, React + Vite, Mantine, and Browserbase-first delivery are agreed. The product mapping below is implemented; the compatibility spike it depended on passed (INT-003). Current behavior and trade-offs are summarized in [REPORT.md](../REPORT.md). INT-001 supplies the pinned workspace and local app shells. INT-002 verifies hosted Browserbase connectivity to a temporary synthetic fixture; see [setup and selected configuration](BROWSERBASE_SETUP.md). INT-003 verifies real model proposals, inference-forbidden deterministic execution, and mediated same-session handoff on that fixture; see [SDK compatibility results](SDK_COMPATIBILITY.md). INT-005 implements PostgreSQL persistence and real isolation/transaction tests; see [DATABASE.md](DATABASE.md). INT-006 implements the connected staff portal and its hosted UI verification; see [PORTAL.md](PORTAL.md).

## Selected direction

- **Language:** TypeScript for all custom application code. Node.js for the backend/runtime. No Python component.
- **HTTP API:** Express, with TypeScript route handlers and explicit validation/error-handling middleware.
- **Runtime validation:** Zod for application-owned request, response, configuration, and artifact-envelope contracts.
- **Frontend:** React + TypeScript with Vite for the demo application and operator UI.
- **Component library:** Mantine for layouts, inputs, buttons, tables, dialogs, and status displays.
- **Database:** PostgreSQL. Prefer the database the user already knows; retain the initial single-coordinator/single-active-run design.
- **Browser platform:** Browserbase-hosted sessions.
- **Browser/AI SDK:** Stagehand TypeScript, using its current v4 interface as the documentation baseline. Pin and verify exact compatible package/runtime versions during setup.
- **Discovery inference:** Browserbase Model Gateway through Stagehand. INT-002 selects `openai/gpt-5`; INT-003 verifies actual Gateway inference and usage on the synthetic compatibility fixture. Genuine end-to-end discovery evidence remains later work.
- **Custom TypeScript:** only the application contracts, coordination, checks, persistence, UI, and behavior that the delegated products do not satisfy.

## Express and Zod integration

Express provides the HTTP routing/middleware layer around our coordinator. Zod validates incoming bodies, parameters, and supported command/action shapes before application logic executes. Define shared contracts and derive TypeScript types from them where practical; TypeScript annotations alone do not validate runtime input.

Map validation failures into the existing API error contract: malformed request shape returns `400`; well-formed invocation values that fail a capability's declared input contract return `422`. Use centralized error handling and safe response construction so raw bodies or value-bearing validation errors do not leak into logs or responses. Express route handlers invoke the coordinator; long UI workflows run outside the request lifecycle.

Saved artifacts remain serializable data. Do not store Zod functions in the artifact or assume that parsing an artifact's envelope also validates values against its embedded input/output schemas. INT-004 implements the constrained serializable schema and runtime value validation; see [CONTRACTS.md](CONTRACTS.md). Arbitrary evaluation of uploaded schema/code is prohibited.

## React, Vite, and Mantine UI

Use React + Vite and Mantine in both frontends. Start with `@mantine/core` and `@mantine/hooks`; add `@mantine/form` if needed for the search/contact and run-submission forms. Follow the compatible Vite/PostCSS setup, import installed package styles, and initialize `MantineProvider` at each application root. Pin compatible versions during setup. See [Mantine's Vite guide](https://mantine.dev/guides/vite/) and [form documentation](https://mantine.dev/form/use-form/).

Share a small theme where useful while keeping the target app and automation UI separate applications. The target presents member/account/contact workflows; the operator UI presents run status, evidence, and takeover controls. Component reuse must not expose target fixture state or business database access to the automation.

Preserve normal user-visible labels, semantic tables, dialog names, and keyboard behavior. Do not build locators around Mantine-generated IDs/classes or internal markup. The planned framed workspace, repeated row controls, exceptional states, and identity checks still exercise the automation; library choice does not establish selector robustness or accessibility by itself.

Zod remains the server-side contract validator. Frontend form validation improves feedback but does not replace server validation. UI schemas, where shared, must contain only public contract information.

## PostgreSQL storage boundary

Use PostgreSQL for the automation records: capabilities, runs, interventions, events, and request receipts. Keep the demo application's synthetic members, accounts, and contact changes in a separate database with a separate application role. Both databases can share one PostgreSQL instance for development.

Only the demo app receives its business-data connection credentials; the automation process receives access to its own records and operates the demo through the UI. A test/setup tool can seed/reset target fixtures, but that credential/path is not exposed to discovery or replay. This preserves a realistic application boundary while keeping local setup small.

INT-005 uses pg 8.23.1, explicit checksummed SQL migrations, bounded pools, and single-client transactions on the pinned PostgreSQL 18.7 Docker image. Runtime roles cannot cross databases; migrator/admin credentials stay in local tooling. Per-run immutable configuration snapshots retain the selected target/policy versions. See [DATABASE.md](DATABASE.md). These database guarantees do not establish browser ownership or exactly-once UI effects.

## Responsibility split

| Concern | Delegate | Our TypeScript responsibility |
| --- | --- | --- |
| Browser provisioning/lifetime | Browserbase Sessions | Store provider reference; configure limits; reconcile session loss/cleanup. |
| AI interpretation of the current UI | Stagehand discovery primitives | Supply the goal/context, bound the loop, inspect proposals, enforce policy before mutation. |
| Model access | Browserbase Model Gateway | Choose/pin configuration and capture safe usage/evidence. |
| UI action execution | Stagehand supported deterministic methods | Bind typed inputs, resolve/verify targets, check ownership, record actions/results. |
| Live session visibility | Browserbase Live View and supported SDK observations | Authorize operator access; provide mediated control where provider interaction does not meet ownership/action-capture rules. |
| Recordings and browser diagnostics | Browserbase where enabled and appropriate for synthetic data | Correlate, sanitize/export required evidence; retain structured application decisions/results. |
| Saved capability | Provider action descriptors as construction inputs | Own versioned artifact, parameterization, checkpoints, outputs, outcomes, and validation. |
| Replay and recovery | Deterministic SDK browser primitives | Interpret the artifact, bound recovery, verify success; zero inference or self-healing. |
| Business application | None | Small synthetic member-servicing target and separate data store. |
| Run API and durable state | None | API, coordinator, interventions, receipts, events, and result/evidence access. |

This changes implementation effort, not acceptance criteria. SDK execution success is not business success, provider recordings are not executable capabilities, and our artifact must remain understandable independently of a provider transcript.

## Why Stagehand is the initial integration level

Stagehand supports AI-proposed actions via `observe()` and executing returned Action objects without inference. Its action replay can re-infer when self-healing is enabled, so replay must explicitly disable that behavior and verify zero model use. Recorded Action execution also skips DOM-settle waiting; our condition checks remain necessary. See [Stagehand Act](https://docs.stagehand.dev/v4/basics/act).

Use supported deterministic page/locator methods or validated Action descriptors for replay. Do not count repeated natural-language calls with a warm cache as the no-model guarantee: a miss can require inference. Do not use AI extraction in replay; read and validate outputs through deterministic UI rules. Returned selectors still require scope, uniqueness, and robustness checks; accepting a descriptor is not proof it will work with different member data.

Stagehand v4 exposes deterministic browser controls without a Playwright dependency. A separate production Playwright driver is not currently selected. An independent UI test tool can be chosen later. See [Stagehand introduction](https://docs.stagehand.dev/v4/first-steps/introduction).

Browserbase Model Gateway supplies Stagehand model access using a Browserbase key on hosted browsers. It does not provide this path for local browsers. This supports the decision to start hosted and avoid separate provider-key integration initially. See [Model Gateway](https://docs.browserbase.com/platform/model-gateway/overview).

## Fully managed Browserbase Agents: evaluate, not the initial executor

Managed Agents offer a goal-driven execution loop, but current documentation says their built-in tools cannot be disabled or extended, and browser allowed domains do not govern Fetch. That makes them an unsuitable default for a design requiring our checks before every UI mutation and a constrained UI-only path. This is a fit assessment based on [Agents behavior](https://docs.browserbase.com/platform/agents/how-it-works), not a claim that managed Agents are generally unsafe.

Use the more controllable Stagehand integration first. Reconsider further delegation only when equivalent policy, recording, parameterization, and handoff guarantees can be demonstrated. Agent-generated scripts remain candidates requiring inspection: generation alone does not ensure model-free execution or replace our typed artifact. See [Generate a script](https://docs.browserbase.com/platform/agents/generating-scripts).

The managed Agents reply-based pause feature should not be treated as our entire human-control mechanism. Its documented pause keeps the browser alive but has lifecycle limits, including inability to stop a paused run directly. Our Sessions/Stagehand control path must independently prove cancellation and same-session takeover. See [Pausing runs](https://docs.browserbase.com/platform/agents/pausing-runs).

## Verified compatibility spike before broader implementation

INT-003 verifies the actual pinned SDK on the tiny UI fixture; see [observed results, limitations, and adapter choices](SDK_COMPATIBILITY.md). These checks are not the assignment's final discovery evidence:

1. Launch/connect a hosted session from TypeScript and record its ID; serve the fixture at an address reachable by Browserbase.
2. Obtain a model-proposed action, inspect/check it before execution, and record its descriptor plus actual result.
3. Apply changed synthetic inputs and execute a saved descriptor using only deterministic operations with self-healing disabled. Instrument inference attempts and test with inference forbidden; do not remove Browserbase authentication needed for session control.
4. Verify unique scoped targeting across a frame/table, readiness checks, deterministic text extraction, and wrong-record detection. Document any missing primitive before implementing a workaround.
5. Demonstrate one real manual action and safe hand-back on the same session. Prefer provider UI where it meets our ownership/action-history criteria; otherwise use the already designed minimal mediated controls.
6. Verify capture/log controls, descriptor serialization, clean session termination, and the enabled model/provider configuration. Fail clearly when a required guarantee is unsupported.

The spike decides the smallest adapter we need, not whether to relax the assignment. Do not prebuild local-browser parity or a second provider. Credentials and account setup occur separately before running live services.

## Remaining stack decisions

TypeScript, Express, Zod, PostgreSQL, React + Vite, Mantine, and Browserbase delegation are selected. The following remain proposals or open choices:

- INT-005 selects pg and explicit SQL migrations with separate runtime/migrator roles. INT-004 selects a constrained flat scalar-object schema, validated through Zod with fixed formats and no executable schema hooks; see [CONTRACTS.md](CONTRACTS.md). Workspace tooling is pnpm 10.32.1 with exact dependency catalogs; Vitest is the selected test runner (INT-001).
- Stagehand is pinned to 4.4.0 and the selected Gateway model is `openai/gpt-5`. The compatibility fixture uses a temporary Cloudflare Quick Tunnel. Model-driven operations are verified in INT-003; settle the full portal deployment/connectivity in INT-006.

Settle these with the chosen runtime/SDK constraints. The primary stack is selected; exact versions, supporting libraries, and hosting remain implementation choices.

## Executor/API implementation boundary (INT-007/008)

Browserbase/Stagehand own hosted sessions and browser transport. The TypeScript adapter resolves constrained semantic descriptors and performs uniqueness/policy/actionability checks together with native DOM UI dispatch. It supports the known same-origin React portal; unsupported browser structures fail closed. Express/Zod and PostgreSQL implement authenticated asynchronous run coordination, receipt idempotency, ownership, cancellation and restart reconciliation. The deterministic provider client forbids inference. Discovery proposals and the saved-capability interpreter remain separate upcoming workers. [Runtime guide and verified limits](RUNTIME.md).
