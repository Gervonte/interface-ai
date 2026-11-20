import { discoveryModelName } from '../workflows/model.js';
import { browserbase, Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { StagehandSurface } from './driver.js';
import type { SessionFactory, Configuration } from './coordinator.js';
import { ExecutionError } from './errors.js';
import { GatewayPlanner } from '../workflows/planner.js';

export class BrowserbaseSessions implements SessionFactory {
  inferenceAttempts = 0;
  lastMetrics: Record<string, number> = {};
  finalStatus = 'UNKNOWN';
  constructor(private readonly apiKey: string, private readonly projectId: string) { z.uuid().parse(projectId); if (!apiKey) throw new Error('Missing provider configuration'); }
  private async status(id: string) {
    const response = await fetch(`https://api.browserbase.com/v1/sessions/${z.uuid().parse(id)}`, { headers: { 'X-BB-API-Key': this.apiKey }, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('Provider status unavailable');
    return z.object({ status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'ERROR', 'TIMED_OUT']) }).parse(await response.json()).status;
  }
  async reconcile(id: string) {
    this.finalStatus = await this.status(id);
    if (['COMPLETED', 'ERROR', 'TIMED_OUT'].includes(this.finalStatus)) return true;
    const response = await fetch(`https://api.browserbase.com/v1/sessions/${z.uuid().parse(id)}`, { method: 'POST', headers: { 'X-BB-API-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: this.projectId, status: 'REQUEST_RELEASE' }), signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) return false;
    for (let attempt = 0; attempt < 8; attempt++) {
      this.finalStatus = await this.status(id); if (['COMPLETED', 'ERROR', 'TIMED_OUT'].includes(this.finalStatus)) return true;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  }
  validate(configuration: Configuration) {
    const url = new URL(configuration.target.entryPoint);
    if (url.protocol !== 'https:' || ['localhost','127.0.0.1'].includes(url.hostname)) throw new ExecutionError('POLICY_BLOCKED');
    if (configuration.policy.budgets.overallTimeoutMs > 1_800_000) throw new ExecutionError('BUDGET_EXHAUSTED');
  }
  async open(configuration: Configuration, onCreated: (id: string) => Promise<void>, signal: AbortSignal, mode: 'discovery' | 'replay' = 'replay') {
    if (signal.aborted) throw new ExecutionError('CANCELLED');
    this.validate(configuration);
    const url = new URL(configuration.target.entryPoint);
    if (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) throw new ExecutionError('POLICY_BLOCKED');
    const timeout = Math.ceil(configuration.policy.budgets.overallTimeoutMs / 1000);
    if (timeout > 1800) throw new ExecutionError('BUDGET_EXHAUSTED');
    const browser = await browserbase.launch({ apiKey: this.apiKey, projectId: this.projectId, region: 'us-west-2', api_timeout: timeout, keepAlive: false,
      browserSettings: { allowedDomains: [url.hostname], logSession: false, recordSession: false, solveCaptchas: false, viewport: { width: 1440, height: 1000 } }, clientOptions: { timeout: 30_000, maxRetries: 0 } });
    let stagehand: Stagehand | undefined;
    try {
      const id = z.uuid().parse(browser.sessionId); await onCreated(id); if (signal.aborted) throw new ExecutionError('CANCELLED');
      let attempts = 0;
      stagehand = await Stagehand.create({ browser, selfHeal: false, cache: false, logging: { level: 'off' },
        model: mode === 'discovery' ? { modelName: discoveryModelName } : { generate: async () => { attempts++; this.inferenceAttempts++; throw new Error('INFERENCE_FORBIDDEN'); } } });
      const page = await browser.context.newPage(); await page.goto('about:blank', { timeout: 10_000, waitUntil: 'domcontentloaded' });
      const planner = mode === 'discovery' ? new GatewayPlanner(stagehand, async () => {
        // Keep model preparation independent of target routes, cookies, and staff context.
        const helper = await browser.context.newPage();
        await helper.goto('about:blank', { timeout: 10_000, waitUntil: 'domcontentloaded' });
        if (await helper.url() !== 'about:blank') throw new ExecutionError('POLICY_BLOCKED');
        return helper;
      }) : undefined;
      let closePromise: Promise<boolean> | undefined;
      let metrics: Record<string, number> = {};
      let finalStatus = 'UNKNOWN';
      return { id, surface: new StagehandSurface(page), ...(planner ? { planner } : {}),
        statistics: () => ({ mode, modelCalls: planner?.calls ?? 0, inferenceAttempts: attempts,
          inputTokens: metrics.totalPromptTokens ?? 0, outputTokens: metrics.totalCompletionTokens ?? 0, finalStatus }),
        close: () => closePromise ??= (async () => {
          try { if (stagehand) metrics = this.lastMetrics = { ...await stagehand.metrics() }; await stagehand?.close(); }
          finally { await browser.close(); }
          const closed = await this.reconcile(id); finalStatus = this.finalStatus; return closed;
        })() };
    } catch {
      try { await stagehand?.close(); } finally { await browser.close(); }
      throw new ExecutionError('SESSION_LOST');
    }
  }
}
