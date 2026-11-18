# INT-006 — Connected staff portal verification

Verified 2026-11-17 (America/New_York), with Browserbase/Stagehand 4.4.0, PostgreSQL 18.7, and the built synthetic target served from one origin through a temporary Cloudflare tunnel.

This is **authored UI verification of the target application**. It is not model-driven discovery, a generated capability, or saved-capability replay evidence. The verifier used semantic frame/form/table/row targeting and deterministic DOM reads; the target itself reads its separate PostgreSQL database.

- [Hosted result](result.json): session `f3400b7b-6085-43a3-957a-f100a996038f`, both member/account identities and distinct balance fields verified, account rows reordered, Back preserved context, and new search cleared prior context.
- No-primary-savings, access-denied, missing-member, and invalid-ID states passed through the same visible workflow.
- A rejecting model callback recorded zero attempted inference; all SDK model metrics were zero. Self-healing/cache and provider logging/recording were disabled.
- Explicit cleanup was followed by provider status `COMPLETED`.
- [Account Inquiry](account-inquiry.png), [M1001 Account Details](M1001-details.png), [M1002 Account Details](M1002-details.png): inspected synthetic UI screenshots with no credentials or real member data.

Local Chrome inspection also traversed the M1001 flow, checked desktop/narrow layouts, and verified browser Back to Account Inquiry. After **New member search** cleared context, browser Back showed a context-change error and no old account fields. The normal-flow browser console had no errors/warnings. The HTTP tests exercise late search/account responses after context changes; the real database test changes a stored balance and verifies the target API returns the changed value, then resets the isolated fixture.

The public hostname in `result.json` identifies that temporary run; the tunnel was stopped after verification. It is not a durable deployment URL. See [portal setup and check command](../../PORTAL.md).
