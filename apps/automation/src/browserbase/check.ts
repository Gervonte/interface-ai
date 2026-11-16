import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { BrowserbaseConfig } from './config.js';
import { browserbaseSettings } from './config.js';

export interface FixtureSummary {
  title: string;
  heading: string;
  frameTitle: string;
  workspaceHeading: string;
  accountRows: number;
  openControls: number;
}
export interface HostedFixtureBrowser {
  sessionId: string;
  loadFixture(): Promise<FixtureSummary>;
  close(): Promise<void>;
}
interface Dependencies {
  launch(config: BrowserbaseConfig): Promise<HostedFixtureBrowser>;
  getStatus(config: BrowserbaseConfig, sessionId: string): Promise<string>;
  probeHealth(): Promise<void>;
  emit(event: { event: string; sessionId?: string }): void;
  healthIntervalMs?: number;
  statusIntervalMs?: number;
}

export async function checkHostedFixture(config: BrowserbaseConfig, dependencies: Dependencies) {
  const startedAt = new Date().toISOString();
  let browser: HostedFixtureBrowser | undefined;
  let fixture: FixtureSummary | undefined;
  let phase = 'health';
  let failurePhase: string | undefined;
  let closeSucceeded = false;
  let finalStatus = 'UNKNOWN';
  let healthChecks = 0;
  let healthFailures = 0;
  let maxHealthLatencyMs = 0;
  const probe = async () => {
    const start = performance.now();
    try { await dependencies.probeHealth(); }
    catch { healthFailures++; }
    healthChecks++;
    maxHealthLatencyMs = Math.max(maxHealthLatencyMs, Math.ceil(performance.now() - start));
  };
  let pendingProbe: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    await probe();
    if (healthFailures) throw new Error('Automation API is not healthy.');
    timer = setInterval(() => {
      if (pendingProbe) return;
      pendingProbe = probe().finally(() => { pendingProbe = undefined; });
    }, dependencies.healthIntervalMs ?? 250);
    phase = 'launch';
    browser = await dependencies.launch(config);
    // Never let an unexpected provider value turn into an unsafe log field.
    z.uuid().parse(browser.sessionId);
    dependencies.emit({ event: 'session_created', sessionId: browser.sessionId });
    phase = 'fixture';
    fixture = await browser.loadFixture();
    dependencies.emit({ event: 'fixture_loaded' });
  } catch {
    failurePhase = phase;
  } finally {
    if (browser) {
      try {
        await browser.close();
        closeSucceeded = true;
        dependencies.emit({ event: 'session_close_requested' });
      } catch { failurePhase ??= 'cleanup'; }
      // Provider status can lag the release response. Bound retries, then report uncertainty.
      try {
        for (let attempt = 0; attempt < 8; attempt++) {
          finalStatus = await dependencies.getStatus(config, browser.sessionId);
          if (['COMPLETED', 'ERROR', 'TIMED_OUT'].includes(finalStatus)) break;
          if (attempt < 7) await delay(dependencies.statusIntervalMs ?? 500);
        }
        if (finalStatus !== 'COMPLETED') failurePhase ??= 'termination';
      } catch { failurePhase ??= 'termination'; }
    }
    clearInterval(timer);
    await pendingProbe;
    await probe();
  }
  if (healthFailures || maxHealthLatencyMs > 2000) failurePhase ??= 'health';
  return {
    task: 'INT-002',
    success: !failurePhase && closeSucceeded && finalStatus === 'COMPLETED',
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(failurePhase ? { failurePhase } : {}),
    ...(browser && z.uuid().safeParse(browser.sessionId).success ? { sessionId: browser.sessionId } : {}),
    fixtureUrl: config.fixtureUrl,
    ...browserbaseSettings,
    modelGateway: 'configured; inference verification belongs to INT-003',
    selfHeal: false,
    providerRecording: false,
    providerLogging: false,
    ...(fixture ? { fixture } : {}),
    closeSucceeded,
    finalStatus,
    health: { checks: healthChecks, failures: healthFailures, maxLatencyMs: maxHealthLatencyMs },
  };
}
