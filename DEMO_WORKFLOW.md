# Demo Workflow

Status: the target is a fictional credit-union staff servicing console. Balance lookup is the agreed assessment baseline; preferred-email maintenance remains planned follow-on work. INT-001 supplies app shells. INT-002 adds a separate small staff-shell/iframe/table compatibility fixture for SDK validation; the full portal screens and workflows below are not implemented yet. See [Browserbase setup](BROWSERBASE_SETUP.md).

## Target purpose and assessment fit

Build **Demo Credit Union — Staff Services**, a fictional internal back-office console used by a staff operator to find members, inspect accounts, and maintain contact details. Use coherent staff context, connected member/account records, and realistic runtime states. The automation operator console remains a separate application; SDK status and automation task cards belong there rather than in the target's normal staff workflow.

Assignment sections 1, 3.1, 3.3, and 4 motivate a non-trivial live UI with stable screens, runtime exceptions, and credible legacy-surface constraints. The specific screens, labels, synthetic fields, and layout below are our chosen simulation, not additional assignment mandates or a reproduction of a real vendor product.

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

1. Start in the staff workspace, open Member Search, and enter the invocation's member ID.
2. Submit the search and wait for a result associated with that ID.
3. Open the matching result; verify the member ID in the overview and persistent active-member context.
4. Open Account Inquiry for the active member; identify the designated primary savings row among checking and savings accounts.
5. Open the row designated as primary savings.
6. On Account Details, verify member ID, account ID/type, primary designation, and account status; read the explicitly labeled Current Balance and currency, without confusing it with Available Balance.
7. Return typed outputs only after the identity checks and output validation pass.

Multiple account rows can each contain an Open button. Replay must scope the control to the correct row rather than use row order. Both member and account identifiers are extracted from the UI; copying invocation inputs into the output is not proof that the correct record was opened.

A fresh browser session enters a synthetic staff session with a fictional operator identifier, branch context, and role. Session-expiry scenarios interrupt that same workspace and provide a supported manual restoration path. Real credentials, production identity management, money movement, and account creation remain outside scope. A disallowed action/domain can be tested at the execution boundary without building a transfer feature.

## Portal screens and transitions

| Screen | Staff-visible content and controls | Transition / verification |
| --- | --- | --- |
| **Staff workspace** | Fictional institution header, operator/branch/role context, session status, navigation, and an active-member area initially empty. | Member Search is usable; member-specific inquiry/maintenance requires an active member. |
| **Member Search** | Member ID field, Search/Clear controls, results table with member ID, synthetic name, membership status, and Open control; loading, validation, and no-match states. | Search results identify the submitted ID; Open establishes the selected member context. |
| **Member Overview** | Persistent member ID/name/status, concise account summary, a servicing notice area, and Account Inquiry navigation. Contact Maintenance is added with the write workflow. | Overview and active-member header agree. Starting another search clears the old context before new results can be selected. |
| **Account Inquiry** | Table of account ID, product/type, primary designation, status, Current Balance, Available Balance, currency, and repeated Open controls. | Select the primary savings row by observed identity/attributes, not by position. |
| **Account Details** | Member ID, account ID/type/status, primary designation, separately labeled Current Balance and Available Balance, currency, and Back to Accounts. | Detail identity matches the selected member/account; only validated Current Balance feeds the baseline output. |
| **Contact Maintenance** *(follow-on)* | Existing preferred email, editable new value, field validation, Review and Cancel; review shows member plus before/after values, followed by Save/Cancel and a change reference. | Verify member/value before human Save; reopen the record to verify the persisted change. |

Use this baseline path: **Staff workspace → Member Search → Member Overview → Account Inquiry → Account Details**. Back navigation preserves the current member where appropriate. Clear/new search removes it so stale account details cannot be mistaken for a new member's results. Menu entries must lead to implemented screens; defer unrelated modules rather than populate a large inert menu.

## Portal layout and automation surface

Build with React + Vite and Mantine, using compact forms, dense account tables, consistent navigation, and persistent member/session context. The target should read as a staff work tool. Loading indicators, errors, and notices appear where staff encounter them in the workflow. Keep developer diagnostics and scenario setup outside the normal target screen.

Use an outer staff shell and an actual framed member-servicing workspace. Put search/overview/account content inside the frame and make the frame boundary discoverable through observed UI structure. An iframe placed around otherwise unrelated content is not sufficient: the demonstrated flow must traverse the workspace and its repeated row controls.

Keep stable layout and user-facing terminology across baseline runs. Provide visible labels, headings, table headers, and meaningful identifiers. Test IDs, Mantine-generated IDs/classes, absolute DOM positions, and the automation's fixture knowledge must not be required for targeting. The frame/table structure supplies realistic scoping problems without making the app randomly hostile or intentionally inaccessible.

The portal is distinct from the automation operator UI. Claim/Resume and capability/run status live in the operator application; staff member/account controls live in the target. A human takeover operates this same target session, preserving the selected member and current screen.

Keep synthetic member/account data in the target's own backend/database. The React app may call its internal application endpoints; discovery and replay operate its UI and cannot call those endpoints or read its database/fixtures to obtain business results. Fixture seeding/reset and scenario injection are separate setup operations.

## Fixtures and business outcomes

| Member input | Target state | Expected caller result |
| --- | --- | --- |
| `M1001` | Checking plus primary savings `S2001`, current balance USD 1,250.34, available balance USD 1,200.34 | Success with `currentBalanceMinor: 125034`. Used for live discovery. |
| `M1002` | Differently ordered accounts; primary savings `S2002`, current balance USD 87.65, available balance USD 76.00 | Same artifact succeeds with `currentBalanceMinor: 8765`. Used to prove reuse. |
| `M1003` | Member exists with no primary savings account | Declared `NO_PRIMARY_SAVINGS_ACCOUNT` business outcome. |
| `M1004` | Explicit account-access denial in the UI | Declared `ACCESS_DENIED` business outcome. |
| `M9999` | Explicit no matching member response for the submitted ID | Declared `MEMBER_NOT_FOUND` business outcome. |

Include membership/account status and fictional staff/branch identifiers as contextual data. Use clearly synthetic names such as Test Member A; omit unnecessary addresses, dates of birth, and contact information. The proposed email-update capability adds only synthetic contact values such as member-a@example.test, with no email delivery or connection to real accounts. Outcome detection must use the explicit current UI response. Failure to find a search box or load a frame is an automation failure, not `MEMBER_NOT_FOUND`.

## Reproducible exceptional scenarios

Apply scenario flags during test/demo setup, independently of invocation inputs. Reset each run to a documented starting fixture. The automation sees their effects only through the UI.

| Scenario | UI behavior | Automation behavior to prove |
| --- | --- | --- |
| Slow response | Member Search or Account Inquiry shows a loading state; completion belongs to the submitted member ID. | Bounded wait; no duplicate search/click and no stale-result success. |
| Known interstitial | A specifically identified servicing notice blocks navigation with a permitted acknowledgment control. | Apply only the declared dismissal/recovery rule and verify the next state. |
| Unexpected modal | An unhandled servicing dialog blocks opening account details. | Request intervention; a human acts on the actual dialog in the same session, followed by validated hand-back. |
| Synthetic staff-session expiry | Workspace shows an expired-session screen while the browser stays live; provide a permitted manual restoration control for the synthetic operator. | Restore through UI, preserve the run/session, and revalidate member/account context before continuing. |
| Failed load | Account Inquiry/details shows an explicit service error or remains loading beyond the configured deadline. | Clear bounded failure/recovery with step context and safe richer evidence. |
| UI validation | Invalid member search shows a field error; the later contact editor rejects an invalid synthetic email without saving. | Distinguish target validation from invocation-schema rejection and prevent blind resubmission. |
| Member not found | Search explicitly reports no matching member for the submitted ID. | Return MEMBER_NOT_FOUND; do not confuse an unloaded/missing control with this business outcome. |
| Permission denied | Member selection is valid, but Account Inquiry displays an explicit access-denied state for the staff role/member scenario. | Declared ACCESS_DENIED outcome; no credential/privilege workaround. |
| No primary savings | Account Inquiry loads valid accounts but explicitly shows no designated primary savings account. | Declared NO_PRIMARY_SAVINGS_ACCOUNT outcome after checking the correct member. |
| Duplicate/wrong record | Duplicate eligible account controls, inconsistent active-member identity, or mismatched detail data is injected. | No arbitrary row selection or false success; surface ambiguity/verification failure. |

The unexpected modal's manual dismissal is an ordinary permitted UI action. It is not an approval granting permission to move money or override policy. Record the real manual action and resume checkpoint; a simulated run-status change alone is insufficient.

The implementation can stage these scenarios, with happy path, changed-input replay, not-found, one bounded recovery/failure, and real modal takeover first. Remaining applicable conditions still need coverage before the acceptance checklist is declared complete.

## Portal completion checks

INT-006 supplies the staff shell, connected balance screens, baseline fixture-backed transitions, and ordinary loading/empty/validation states. INT-012 adds controlled exception injection and restoration behaviors; INT-013–INT-016 verify automation responses. Contact Maintenance belongs to INT-018 and does not gate the balance baseline.

A generic single search card or a page containing expected test outputs is not a completed portal. Before calling INT-006 complete, a person must navigate the full staff workflow for both baseline members, see their consistent member/account context, distinguish current from available balances, and return/search again without stale data. INT-001 remains a completed scaffold task and supplies no proof that these portal checks pass.

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

1. Complete the balance assessment baseline: real discovery, changed-input replay, business outcomes/recovery/failure, human takeover during discovery and replay, safe evidence, README, and report. Required criteria must pass.
2. Add the contact editor/review flow and explicit human commit step as planned follow-on work; discover a separate write capability and replay it with changed inputs. This does not block baseline readiness.
3. Demonstrate an uncertain save outcome and prove that no duplicate commit occurs. Deeper automatic restart-recovery machinery remains a separate follow-on; safe stopping and no blind resubmission are baseline behavior.

Share application screens and executor/targeting primitives. Separate saved capabilities keep each goal, parameter contract, and success condition clear. Avoid a subworkflow/composition engine solely to reuse the short search sequence.

## Decisions for review

- Balance lookup is the initial demo; confirm preferred-email update as the second capability and human Save as its default commit treatment.
- Verify the synthetic primary-savings convention, member/account context, and Current Balance extraction against the portal screens.
- Set concrete time limits, compatible dependency versions, and hosted-browser connectivity during implementation planning; the primary stack is recorded in STACK.md.

The existing design examples remain illustrative. Implementation planning should replace them with the balance capability and then the separate write capability, while keeping their respective guarantees explicit.
