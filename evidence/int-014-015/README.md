# INT-014/015: discovery and replay handoff

On November 20, 2026, the real operator used the Mantine page to resolve two live pauses. Discovery resumed in its existing browser, verified the output, and published capability `balance-d010c6229cb74dbd9c82e5af929c75fb`, version 1. A separate process replayed that exact artifact for another member, accepted manual session restoration, and completed with zero inference. Both browser sessions were confirmed closed.

| Run | Scenario and human action | Verified output |
| --- | --- | --- |
| Discovery `af5a769d-4f85-4e9c-bd99-0c50285ea96b` | Unexpected dialog; dismiss servicing review, then validate and resume | M1001 / S2001, savings, USD 125034 minor units ($1,250.34) |
| Replay `49ddcfee-643c-4a7d-8edc-b37d76a1f38a` | Staff session expiry; restore staff session, then validate and resume | M1002 / S2002, savings, USD 8765 minor units ($87.65) |

| File | Evidence |
| --- | --- |
| [capability.json](capability.json) | Exact newly discovered version 1 consumed by replay; 13 parameterized steps and an explicit human contribution. |
| [discovery.json](discovery.json) | Producing run, initial pause context, model usage, human/control events, typed result, and cleanup. |
| [replay.json](replay.json) | Fresh-process replay of that exact version with changed input, human/control events, typed result, and zero inference. |
| [result.json](result.json) | Complete verifier summary with `discovery-and-replay-handoff` scope and distinct process IDs. |
| [discovery-pause-1.json](discovery-pause-1.json) | Actual sanitized structural snapshot of the servicing-review pause. |
| [replay-pause-1.json](replay-pause-1.json) | Actual sanitized structural snapshot of the staff-expiry pause. |

## Provenance and control

The artifact's producing run is `af5a769d-4f85-4e9c-bd99-0c50285ea96b`. Its manual contribution names guard `unexpected-dialog`, intervention `b53151a3-9fb5-4cda-8a30-3d3ac0f11645`, and actual human completion event **119**. The rule remains a conditional human boundary; the dismiss action is never converted into an unattended step. Outcome, recovery, and guard declarations retain their explicitly authored provenance. The semantic route and output field references came from model-selected actions and verified UI reads.

New discovery uses `openai/gpt-4.1` through Browserbase Model Gateway, with caching disabled. This run completed seven planner decisions with 10599 input tokens and 765 output tokens. Replay recorded zero model calls, inference attempts, input tokens, and output tokens, and no model events.

| Run | Claim → confirmed manual action → validated control return | Internal session reference |
| --- | --- | --- |
| Discovery | Events 116 → 119 → 129; revisions 4 → 6 | `8d7bc722-0293-4d2b-a835-320e9362d809` |
| Replay | Events 69 → 72 → 80; revisions 4 → 6 | `7b63b6f6-a8be-44dc-8d0a-0f2872d767b0` |

The authenticated controller was `demo-operator`. Each run retained its own existing browser across handoff; replay used a separate browser and process from discovery. No automation-actor event occurs while the human holds control. System-owned resume checks validate the checkpoint and identities before returning control. Every ordinary recorded step dispatches at most once; the completed account-opening/navigation action is not repeated on hand-back. The operator confirmed both actions in the task conversation; the verifier did not perform them.

The report's intervention objects capture the initial pauses. Final run states and ordered control-return events establish resolution. Original host and PostgreSQL timestamps are preserved despite clock divergence after machine idle; event sequence numbers and control revisions establish per-run ordering.

## Scope and limits

The operator viewed authenticated, on-demand PNGs and used mediated semantic controls in the existing hosted browser. This is not an unrestricted co-browsing iframe. Raw PNGs/DOM, provider control URLs, profiles, credentials, and typed input values are excluded from this packet. Synthetic result IDs and amounts are intentionally retained.

Earlier GPT-5 attempts encountered request/active deadlines. A real handoff also exposed an artifact-validation ordering bug: manual contribution references were validated before guard declarations were attached. The fix has a worker regression covering guarded discovery, publication-ready artifact construction, and changed-input replay without a planner. The successful runs above were made after that fix; their references were not rewritten from a failed attempt.

Two historical diagnostics remain separate: [an earlier failed discovery](history/discovery-unavailable.json) and [the earlier replay-only pause snapshot](history/pause-evidence.json). They do not produce or consume the new artifact in this packet. [Original balance milestone](../int-009-011/README.md) · [Outcome/recovery matrix](../int-012-013/README.md).

`pnpm check:db` passes typechecking, 200 default tests, 36 PostgreSQL tests, and production builds. Checks include competing/stale claims, failed validation/reclaim, cancellation during manual dispatch, a shorter declared intervention deadline, explicit planner-help boundaries, guarded discovery/replay, and publication refusing omitted human mutations.

INT-014/015 are complete at this stated scope. Goal-driven output contracts, full safety/redaction and precise failure verification, and submission packaging remain later baseline tasks. [Setup, API, deadlines, and limits](../../HANDOFF.md).
