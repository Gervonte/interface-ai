# INT-003 SDK boundary evidence

Verified on **2026-11-16, America/New_York**. JSON event timestamps use UTC, so this run appears as 2026-11-17 there. This is a synthetic compatibility proof, not the final assessment discovery/artifact/replay workflow.

Session: `4a870efb-0f45-4f4e-90b8-5dba641bcad6`. [Full sanitized result and action history](result.json).

| Check | Observed result |
| --- | --- |
| Genuine model proposals | Browserbase Gateway `openai/gpt-5` proposed a framed Member ID fill and the Primary Savings row's Open click; both returned nonzero inference usage |
| Inspection before dispatch | Each proposal left the UI unchanged, passed method/argument and unique scoped-target checks, then executed via `act(Action)` with zero execution token usage |
| Serialization | [Fill descriptor](fill-action.json) was written, reloaded, validated, and executed |
| Discovery fixture output | M1001 / S2001; current 125034, available 120034 minor units |
| Inference guard | A deliberate observe call hit the local rejecting model callback once and failed; subsequent deterministic work hit it zero times |
| Changed input | Saved fill descriptor rebound to M1002; verified S2002, current 8765 and available 7600 minor units |
| Row reordering | Recorded positional Open XPath pointed away from Primary Savings after reordering and was rejected before dispatch; semantic frame/table/row targeting selected the correct row |
| Failure capture | A 500 ms missing-target wait rejected; a subsequent read confirmed the target absent; actual PNG and iframe-inclusive SDK snapshot captured |
| Real human takeover | The user claimed the same session, performed five recorded manual actions through mediated controls, and handed back; final manual state verified M1001 / S2001 and both balances |
| Ownership boundaries | An attempted automation dispatch during human ownership and a stale human dispatch after hand-back were both rejected without executing their callbacks |
| Resume | Automation returned to M1001 Account Inquiry in the original session, with no repeated account action |
| Deterministic usage | All replay SDK token/timing metrics remained zero; zero new inference callback requests |
| Cleanup | Explicit browser close followed by provider `COMPLETED` status |

The human action history contains two member fills, two Find member clicks, and one savings Open click. These repeated reversible inputs/searches are actual user actions. Events retain actor/target/completion and control revisions, without copying typed text.

The [failure screenshot](failure.png) was visually inspected. It shows only the synthetic staff shell and M1002/S2002 details. The [failure snapshot](failure-snapshot.json) includes the actual servicing iframe, displayed account details, and DOM paths. JSON evidence was checked against local credential values; no API key, project ID, local operator token, or authenticated provider URL is retained. Generic redaction on arbitrary targets remains later work.

`pnpm check` passed typechecking, 51 tests across five files, and all builds. Unit/HTTP tests cover ownership admission, in-flight conflicts, asynchronous hand-back, stale views, descriptor validation, wrong-member output checks, local authorization, hostile Host headers, and safe provider error handling. Those tests supplement the real session evidence above.

Reproduce with [SDK_COMPATIBILITY.md](../../SDK_COMPATIBILITY.md). Runtime files stay ignored; this directory contains the curated synthetic result. The tunnel used for this verification is temporary and is stopped after testing.
