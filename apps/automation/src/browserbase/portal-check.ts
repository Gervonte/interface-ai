import { browserbase, Stagehand } from '@browserbasehq/stagehand';
import type { Page } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readBrowserbaseConfig, browserbaseSettings } from './config.js';
import { getHostedSessionStatus } from './provider.js';
import { usdMinor } from './fixture-ui.js';

// Target QA only: authored UI checks, not capability discovery or production replay.
const frame = 'iframe[title="Member servicing workspace"] >> ';
const button = (name: string) => frame + `xpath=//button[normalize-space()="${name}"]`;
const stateSchema = z.object({ heading: z.string(), text: z.string(), parentMember: z.string(), member: z.string(),
  details: z.record(z.string(), z.string()), rows: z.array(z.array(z.string())), result: z.string() });
async function state(page: Page) {
  return stateSchema.parse(await page.evaluate(`(() => {
    const doc = document.querySelector('iframe[title="Member servicing workspace"]')?.contentDocument;
    const fields = (region) => Object.fromEntries([...(region?.querySelectorAll('dt') ?? [])].map(term => [term.textContent.trim(), term.nextElementSibling?.innerText ?? '']));
    return { heading: doc?.querySelector('h1')?.innerText ?? '', text: doc?.body.innerText ?? '',
      parentMember: fields(document.querySelector('section[aria-label="Active member"]'))['Member ID'] ?? '',
      member: fields(doc?.querySelector('section[aria-label="Active member"]'))['Member ID'] ?? '',
      details: fields(doc?.querySelector('section[aria-label="Account Details"]')),
      rows: [...(doc?.querySelectorAll('table tbody tr') ?? [])].map(row => [...row.querySelectorAll('th,td')].map(cell => cell.innerText)),
      result: fields(doc?.querySelector('.searched-id'))['Searched Member ID'] ?? '' };
  })()`));
}
async function wait(page: Page, heading: string, member = '', text = '') {
  await page.waitForFunction(`({heading,member,text}) => {
    const doc = document.querySelector('iframe[title="Member servicing workspace"]')?.contentDocument;
    if (!doc || doc.querySelector('h1')?.innerText !== heading || doc.body.innerText.includes('Loading ')) return false;
    const term = [...doc.querySelectorAll('section[aria-label="Active member"] dt')].find(el => el.textContent.trim() === 'Member ID');
    return (term?.nextElementSibling?.innerText ?? '') === member && doc.body.innerText.includes(text);
  }`, { heading, member, text }, { timeout: 15_000 });
}
async function click(page: Page, selector: string) {
  const control = page.locator(selector);
  if (await control.count({ timeout: 5000 }) !== 1 || !await control.isVisible({ timeout: 5000 })) throw new Error('Absent or ambiguous UI control');
  await control.click({ timeout: 5000 });
}
async function search(page: Page, id: string) {
  await click(page, 'xpath=//nav[@aria-label="Staff navigation"]//button[normalize-space()="Member Search"]');
  await wait(page, 'Member Search', '', 'Awaiting search');
  const clean = await state(page);
  if (clean.member || clean.parentMember || clean.details['Account ID']) throw new Error('Old member context retained');
  await page.locator(frame + 'form[aria-label="Member Search"] input[name="memberId"]').fill(id, { timeout: 5000 });
  await click(page, button('Search'));
  await wait(page, 'Member Search', '', id === 'M9999' ? 'No matching member' : '1 member found');
  if ((await state(page)).result !== id) throw new Error('Wrong search result');
}
async function inquiry(page: Page, id: string) {
  await search(page, id);
  await click(page, frame + `xpath=//table[caption[normalize-space()="Member search results"]]/tbody/tr[th[normalize-space()="${id}"]]//button[normalize-space()="Open"]`);
  await wait(page, 'Member Overview', id, 'Account summary');
  await page.waitForFunction(`id => [...document.querySelectorAll('section[aria-label="Active member"] dd')].some(el => el.innerText === id)`, id, { timeout: 5000 });
  await click(page, button('Account Inquiry'));
  await wait(page, 'Account Inquiry', id);
}
async function main() {
  // Reuse the public HTTPS/credential validation, requiring the portal root instead of /compatibility.
  const root = process.env.BROWSERBASE_PORTAL_URL?.replace(/\/$/, '');
  const config = readBrowserbaseConfig({ ...process.env, BROWSERBASE_FIXTURE_URL: root ? root + '/compatibility' : undefined });
  const url = new URL(config.fixtureUrl); url.pathname = '/';
  const directory = resolve(import.meta.dirname, '../../runtime/int-006'); await mkdir(directory, { recursive: true });
  const result: Record<string, unknown> = { task: 'INT-006', kind: 'authored-portal-UI-verification', startedAt: new Date().toISOString(),
    portalUrl: url.toString(), selfHeal: false, cache: false, providerRecording: false, providerLogging: false, inferenceAttempts: 0, success: false };
  let browser: Awaited<ReturnType<typeof browserbase.launch>> | undefined; let stagehand: Stagehand | undefined;
  let phase = 'launch'; let attempts = 0;
  try {
    browser = await browserbase.launch({ apiKey: config.apiKey, projectId: config.projectId, region: browserbaseSettings.region,
      api_timeout: 300, keepAlive: false, browserSettings: { allowedDomains: [url.hostname], logSession: false, recordSession: false,
        solveCaptchas: false, viewport: { width: 1440, height: 1000 } }, clientOptions: { timeout: 30_000, maxRetries: 0 } });
    result.sessionId = z.uuid().parse(browser.sessionId);
    stagehand = await Stagehand.create({ browser, selfHeal: false, cache: false, logging: { level: 'off' },
      model: { generate: async () => { attempts++; throw new Error('INFERENCE_FORBIDDEN'); } } });
    const page = await browser.context.newPage(); phase = 'navigation';
    const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (!response?.ok() || await page.url() !== url.toString()) throw new Error('Portal navigation failed or redirected');
    await wait(page, 'Staff workspace');
    const verified = [];
    for (const [id, accountId, current, available, order] of [
      ['M1001', 'S2001', 125034, 120034, ['C3001', 'S2001']], ['M1002', 'S2002', 8765, 7600, ['S2002', 'C3002']],
    ] as const) {
      phase = id + '-inquiry'; await inquiry(page, id);
      const accounts = await state(page);
      if (JSON.stringify(accounts.rows.map(row => row[0])) !== JSON.stringify(order)) throw new Error('Incorrect account order');
      if (await page.locator(frame + 'xpath=//table[caption[normalize-space()="Member accounts"]]//button[normalize-space()="Open"]').count({ timeout: 3000 }) !== 2) throw new Error('Expected repeated Open controls');
      if (id === 'M1001') await writeFile(resolve(directory, 'account-inquiry.png'), await page.screenshot({ type: 'png' }), { mode: 0o600 });
      phase = id + '-details';
      await click(page, frame + 'xpath=//table[caption[normalize-space()="Member accounts"]]/tbody/tr[td[normalize-space()="Primary Savings"] and td[normalize-space()="Primary"]]//button[normalize-space()="Open"]');
      await wait(page, 'Account Details', id, accountId); const detail = await state(page); const data = detail.details;
      if (detail.parentMember !== id || data['Member ID'] !== id || data['Account ID'] !== accountId || data['Account Type'] !== 'Primary Savings'
        || data['Designation'] !== 'Primary' || data['Status'] !== 'ACTIVE' || data['Currency'] !== 'USD'
        || usdMinor(data['Current Balance'] ?? '') !== current || usdMinor(data['Available Balance'] ?? '') !== available) throw new Error('Wrong detail identity or balance');
      verified.push({ memberId: id, accountId, currentBalanceMinor: current, availableBalanceMinor: available, currency: 'USD', accountOrder: order });
      await writeFile(resolve(directory, id + '-details.png'), await page.screenshot({ type: 'png' }), { mode: 0o600 });
      await click(page, button('Back to Accounts')); await wait(page, 'Account Inquiry', id);
      if ((await state(page)).parentMember !== id) throw new Error('Back lost active member');
    }
    result.verifiedBalances = verified; result.backPreservedContext = true; result.newSearchClearedContext = true;
    phase = 'no-primary-savings'; await inquiry(page, 'M1003'); await wait(page, 'Account Inquiry', 'M1003', 'No primary savings account');
    phase = 'access-denied'; await inquiry(page, 'M1004'); await wait(page, 'Account Inquiry', 'M1004', 'Access denied');
    phase = 'no-matching-member'; await search(page, 'M9999');
    phase = 'validation'; await click(page, button('Clear')); await wait(page, 'Member Search', '', 'Awaiting search');
    await click(page, button('Search')); await wait(page, 'Member Search', '', 'Enter a member ID in the format M1234.');
    result.negativeStates = ['no_primary_savings', 'access_denied', 'no_matching_member', 'invalid_member_id'];
    result.modelMetrics = await stagehand.metrics();
    if (attempts !== 0 || Object.values(await stagehand.metrics()).some(value => value !== 0)) throw new Error('Unexpected inference');
    result.success = true;
  } catch { result.failurePhase = phase; }
  finally {
    result.inferenceAttempts = attempts;
    try { await stagehand?.close(); } catch { result.success = false; result.closeFailure = true; }
    try { await browser?.close(); } catch { result.success = false; result.closeFailure = true; }
    if (browser && typeof result.sessionId === 'string') {
      try {
        for (let i = 0; i < 8; i++) {
          result.finalStatus = await getHostedSessionStatus(config, result.sessionId);
          if (['COMPLETED', 'TIMED_OUT', 'ERROR'].includes(String(result.finalStatus))) break;
          await delay(500);
        }
      } catch { result.finalStatus = 'UNKNOWN'; }
      if (result.finalStatus !== 'COMPLETED') result.success = false;
    }
    result.finishedAt = new Date().toISOString();
    await writeFile(resolve(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    console.info(JSON.stringify(result, null, 2)); if (!result.success) process.exitCode = 1;
  }
}
main().catch(() => { console.error('Portal check failed. Check server-only Browserbase credentials and BROWSERBASE_PORTAL_URL (public HTTPS root).'); process.exitCode = 1; });
