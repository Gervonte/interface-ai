# Demo Workflow

Status: balance lookup is the agreed initial workflow. A preferred-email update is proposed as a second capability in the same app. Implementation is still pending.

## Capability 1: primary savings balance lookup

**Look up a synthetic member and return the current balance of their primary savings account.**

Example goal: “Find the member identified by memberId, open their primary savings account, and return its current balance and currency.”

This exercises search, record selection, navigation, scoped control targeting, extraction, and verification. It matches the assignment's member-balance example and keeps the target app small enough to focus on the automation system.

## Input and result

Invocation input:

```json
{ "memberId": "M1001" }
```

Successful output, read and verified from the UI:

```json
{
  "memberId": "M1001",
  "accountId": "S2001",
  "accountType": "savings",
  "currentBalanceMinor": 125034,
  "currency": "USD"
}
```

`memberId` is a required string; the proposed synthetic format is `M` followed by four digits. Amounts are integer minor units: `125034` means USD 1,250.34. The workflow returns the displayed current balance, not the available balance. Display currency/locale is fixed for the initial demo and conversion is deterministic, without floating-point arithmetic.

A member has at most one designated primary savings account in the baseline fixtures. The UI exposes the designation so automation can select it using observed account type and primary status. If selection is ambiguous, stop with an explicit verification/targeting failure rather than choosing the first account.

## Happy path

1. Start in the member-search view and enter the invocation's member ID.
2. Submit the search and wait for a result associated with that ID.
3. Open the matching member and verify the displayed member ID.
4. Open the member's accounts view, which lists checking and savings accounts.
5. Open the row designated as primary savings.
6. On the account-detail view, verify member ID, account ID/type, and primary designation; extract the displayed current balance and currency.
7. Return typed outputs only after the identity checks and output validation pass.

Multiple account rows can each contain an Open button. Replay must scope the control to the correct row rather than use row order. Both member and account identifiers are extracted from the UI; copying invocation inputs into the output is not proof that the correct record was opened.

A fresh browser session can enter an already initialized synthetic staff workspace. Real sign-in, money movement, and account creation are outside this workflow. The separate policy demonstration can attempt a disallowed action/domain through the execution boundary; the demo app does not need a transfer feature just to prove blocking.

## Small target application

Use four initial conceptual areas: member search/results, member profile, account list, and account details. The proposed second capability adds a contact editor and a review/confirmation view from the same member profile. They may share layouts/routes; these are behavior boundaries rather than a requirement for separate frontend components.

Build the target frontend with React + Vite and Mantine components, as recorded in STACK.md. Preserve user-visible labels and semantic controls, and avoid locators based on generated library IDs/classes.

Include one framed workspace and a table-based account list to exercise legacy-style scope and repeated controls. Provide ordinary visible labels and meaningful record data, without automation-specific test IDs or dependence on generated DOM IDs. The model discovers the flow through the live UI; automation does not call the target's business endpoints or read its fixtures to obtain results.

Keep the target's synthetic member/account records separate from the automation database. Fixture seeding, reset, and scenario injection are demo/test setup operations, not actions available to discovery/replay as business-data shortcuts.

## Fixtures and business outcomes

| Member input | Target state | Expected caller result |
| --- | --- | --- |
| `M1001` | Checking plus primary savings `S2001`, current balance USD 1,250.34 | Success with `currentBalanceMinor: 125034`. Used for live discovery. |
| `M1002` | Differently ordered accounts; primary savings `S2002`, current balance USD 87.65 | Same artifact succeeds with `currentBalanceMinor: 8765`. Used to prove reuse. |
| `M1003` | Member exists with no primary savings account | Declared `NO_PRIMARY_SAVINGS_ACCOUNT` business outcome. |
| `M1004` | Explicit account-access denial in the UI | Declared `ACCESS_DENIED` business outcome. |
| `M9999` | Explicit no matching member response for the submitted ID | Declared `MEMBER_NOT_FOUND` business outcome. |

Use clearly synthetic names such as Test Member A; omit unnecessary addresses, dates of birth, and contact information. The proposed email-update capability adds only synthetic contact values such as member-a@example.test, with no email delivery or connection to real accounts. Outcome detection must use the explicit current UI response. Failure to find a search box or load a frame is an automation failure, not `MEMBER_NOT_FOUND`.

## Reproducible exceptional scenarios

Apply scenario flags during test/demo setup, independently of invocation inputs. Reset each run to a documented starting fixture. The automation sees their effects only through the UI.

| Scenario | UI behavior | Automation behavior to prove |
| --- | --- | --- |
| Slow response | Search/details remain loading for a controlled interval. | Wait within the deadline; no duplicate search/click. |
| Known interstitial | A specifically identified maintenance notice has an allowed dismissal action. | Execute its declared recovery and verify the expected next state. |
| Unexpected modal | A previously unhandled informational dialog blocks entry to account details. | Pause, request help, and let an operator dismiss it in the same session. Verify state before resuming. |
| Synthetic session expiry | A mock staff-session-expired screen appears. | Pause for permitted manual restoration in that session; do not store credentials. Distinguish this from a destroyed browser. |
| Failed load | A details transition produces an explicit error or never completes. | Bounded recovery/wait followed by a clear failure and sanitized richer evidence. |
| Invalid UI input | The target displays a validation error, exercised with a structurally valid invocation. | Recognize declared rejection or return a clear UI validation failure. Malformed invocation types are rejected before execution. |
| Duplicate/wrong record | A duplicate target or mismatched details identity is injected. | Stop without an arbitrary click or false success. |

The unexpected modal's manual dismissal is an ordinary permitted UI action. It is not an approval granting permission to move money or override policy. Record the real manual action and resume checkpoint; a simulated run-status change alone is insufficient.

The implementation can stage these scenarios, with happy path, changed-input replay, not-found, one bounded recovery/failure, and real modal takeover first. Remaining applicable conditions still need coverage before the acceptance checklist is declared complete.

## First end-to-end demonstration

1. Reset fixtures and run genuine LLM discovery for `M1001`; save the capability and sanitized evidence.
2. Start a new session and replay that artifact for `M1002` with model access disabled; verify its different identity, account, and amount.
3. Replay `M9999` and demonstrate a business outcome rather than a crash.
4. Inject slow loading and a known interstitial to demonstrate bounded waiting/recovery.
5. Inject the unexpected modal, perform a real operator dismissal in the paused session, and hand back for verified continuation.
6. Capture an unrecoverable load/verification failure with useful sanitized evidence, then exercise policy and data-leak tests separately.

Do not hard-code the goal's click sequence or returned values into the discovery agent. Synthetic expected outputs are independent test assertions, not an execution path for the automation.

## Capability 2: update a preferred email address

**Proposed addition:** find the member, update their synthetic preferred email, review the change, save, and verify it through the UI. This reuses search and the member profile; it does not require a second target app or a combined “lookup and update” capability.

Proposed inputs:

```json
{ "memberId": "M1001", "newEmail": "updated-a@example.test" }
```

Proposed verified output:

```json
{
  "memberId": "M1001",
  "changedField": "preferredEmail",
  "status": "updated",
  "confirmationId": "CHANGE-001"
}
```

Flow:

1. Search for and verify the requested member using the same application screens as capability 1.
2. Open contact details and inspect the current synthetic preferred email. If it already equals the requested value, return the declared `ALREADY_CURRENT` outcome without saving.
3. Enter the new email and open a review view showing member identity and the proposed before/after values. Verify the requested member and new value before any save.
4. Apply the configured commit policy. The recommended write demonstration pauses here and lets the human operator execute Save in the same session. The demo policy explicitly permits that operator action for this synthetic field; human ownership does not override other restrictions.
5. Read the UI's confirmation/reference, reopen contact details, and verify the new value is actually retained for that member before reporting success. A generic “Saved” banner alone is insufficient.

This makes the first capability an unattended discovery/replay example and the second a write workflow with a real human-controlled commit. Replay follows deterministic steps before and after the intervention; it does not call the model to decide how to continue. A separately configured synthetic-only automatic save can be considered later; it is not needed to demonstrate both workflows.

The write capability must explicitly represent its human-required commit boundary. Discovery must record the real manual Save and verification; artifact construction must not turn that manual action into an unattended click. Implementing this second capability therefore requires validating the explicit intervention-step support described as an extension point in the artifact design. It is a planned addition, not a claim that the current engine already supports it.

The target persists contact changes and shows a UI-visible change reference tied to the member/field, sufficient for verification. It does not send emails or change credentials. Test setup may inspect the synthetic store to assert one change; the automation verifies through the UI.

Additional proof scenarios:

- Replay with a different member and new email using a separately discovered/saved write artifact.
- Invalid email is rejected with a clear business outcome and no stored change.
- Cancel at review leaves the old value intact; read back through the UI when demonstrating this.
- Save completes but its response is delayed/lost: inspect the member's value and current change reference; do not blindly click Save again. If attribution remains uncertain, keep the run paused or report `ACTION_OUTCOME_UNKNOWN`.
- Human saves and hands control back: verify the committed result and finish without a second Save.
- Unauthorized member/update attempt is blocked by the configured policy.

## Implementation order

1. Complete the balance capability end to end, including discovery, changed-input replay, failure evidence, and the minimal handoff mechanism.
2. Add the contact editor/review flow and explicit human commit step; discover a separate write capability and replay it with changed inputs.
3. Demonstrate an uncertain save outcome and prove that no duplicate commit occurs.

Share application screens and executor/targeting primitives. Separate saved capabilities keep each goal, parameter contract, and success condition clear. Avoid a subworkflow/composition engine solely to reuse the short search sequence.

## Decisions for review

- Balance lookup is the initial demo; confirm preferred-email update as the second capability and human Save as its default commit treatment.
- Confirm the proposed synthetic primary-savings convention and output contract.
- Set concrete time limits, compatible dependency versions, and hosted-browser connectivity during implementation planning; the primary stack is recorded in STACK.md.

The existing design examples remain illustrative. Implementation planning should replace them with the balance capability and then the separate write capability, while keeping their respective guarantees explicit.
