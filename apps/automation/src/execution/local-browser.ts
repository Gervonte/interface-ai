import { localBrowser, Stagehand } from '@browserbasehq/stagehand';
import type { Configuration } from './coordinator.js';
import { StagehandSurface } from './driver.js';
import { ExecutionError } from './errors.js';
import type { LocalSurface } from './local-replay.js';

/**
 * Opens a local Chrome for model-free replay. Only loopback targets are accepted: this path exists for local review and
 * development, not for reaching real institutions. Stagehand is given a model that refuses inference, as in hosted replay.
 */
export async function openLocalBrowser(configuration: Configuration, options: { headless?: boolean; executablePath?: string } = {}): Promise<LocalSurface> {
  const entry = new URL(configuration.target.entryPoint);
  if (!['127.0.0.1', 'localhost'].includes(entry.hostname) || !configuration.policy.allowedOrigins.includes(entry.origin)) throw new ExecutionError('POLICY_BLOCKED');
  const browser = await localBrowser.launch({ headless: options.headless ?? true, ...(options.executablePath ? { executablePath: options.executablePath } : {}) });
  let stagehand: Stagehand | undefined;
  try {
    stagehand = await Stagehand.create({ browser, selfHeal: false, cache: false, logging: { level: 'off' },
      model: { generate: async () => { throw new Error('INFERENCE_FORBIDDEN'); } } });
    const page = await browser.context.newPage(); await page.goto('about:blank', { timeout: 10_000, waitUntil: 'domcontentloaded' });
    const owned = stagehand;
    return { surface: new StagehandSurface(page), close: async () => { try { await owned.close(); } finally { await browser.close(); } } };
  } catch (error) {
    try { await stagehand?.close(); } finally { await browser.close(); }
    throw error instanceof ExecutionError ? error : new ExecutionError('SESSION_LOST');
  }
}
