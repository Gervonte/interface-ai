# Demo Credit Union staff portal (INT-006)

The connected synthetic target implements **Staff workspace → Member Search → Member Overview → Account Inquiry → Account Details**. The outer institution/staff/branch shell contains a real, same-origin iframe titled **Member servicing workspace**. All member and account values come from the target PostgreSQL database through its own Express backend. No automation service, fixture lookup, or expected-answer table supplies UI results.

## Start locally

From the repository root, with Docker Desktop running and dependencies installed:

```sh
pnpm db:up
pnpm db:setup
pnpm demo:serve
```

Open http://127.0.0.1:3002. `demo:serve` builds the shared packages, React frontend, and target API; Express serves both the built frontend and target API from this one loopback origin. It needs the private target `DATABASE_URL` written by `db:up`. No Browserbase or model credentials are needed to use the portal. `db:setup` also resets the synthetic baseline; use `db:migrate` instead when retaining existing fixture values.

For development, run `pnpm dev:demo-api` and `pnpm dev:demo-web` in separate terminals and open http://127.0.0.1:5174. The Vite `/api` proxy reaches the same target backend. Root `pnpm dev` additionally starts the separate automation API/operator shell. Changing shared contracts requires restarting the relevant command. Ctrl+C stops each owned server; `pnpm db:down` separately stops the project database while retaining its volume.

## Walkthrough

1. Choose **Start Member Search** or **Member Search** in the sidebar.
2. Enter `M1001`, choose **Search**, confirm the result identity, and choose its **Open** button.
3. From **Member Overview**, choose **Account Inquiry**.
4. Find the row designated **Primary**, with type **Primary Savings**, and choose that row's **Open**. Checking has the same button label.
5. Confirm member/account identity, status, currency, and the distinct **Current Balance** and **Available Balance** values.
6. **Back to Accounts** retains the selected member. **New member search**, sidebar search, or **Clear** removes the old selection/results. Repeat for `M1002`; primary savings appears in a different row.

| Member | Primary savings | Current Balance | Available Balance | Inquiry order |
| --- | --- | --- | --- | --- |
| M1001 | S2001 | $1,250.34 | $1,200.34 | Checking, Primary Savings |
| M1002 | S2002 | $87.65 | $76.00 | Primary Savings, Checking |
| M1003 | None | — | — | Checking; explicit no-primary notice |
| M1004 | Restricted | — | — | Explicit access denial |
| M9999 | No matching member | — | — | No result to select |

Blank/malformed IDs have inline validation. Loading, safe service failures, missing accounts, expired staff sessions, and stale selections have explicit states. Browser Back revalidates the saved member/account against the current server selection; it cannot resurrect a previous member's balances after a new search clears context. UI request cancellation/generation checks discard old responses, while server context revisions reject searches/selections/account reads that finish after a context change.

## Target HTTP boundary

These are the target application's own routes under `/api/staff`, consumed by its React UI. They are not automation tools. The automation application must navigate the UI; it must not call these routes to obtain business answers.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/session` | Open/read synthetic staff session and active member |
| POST | `/context/reset` | Clear member/search context; body `{}` |
| POST | `/search` | Search exact `{memberId}` and invalidate prior context |
| POST | `/selection` | Select `{memberId,searchRevision}` from the latest found result |
| GET | `/members/:memberId` | Read active member overview |
| GET | `/members/:memberId/accounts` | Read active member's permitted accounts |
| GET | `/members/:memberId/accounts/:accountId` | Read one permitted account belonging to the active member |

Responses use public Zod DTOs, safe integer minor units, and `Cache-Control: no-store`. No raw database errors or credentials are returned. Account access is checked before returning balances. An account from another member is not available through the active member's path. POST requests require the current browser origin. `/staff` is an equivalent internal mount for the existing Vite proxy, which strips `/api`. `/healthz` and `/api/healthz` report process identity, not database readiness; target workflow requests fail safely if the database is unavailable.

The fixed training operator is **Alex Chen / STF-104 / Training Branch / Member Services**. Staff sessions are anonymous synthetic training sessions stored in server memory, limited to 100 and one hour. Cookies are HttpOnly/SameSite=Lax and Secure on HTTPS. Reloading opens a fresh session after expiry or target-server restart. This is a fictional staff-session simulation, with no production identity provider or real financial data. Full expiry/restoration and exception injection are INT-012; contact writes are INT-018. Automation run authorization/coordinator APIs remain INT-008.

## Browserbase verification

Keep `pnpm demo:serve` running. In another terminal expose only the built synthetic target:

```sh
cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate
```

With existing server-only Browserbase credentials in `apps/automation/.env`, use the printed hostname at its root:

```sh
BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm browserbase:portal-check
```

The URL must be public HTTPS with no custom port, credentials, query, fragment, or extra path. This command uses authored semantic frame/form/table/row locators, checks both baseline members plus negative states and Back/new-search behavior, writes synthetic screenshots and a safe result under ignored `apps/automation/runtime/int-006`, and closes the hosted session with bounded provider-status verification. It forbids inference, self-healing, and caching; provider recording/logging/CAPTCHA solving are disabled. The session lifetime is capped at 300 seconds. Inspect the reported session UUID in Browserbase if termination cannot be confirmed.

Only the target's synthetic UI/API are exposed. Stop the temporary tunnel with Ctrl+C after the check. Do not expose the Vite development server, automation API, database, or private configuration. The hostname expires when the tunnel stops; it is not a retained production target configuration.

This is target UI verification. It does not save a discovered capability or establish discovery/replay acceptance. Those remain INT-009–INT-011. [Curated evidence](../evidence/int-006/README.md).

## Verification

`pnpm check:db` covers default HTTP/context-race checks and real PostgreSQL integration, including changed database values reaching the UI API. The hosted check traverses only the rendered UI and reads DOM fields; it imports no target repository or seed. Local browser inspection additionally checked desktop/narrow layout, normal browser Back, stale-history rejection after clearing context, and an error-free console on the normal flow.

## Repeatable scenarios (INT-012)

Run `pnpm demo:scenario --list` for the setup-only scenario names. Configuration is validated from ignored `apps/demo-api/runtime/scenario.json` and snapshotted for each new staff session. There is no scenario HTTP endpoint or automation input; existing sessions retain their configuration. Scenarios appear inside the normal search/inquiry/details flow, with manual dismissal/restoration controls for the blocked cases. [Setup, reset behavior, and complete scenario table](SCENARIOS.md).
