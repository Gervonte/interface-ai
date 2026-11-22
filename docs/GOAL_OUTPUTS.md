# Requested account outputs (INT-023)

Discovery accepts a natural-language goal, explicit `outputContract`, target, and `memberId` binding. The contract names each output, its meaning and scalar schema, and the requested account type/designation/status. One planner prompt and one worker handle both balance meanings. The worker has no primary/savings/balance keyword gate, fixed output names, or separate current/available flow. The planner chooses the route and live field references; independent checks enforce the requested account and output semantics.

## Request contract

See the complete caller examples: [current balance](../examples/discovery-current.json) and [available balance](../examples/discovery-available.json). These are authored requests, not discovered capabilities or run evidence. The worker never imports these presets.

`outputContract.account` supplies `type` (`savings` or `checking`), `designation` (`Primary` or `Standard`), and `status` (`ACTIVE` or `CLOSED`). `outputContract.fields` maps caller-chosen identifiers to `{ meaning, schema }`. Names may be changed without changing the worker; names and schemas are metadata and must not contain record values.

| Meaning | Supported schema/conversion |
| --- | --- |
| `member-id` | String, `member-id` format, maximum length 5; no literal enum |
| `account-id` | String, `account-id` format, maximum length 5; no literal enum |
| `account-type` | Bounded string enum containing exactly the requested savings/checking type; exact UI labels normalize to that type |
| `currency` | String enum `USD`, maximum length 3 |
| `current-balance` | Nonnegative bounded integer; deterministic USD-to-minor-unit conversion from Current Balance |
| `available-balance` | Nonnegative bounded integer; the same conversion from Available Balance |

Identity/type/currency meanings and at least one balance meaning are required. Meaning duplicates, unsupported meanings/types, identity literal enums, conflicting account-type constraints, missing identities, and more than six outputs are rejected. Both balance meanings may be requested together. A syntactically invalid contract gets HTTP 400 before acceptance. A direct worker invocation with an invalid contract stops before creating a browser. The coordinator also rejects publication if the capability's output schema differs from the accepted request.

The model receives the requested names/meanings/types/account criteria, sanitized goal, input names, safe business labels and binding-match booleans. It receives no observed member/account IDs, names, balances, input values, selectors, DOM, screenshots, or freshness digest. Safe document/frame context distinguishes repeated labels. Model-proposed outputs must be actual field refs with the requested meaning, inside Account Details; member/account identity and requested account criteria are checked independently before and after typed capture.

## Run both real demonstrations

Use the existing [database](DATABASE.md), [portal](PORTAL.md), and [workflow](WORKFLOWS.md) setup. Keep private credentials in the existing local env files. Stop other automation API/watchers; the verifier starts its own loopback API on port 3001.

```sh
pnpm check:db
pnpm demo:serve
# Separate terminal:
cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate
# Separate terminal, using the fresh HTTPS root (include the final slash):
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com/ pnpm goal:demo
```

The verifier separately selects the baseline target scenario, freezes one reachable configuration version, and runs current discovery → exact-artifact replay → available discovery → exact-artifact replay. All four use separate API processes/browser sessions. Discoveries use M1001; replays use M1002 with its different account order and balances. Synthetic expected values belong only to the verifier, never to planner inputs or saved steps.

| Requested field | M1001 / S2001 discovery | M1002 / S2002 replay |
| --- | --- | --- |
| Current Balance | 125034 minor units ($1,250.34) | 8765 ($87.65) |
| Available Balance | 120034 ($1,200.34) | 7600 ($76.00) |

Each artifact must select the correct, distinct UI field and derive its output schema from that request. Each replay must load the exact saved reference and report zero model calls, attempts, tokens, and model events. The verifier checks all typed outputs and confirmed browser closure. Its four process IDs must differ. It stops its API children and restores the next target session to baseline on exit. Private requests, artifacts, reports, and result summaries go to ignored `apps/automation/runtime/int-023/`.

If a model requests human help, the verifier preserves the live session and prints the run ID. Start `pnpm dev:operator` and use the [handoff guide](HANDOFF.md). No verifier automatically performs a human action. A resulting explicit human boundary remains part of its artifact and replay. Stop the operator page, target, and tunnel after checking.

## Compatibility and limits

New discovery requests require `outputContract`; the repository's callers now send it explicitly. Replay requests still contain only target, exact capability version, and inputs. Existing saved artifacts are unchanged and remain valid, including the legacy savings-only conversion. New account-type conversion supports savings/checking; unsupported labels stop safely. Authored missing-primary-savings rules apply only to a request for primary savings, so they do not misclassify checking requests. Existing rule-revision tools retain their earlier primary-savings defaults.

This is bounded read-only account inquiry against the known portal vocabulary, input format, supported fields, and USD conversion. It does not implement arbitrary applications, arbitrary field meanings, or writes. Natural-language goal interpretation remains model-dependent; goal/contract conflicts or unsupported actions must request help or stop. Deterministic checks enforce the typed contract, selected identity and criteria, and actual UI field semantics. Hard budgets still stop the run, and replay never uses model reasoning to repair a mismatch.

Live verification passed on 2026-11-21: both discoveries selected their distinct requested fields and both exact-version M1002 replays ran with zero model use. [Evidence](../evidence/int-023/README.md). An earlier attempt was blocked by Browserbase HTTP 402 before any model call or UI action; it is kept as a [separate record](../evidence/int-023/blocked-attempt/verification-blocked.json). Local injected tests cover current/available field discrimination, arbitrary output names and goals without task keywords, checking criteria, exact account-type enums, goal/contract conflicts, omitted output refs, wrong-account/wrong-field rejection, invalid contracts, publication schema mismatches, and model-free replay; they supplement, not replace, the live evidence.
