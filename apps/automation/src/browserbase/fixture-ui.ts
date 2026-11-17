import type { Action, Page } from '@browserbasehq/stagehand';
import { z } from 'zod';

const frame = 'iframe[title="Member servicing workspace"] >> ';
export const targets = {
  member: frame + 'form[action="/compatibility/workspace"] input[name="memberId"]',
  find: frame + 'button[type="submit"]',
  savings: frame + 'xpath=//table[caption[normalize-space()="Member accounts"]]/tbody/tr[td[normalize-space()="Primary Savings"] and td[normalize-space()="Primary"]]//button',
  checking: frame + 'xpath=//table[caption[normalize-space()="Member accounts"]]/tbody/tr[td[normalize-space()="Checking"]]//button',
  back: frame + 'a',
} as const;
export type Target = keyof typeof targets;
export const targetNames: Record<Target, string> = {
  member: 'Member ID', find: 'Find member', savings: 'Open Primary Savings', checking: 'Open Checking', back: 'Back to Account Inquiry',
};
export const actionSchema = z.strictObject({
  selector: z.string().min(1).max(4000),
  description: z.string().max(1000),
  method: z.enum(['fill', 'click']),
  arguments: z.array(z.string().max(100)).max(1).optional(),
});
export function parameterizeFill(action: unknown, memberId: 'M1001' | 'M1002') {
  const parsed = actionSchema.parse(action);
  if (parsed.method !== 'fill' || parsed.arguments?.length !== 1) throw new Error('Expected one member fill argument.');
  return { ...parsed, arguments: [memberId] };
}
export function usdMinor(value: string) {
  if (!/^\$(?:0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)\.\d{2}$/.test(value)) throw new Error('Invalid displayed USD amount.');
  const [whole, fraction] = value.slice(1).replaceAll(',', '').split('.');
  const amount = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(amount)) throw new Error('Amount exceeds supported range.');
  return amount;
}

const stateSchema = z.object({
  heading: z.string(), memberId: z.string(), input: z.string(),
  details: z.record(z.string(), z.string()),
  rows: z.array(z.array(z.string())),
});
export type FixtureState = z.infer<typeof stateSchema>;
export async function readFixture(page: Page): Promise<FixtureState> {
  // Read DOM visible to an operator, never target API/private application state.
  return stateSchema.parse(await page.evaluate(`(() => {
    const doc = document.querySelector('iframe[title="Member servicing workspace"]')?.contentDocument;
    const details = {};
    for (const term of doc?.querySelectorAll('dt') ?? []) details[term.innerText] = term.nextElementSibling?.innerText ?? '';
    return { heading: doc?.querySelector('h1')?.innerText ?? '', memberId: doc?.querySelector('.context strong')?.innerText ?? '',
      input: doc?.querySelector('form[action="/compatibility/workspace"] input[name="memberId"]')?.value ?? '', details,
      rows: [...(doc?.querySelectorAll('tbody tr') ?? [])].map(row => [...row.querySelectorAll('td')].map(cell => cell.innerText)) };
  })()`));
}
export async function waitForFixture(page: Page, heading: string, memberId: string) {
  await page.waitForFunction(`({heading, memberId}) => {
    const doc = document.querySelector('iframe[title="Member servicing workspace"]')?.contentDocument;
    return doc?.readyState === 'complete' && doc.querySelector('h1')?.innerText === heading
      && doc.querySelector('.context strong')?.innerText === memberId;
  }`, { heading, memberId }, { timeout: 10_000 });
  return readFixture(page);
}
export function verifiedBalance(state: FixtureState, memberId: string, accountId: string) {
  if (state.heading !== 'Account Details' || state.memberId !== memberId
    || state.details['Account ID'] !== accountId || state.details['Account Type'] !== 'Primary Savings'
    || state.details['Status'] !== 'Active') throw new Error('Wrong member, account, type, or detail screen.');
  return {
    memberId, accountId, currency: 'USD',
    currentBalanceMinor: usdMinor(state.details['Current Balance'] ?? ''),
    availableBalanceMinor: usdMinor(state.details['Available Balance'] ?? ''),
  };
}
export async function assertTarget(page: Page, proposed: Action, target: Target) {
  actionSchema.parse(proposed);
  const observed = page.locator(proposed.selector);
  const expected = page.locator(targets[target]);
  if (await observed.count({ timeout: 3000 }) !== 1 || await expected.count({ timeout: 3000 }) !== 1
    || !await observed.isVisible({ timeout: 3000 })) throw new Error('Target is absent, hidden, or ambiguous.');
  const actualPoint = await observed.centroid();
  const expectedPoint = await expected.centroid();
  if (Math.abs(actualPoint.x - expectedPoint.x) > 1 || Math.abs(actualPoint.y - expectedPoint.y) > 1) {
    throw new Error('Proposed target differs from the independently scoped fixture control.');
  }
}
export async function clickTarget(page: Page, target: Exclude<Target, 'member'>) {
  const locator = page.locator(targets[target]);
  if (await locator.count({ timeout: 3000 }) !== 1) throw new Error('Target absent or ambiguous.');
  await locator.click({ timeout: 5000 });
}
