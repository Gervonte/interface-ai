# INT-002 hosted fixture connectivity

Verified on 2026-11-16 using Node 26.2.0, pnpm 10.32.1, Stagehand 4.4.0, and cloudflared 2026.11.0. [Sanitized command output](connectivity.json) records the real Browserbase session UUID and final status. The temporary tunnel URL in that historical record is stopped after verification; start a new tunnel to reproduce the check.

- A real hosted browser loaded the fixture's staff shell and servicing iframe, with two account rows and two repeated “Open” controls.
- Session `c945c21b-f7ac-4c15-8467-7abb7be14e76` was explicitly closed; Browserbase then returned `COMPLETED`.
- The automation Express app responded to 27 health requests during the operation, with zero failures and a maximum observed latency of 24 ms.
- The selected Gateway model is `openai/gpt-5`; this check initializes it but makes no model inference request. No discovery, replay, or handoff evidence is claimed.
- A separate local browser smoke check changed Member ID from M1001 to M1002, submitted “Find member,” and opened S2002 through the first account-row control. Account Details showed M1002/S2002, Current Balance $87.65, and Available Balance $76.00. No browser console errors/warnings were observed. This manual smoke check is separate from the hosted connection result.
- `pnpm check` passed: typechecking, 33 tests across three files, and all application builds. Provider lifecycle tests use injected fakes; fixture/service boundary tests use real local HTTP requests.

The curated JSON was checked against the local credential values before retaining it. It contains no API key, project ID, authenticated connection URL, provider response body, recording, or browser profile. Raw runtime output stays ignored. Only synthetic data is served by the fixture.

Reproduce with [BROWSERBASE_SETUP.md](../../docs/BROWSERBASE_SETUP.md). The complete target portal and automation acceptance checks remain future tasks.
