# INT-012/013: live portal scenarios and bounded recovery

Verified on 2026-11-19 (America/New_York); some UTC timestamps extend into November 20. These are real Browserbase/Stagehand 4.4.0 sessions operating the PostgreSQL-backed synthetic staff portal UI.

[Matrix result](result.json) contains all **19 passing scenario checks**, their actual run IDs/results, recovery counts, zero-inference metrics, verified session closure, and hashes of the full private source reports. It also links two successful target-control UI checks. Expected negative outcomes, hard failures, and paused/cancelled cases count as passing checks only when the precise expected result and cleanup were verified.

[Capability version 3](capability.json) adds explicitly authored scenario rules to the genuine capability produced by discovery run `96c165d4-4b17-46d7-88c8-ebfbd25839e6`. The original 13 discovered steps, bindings, targets, and source references are unchanged. Database lineage identifies base version 2; original version 1 and its successful discovery result remain immutable. This revision is authored specialization, not another claimed discovery. [Original genuine discovery/replay proof](../int-009-011/README.md).

The matrix reuses that exact saved version for M1002. It covers baseline success; missing member, no primary savings and access-denied outcomes; short search/inquiry delays; successful notice/inquiry recovery; exhausted persistent failures; target validation; wrong member/account; duplicate eligible accounts; contradictory signals; real browser destruction; modal/staff-expiry intervention; and an inquiry exceeding its deadline. Every ordinary workflow step dispatches at most once. Recovery performs only declared actions, never asks a model, and stops at its finite limit. Successful outputs identify M1002/S2002 with 8765 minor units ($87.65).

Selected complete reports:

| File | What it demonstrates |
| --- | --- |
| [baseline.json](baseline.json) | Valid typed UI outputs through the revised capability. |
| [member-not-found.json](member-not-found.json) | Explicit record-qualified `MEMBER_NOT_FOUND`, rather than inferring absence from missing controls. |
| [servicing-notice.json](servicing-notice.json) | One declared acknowledgment, verified continuation, zero inference. |
| [recovery-exhausted.json](recovery-exhausted.json) | Persistent inquiry failure stops after two scoped Try again actions. |
| [wrong-account.json](wrong-account.json) | Detail identity mismatch prevents success/output delivery. |
| [browser-destroyed.json](browser-destroyed.json) | A real closed browser produces `SESSION_LOST`, independently of staff-session expiry. |
| [unexpected-modal.json](unexpected-modal.json) | Structured `UNEXPECTED_DIALOG` intervention with the browser retained until verifier cancellation. |
| [session-expired.json](session-expired.json) | Structured `SESSION_EXPIRED` intervention with the same live browser/session context. |
| [failure-evidence.json](failure-evidence.json) | Ten actual sanitized structural snapshots from failures/paused cases; record values and arbitrary text omitted. |

Intervention objects are snapshots taken **before** verifier cancellation; the terminal run/result and cleanup fields were read afterward. The checker cancels paused runs to release its sessions. No operator claim, human-action capture, or production hand-back is claimed by those cancelled cases.

[control-session-expired.json](control-session-expired.json) and [control-unexpected-modal.json](control-unexpected-modal.json) are separate **authored target-control UI QA**. They exercise Restore staff session and Dismiss servicing review through real UI clicks, verify the same browser and selected member/account, then read the expected balance and confirm closure. A dedicated QA policy allows those controls; the automation policy does not. These checks establish that the target supports manual resolution. Genuine operator transfer/resume remains INT-014/015.

The verifier initially stopped at an expired tunnel and later exposed the pinned SDK's generic closed-client error. The latter was classified explicitly as session loss, tested, and rechecked in a new synthetic test run. Remaining cases resumed using the original saved configuration and exact capability version; already-passing cases were not silently rerun or replaced. The result packet records the successful final checks. No production run was restarted or repaired by a model.

Exports were checked for unchanged discovered actions, exact capability references, session cleanup, ordinary-step dispatch counts, zero inference, and configured secret leakage before copying. Event logs retain safe operation/rule/target metadata. Explicit synthetic result files contain the intended demo IDs and amounts; no credentials, provider control URLs, raw DOM, screenshots, or private model transcripts are included. Runtime evidence expires after 24 hours; this reviewed export is retained separately in Git.

`pnpm check:db` passes typechecking, **195 default tests**, **30 PostgreSQL tests**, and production builds. Tests additionally cover negative discovery without a fabricated artifact, authored-rule attachment, actual recovery-event provenance/order, preserved revision history, closed-transport classification, and uncertainty/no retry after a sent mutation loses its transport. [Setup, commands, rule semantics, and remaining scope](../../SCENARIOS.md).
