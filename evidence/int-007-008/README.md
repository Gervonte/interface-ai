# INT-007/008 — Shared executor and coordinator verification

Verified on 2026-11-18 (America/New_York) against the PostgreSQL-backed synthetic staff portal through Browserbase/Stagehand 4.4.0.

- [Live result](result.json): real coordinator run `cb571aa3-3f43-40c7-9d85-61cdc49bd17b` traversed both baseline members and verified member/account identity, savings type, currency, Current Balance and Available Balance through UI-only operations.
- [Ordered sanitized events](events.json): real dispatch intents/results and logical target references. Typed inputs/record values/provider credentials are absent.
- [Failure evidence](failure-evidence.json): the actual structural snapshot from the deliberately ambiguous Open target. It shows Account Inquiry, two enabled Open controls and a two-row account table with its headers, while omitting record values and arbitrary text.
- The ambiguous target dispatched **zero** mutations. The run's expected terminal state is `failed / AMBIGUOUS_TARGET`; the verifier succeeds only if that boundary and the prior UI checks pass.
- Zero inference attempts/SDK model metrics; self-healing/cache and provider recording/logging disabled. Explicit cleanup was followed by provider `COMPLETED` and persisted session state `closed`.

This is **authored shared-executor QA**, not model-driven discovery, a generated capability, or saved-capability replay evidence. The goal and UI steps are supplied by the verifier. No capability was published. Discovery/replay demonstrations remain INT-009–INT-011.

The corresponding database tests exercise asynchronous HTTP acceptance/deduplication, authorization, exact versions, cancellation while dispatch remains unresolved, startup cancellation, singleton ownership, transient-output expiry, cleanup uncertainty, and actual child-process death during session creation. These injected workers/fixtures are test evidence for those boundaries; they do not replace the live browser check.

The evidence UUID's 24-hour expiry describes the runtime access route. This explicit reviewed synthetic export is retained in Git separately. Temporary target URLs and runtime binding files are not durable deployments. [Setup, commands and limits](../../docs/RUNTIME.md).
