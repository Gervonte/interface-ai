# Interface AI — computer-use automation for legacy back-office apps

An LLM operates a back-office web app once to reach a goal. The system saves what worked as a typed, versioned **capability**, then **replays** it without the model for any valid input. Replay returns a success, a business outcome (such as "no such member") or a hard failure that names the step that failed. When automation can't safely continue, a person takes over the same live browser session and hands it back. An allowlist and a risky-action block apply throughout.

The target is a synthetic credit-union staff portal in this repo (iframe workspace, table layouts, no test IDs, injectable errors). Discovery runs in a Browserbase browser using `gpt-4.1`.

**Read:** [REPORT.md](REPORT.md) (design write-up) · [evidence/](evidence/README.md) (real runs) · [docs/](docs/README.md) (guides and full design)

## Requirements

Node.js 26.2.0, pnpm 10.32.1, Docker Desktop and Google Chrome. For live discovery you also need a Browserbase account (API key and project ID; model calls use the same credentials) and `cloudflared`.

## Try it locally (no Browserbase, tunnel or keys)

Replay needs no model, so the saved capability in `evidence/` runs on your machine:

```sh
pnpm install --frozen-lockfile
pnpm db:up && pnpm db:setup   # portal database with synthetic members M1001–M1004
pnpm demo:serve               # portal on http://127.0.0.1:3002 — leave running
pnpm replay:local             # in another terminal
```

Expected: `success` for M1002 with `currentBalanceMinor: 8765` and zero model calls. Then try the exceptional cases:

```sh
pnpm replay:local --member M9999                           # business outcome: MEMBER_NOT_FOUND
pnpm replay:local --scenario servicing-notice              # success after one declared recovery
pnpm replay:local --scenario wrong-member --member M1001   # hard failure: IDENTITY_MISMATCH, with step and snapshot
```

## Full demo: goal → discovery → capability → replay

One-time setup, after the steps above:

```sh
# Add BROWSERBASE_API_KEY=… and BROWSERBASE_PROJECT_ID=… to apps/automation/.env
# (pnpm db:up created that file; don't overwrite it — apps/automation/.env.example lists every setting)
pnpm automation:configure   # generates the local API token
```

With `pnpm demo:serve` still running, open a tunnel so the hosted browser can reach the portal, then run the demo with the printed URL:

```sh
cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate
BROWSERBASE_PORTAL_URL=https://<random>.trycloudflare.com/ pnpm demo:e2e
```

`demo:e2e` sends the goal in [examples/discovery-current.json](examples/discovery-current.json) ("Find the current balance… of the member's active primary savings account"). The model operates the live portal for M1001, and the result is saved as a capability. That exact capability is then replayed for M1002 and for M9999. Expected: discovery returns 125034 ($1,250.34), the M1002 replay returns 8765 ($87.65), and the M9999 replay returns `MEMBER_NOT_FOUND`. Both replays make zero model calls. Use `--request examples/discovery-available.json` for a different goal ([how requests work](docs/GOAL_OUTPUTS.md)).

## More

| Command | What it does |
| --- | --- |
| `pnpm check` | Typecheck, 262 tests and builds. No keys, database or network. |
| `pnpm check:db` | The above plus 43 PostgreSQL tests (needs Docker). |
| `pnpm handoff:demo` + `pnpm dev:operator` | Live runs that pause for a person; take over the session at `http://127.0.0.1:5173`. [Steps](docs/HANDOFF.md) |
| `pnpm scenario:check` | 19 live runtime conditions: outcomes, recoveries, failures, interventions. [Guide](docs/SCENARIOS.md) |
| `pnpm safety:demo` | Provider refusal, risky-control block, page-embedded instructions, hard failure. [Guide](docs/SAFETY.md) |

The live commands use the same tunnel as `demo:e2e`. Ctrl+C stops any demo and closes its browser. If a run was interrupted, `pnpm automation:reconcile` clears its session before the next one, and `pnpm db:down` stops the database.
