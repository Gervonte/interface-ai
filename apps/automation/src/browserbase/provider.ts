import { browserbase, Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { browserbaseSettings as settings } from './config.js';
import type { BrowserbaseConfig } from './config.js';
import type { HostedFixtureBrowser } from './check.js';

const fixtureSummary = z.object({
  title: z.literal('Demo Credit Union — Staff Services'),
  heading: z.literal('Staff workspace'),
  frameTitle: z.literal('Member servicing workspace'),
  workspaceHeading: z.literal('Member servicing'),
  accountRows: z.literal(2),
  openControls: z.literal(2),
});

export async function launchHostedFixture(config: BrowserbaseConfig): Promise<HostedFixtureBrowser> {
  const browser = await browserbase.launch({
    apiKey: config.apiKey,
    projectId: config.projectId,
    region: settings.region,
    // SDK 2.27 names this api_timeout and serializes it as the API's timeout field.
    api_timeout: settings.sessionTimeoutSeconds,
    keepAlive: false,
    browserSettings: {
      allowedDomains: [new URL(config.fixtureUrl).hostname],
      logSession: false,
      recordSession: false,
      solveCaptchas: false,
      viewport: { width: 1440, height: 1000 },
    },
    clientOptions: { timeout: settings.requestTimeoutMs, maxRetries: 0 },
  });
  const sessionId = z.uuid().safeParse(browser.sessionId);
  if (!sessionId.success) {
    await browser.close();
    throw new Error('Provider did not return a valid session ID.');
  }
  let stagehand: Stagehand | undefined;
  return {
    sessionId: sessionId.data,
    async loadFixture() {
      stagehand = await Stagehand.create({
        browser,
        model: { modelName: settings.modelName },
        selfHeal: false,
        cache: false,
        logging: { level: 'off' },
      });
      const page = await browser.context.newPage();
      const response = await page.goto(config.fixtureUrl, {
        waitUntil: 'domcontentloaded', timeout: settings.navigationTimeoutMs,
      });
      if (!response?.ok() || await page.url() !== config.fixtureUrl) {
        throw new Error('Fixture navigation failed or redirected.');
      }
      // Reads rendered DOM only; no target module imports, APIs, or private app state.
      await page.waitForFunction(`(() => {
        const frame = document.querySelector('iframe[title="Member servicing workspace"]');
        const doc = frame?.contentDocument;
        return doc?.readyState === 'complete' && doc.querySelectorAll('tbody tr').length === 2;
      })()`, undefined, { timeout: settings.navigationTimeoutMs });
      const summary = await page.evaluate(`(() => {
        const frame = document.querySelector('iframe[title="Member servicing workspace"]');
        const doc = frame?.contentDocument;
        return {
          title: document.title,
          heading: document.querySelector('h1')?.innerText,
          frameTitle: frame?.title,
          workspaceHeading: doc?.querySelector('h1')?.innerText,
          accountRows: doc?.querySelectorAll('tbody tr').length,
          openControls: [...(doc?.querySelectorAll('tbody button') ?? [])].filter(button => button.innerText === 'Open').length
        };
      })()`);
      return fixtureSummary.parse(summary);
    },
    async close() {
      try { await stagehand?.close(); }
      finally { await browser.close(); }
    },
  };
}

const statusSchema = z.object({ status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'TIMED_OUT', 'ERROR']) });
export async function getHostedSessionStatus(config: BrowserbaseConfig, sessionId: string) {
  // Fixed provider URL. Never emit response bodies, authenticated URLs, or raw errors.
  const response = await fetch(`https://api.browserbase.com/v1/sessions/${z.uuid().parse(sessionId)}`, {
    headers: { 'X-BB-API-Key': config.apiKey },
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Unable to verify provider session status.');
  return statusSchema.parse(await response.json()).status;
}
