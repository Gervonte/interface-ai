# Browserbase connectivity (INT-002)

INT-002 is verified. This provides a hosted connection and a small synthetic compatibility fixture. The connected INT-006 staff portal has a separate [target-only tunnel and UI check](PORTAL.md#browserbase-verification). The separate [INT-003 check](SDK_COMPATIBILITY.md) verifies model proposals, inference-forbidden execution, and human takeover on this fixture; the final assessment workflows still need their implementation and evidence.

## Credentials

Create `apps/automation/.env` locally, using `apps/automation/.env.example` as a reference. This file is ignored by Git. Never put these values into frontend `VITE_*` variables, public contracts, commits, screenshots, or chat.

```dotenv
BROWSERBASE_API_KEY=your_browserbase_api_key
BROWSERBASE_PROJECT_ID=your_project_uuid
BROWSERBASE_FIXTURE_URL=https://your-current-tunnel.trycloudflare.com/compatibility
```

Get the key and project ID from your Browserbase project settings. Node loads `.env` from the automation app's directory when the check runs. Existing shell variables take precedence. Normal `pnpm dev` still needs no Browserbase credentials and does not open a paid session.

## Start the fixture and tunnel

Install dependencies as described in [README](../README.md). Install the `cloudflared` command using [Cloudflare's installation instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). On macOS, `brew install cloudflared` is sufficient. The live check used cloudflared 2026.11.0.

In terminal 1, from the repo root:

```sh
pnpm dev:fixture
```

This starts a dedicated Express server on `127.0.0.1:3003`. Open `http://127.0.0.1:3003/compatibility` to inspect it. It serves only synthetic fixture HTML/CSS and its own health endpoint. It has no static filesystem route, business API, credentials, or connection to either application database. It does not expose the Vite development server or automation API. An optional `FIXTURE_PORT` changes this fixture port independently of the regular demo API.

In terminal 2:

```sh
cloudflared tunnel --url http://127.0.0.1:3003 --no-autoupdate
```

Cloudflare prints a temporary HTTPS hostname. Set `BROWSERBASE_FIXTURE_URL` in `apps/automation/.env` to that hostname **plus `/compatibility`**. Keep both terminals running while testing. The hostname changes whenever a new Quick Tunnel starts. Anyone with the URL can access this synthetic-only service until the tunnel stops. No account or domain configuration is needed. See [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Run the hosted connection check

In terminal 3, from the repo root:

```sh
pnpm browserbase:check
```

Or provide the current URL for this invocation without editing `.env`:

```sh
BROWSERBASE_FIXTURE_URL=https://your-current-tunnel.trycloudflare.com/compatibility pnpm browserbase:check
```

The command validates configuration before opening a session. Fixture URLs must use public HTTPS, have the exact `/compatibility` path, and contain no credentials, custom port, query, or fragment. The check then:

1. Starts the real automation Express app on a temporary loopback port in the same Node process as the browser work.
2. Samples `/healthz` before, during, and after that work. Any failed sample or observed latency above two seconds fails the check.
3. Launches one Browserbase session and records its non-secret UUID.
4. Initializes Stagehand with the selected model configuration, loads the fixture, and verifies the staff heading, same-origin servicing frame, two account rows, and two “Open” controls through rendered DOM reads.
5. Closes Stagehand and explicitly closes the browser even if navigation or fixture verification fails.
6. Polls Browserbase's session API for a bounded period. Only a confirmed `COMPLETED` status passes; a successful close request alone does not.
7. Writes the sanitized result to `apps/automation/runtime/int-002-connectivity.json` and exits nonzero on failure.

The temporary automation listener closes before the command exits. This proves that this API remains responsive during connection work; it does not claim the later run/coordinator endpoints exist. No target business API or shared fixture import supplies the browser result.

Provider errors are reduced to a failure phase rather than printed with authenticated URLs or bodies. If `cleanup` or `termination` fails, inspect the session UUID in the Browserbase dashboard and end it if needed. The configured provider timeout also bounds session lifetime to 180 seconds. If initialization fails before a handle is returned, Stagehand owns that launch cleanup and the provider timeout remains the fallback.

## Selected configuration

| Setting | Value |
| --- | --- |
| SDK | Stagehand 4.4.0; locked transitive Browserbase SDK 2.27.0 |
| Compatibility spike model | `openai/gpt-5` through Browserbase Model Gateway |
| Region | `us-west-2` |
| Provider session timeout | 180 seconds; SDK 2.27 calls the launch option `api_timeout` |
| Provider HTTP timeout / retries | 30 seconds / zero retries |
| Navigation and frame-readiness timeouts | 20 seconds each |
| Stagehand self-healing / action cache | Disabled / disabled |
| Provider recording / logging / CAPTCHA solving | Disabled / disabled / disabled |
| Navigation domain | Current fixture hostname |

Model Gateway uses Browserbase authentication on hosted browsers. No separate model-provider API key is configured. This model is explicitly selected from the provider's [documented models](https://docs.browserbase.com/platform/model-gateway/overview). INT-002 initializes that configuration but deliberately makes no `observe`, `act`, or AI `extract` request; **actual inference support and accounting are verified in the separate [INT-003 check](SDK_COMPATIBILITY.md)**.

Browserbase's domain restriction covers top-frame navigation, allows subdomains, and does not govern iframe/resources. The fixture adds a same-origin content security policy and has no scripts/external resources. This is useful containment for the compatibility check; the full application-owned action/target policy remains INT-007. See [Allowed Domains](https://docs.browserbase.com/platform/browser/security/allowed-domains.md).

Session ownership follows the [Stagehand browser lifecycle](https://docs.stagehand.dev/v4/configuration/browser): explicitly close the factory-created browser. Do not assume closing an attached Stagehand client terminates its browser.

## Stop and evidence

After the check, use Ctrl+C in terminal 2 to stop the tunnel and in terminal 1 to stop the fixture. The temporary public URL then stops serving the fixture. Nothing is installed as a background service.

The fixture uses ordinary HTML forms and semantic table headings inside a real iframe. M1001 and M1002 have different primary-savings values and reordered account rows. “Open” navigates to the selected account's details. This provides SDK control patterns for INT-003, not the complete member-search/overview/inquiry workflow required in INT-006.

See [the recorded live result](../evidence/int-002/README.md). Automated tests use fake provider dependencies to check cleanup, health, termination confirmation, and safe configuration failures; HTTP tests check the public fixture boundary. Those tests do not replace the live Browserbase result and are not discovery/replay assessment evidence.

## Connected staff portal (INT-006)

The compatibility fixture above remains isolated on port 3003. To test the full PostgreSQL-backed portal, use `pnpm demo:serve`, tunnel only port 3002, and run `BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm browserbase:portal-check`. Use the HTTPS root, without `/compatibility`. This separate authored UI check verifies both members, repeated controls and negative states without inference; it does not discover/save a capability. Its provider session timeout is 300 seconds. [Full start/stop instructions](PORTAL.md); [verified evidence](../evidence/int-006/README.md).

## Shared executor verification (INT-007/008)

The full runtime check is now `BROWSERBASE_PORTAL_URL=https://your-current-tunnel.trycloudflare.com pnpm executor:check`, after database migration and with only the built target on port 3002 tunneled. Stop the automation API first: this verifier uses the same database-backed single-coordinator lock. It verifies both accounts through the actual executor, deliberately rejects ambiguous Open controls with no mutation, captures sanitized structural evidence and confirms provider cleanup. [Setup and limits](RUNTIME.md#hosted-executor-verification). This remains authored QA, not discovery/replay evidence.

Current integrated discovery pins `openai/gpt-4.1`; the compatibility milestones above used `openai/gpt-5`. The change follows completed GPT-5 decisions taking 30–107 seconds and later request/active-budget stops. Model names in retained events describe the model actually selected for each run. See [handoff verification](HANDOFF.md).
