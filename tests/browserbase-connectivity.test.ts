import { describe, expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { readBrowserbaseConfig } from '../apps/automation/src/browserbase/config.js';
import { checkHostedFixture } from '../apps/automation/src/browserbase/check.js';

const env = {
  BROWSERBASE_API_KEY: 'synthetic-secret-marker',
  BROWSERBASE_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
  BROWSERBASE_FIXTURE_URL: 'https://synthetic-fixture.trycloudflare.com/compatibility',
};
const config = readBrowserbaseConfig(env);
const sessionId = '22222222-2222-4222-8222-222222222222';
function dependencies() {
  const browser = {
    sessionId,
    loadFixture: vi.fn(async () => ({
      title: 'Demo Credit Union — Staff Services', heading: 'Staff workspace',
      frameTitle: 'Member servicing workspace', workspaceHeading: 'Member servicing',
      accountRows: 2, openControls: 2,
    })),
    close: vi.fn(async () => {}),
  };
  return {
    browser,
    launch: vi.fn(async () => browser),
    getStatus: vi.fn(async () => 'COMPLETED'),
    probeHealth: vi.fn(async () => {}),
    emit: vi.fn(),
    healthIntervalMs: 5,
    statusIntervalMs: 1,
  };
}

describe('Browserbase configuration boundary', () => {
  it('rejects missing credentials without echoing values', () => {
    expect(() => readBrowserbaseConfig({ ...env, BROWSERBASE_PROJECT_ID: 'synthetic-secret-marker' }))
      .toThrow('Check BROWSERBASE_PROJECT_ID');
    try { readBrowserbaseConfig({ ...env, BROWSERBASE_PROJECT_ID: 'synthetic-secret-marker' }); }
    catch (error) { expect(String(error)).not.toContain('synthetic-secret-marker'); }
  });
  it.each([
    'not-a-url', 'http://example.com/compatibility', 'https://127.0.0.1/compatibility',
    'https://[::1]/compatibility', 'https://fixture.local/compatibility',
    'https://localhost/compatibility', 'https://example.com:3001/compatibility',
    'https://example.com/compatibility?key=synthetic-secret-marker',
    'https://user:synthetic-secret-marker@example.com/compatibility',
    'https://example.com/compatibility#secret', 'https://example.com/other',
  ])('rejects unsafe or incorrect fixture URL %s', (url) => {
    expect(() => readBrowserbaseConfig({ ...env, BROWSERBASE_FIXTURE_URL: url })).toThrow('Check BROWSERBASE_FIXTURE_URL');
  });
});

describe('hosted connectivity lifecycle (fake provider, no live evidence)', () => {
  it('samples health during remote work and verifies completed status after close', async () => {
    const deps = dependencies();
    deps.browser.loadFixture.mockImplementationOnce(async () => {
      await delay(30);
      return { title: 'fixture', heading: 'shell', frameTitle: 'workspace', workspaceHeading: 'member', accountRows: 2, openControls: 2 };
    });
    deps.getStatus.mockResolvedValueOnce('RUNNING').mockResolvedValueOnce('COMPLETED');
    const result = await checkHostedFixture(config, deps);
    expect(result.success).toBe(true);
    expect(result.finalStatus).toBe('COMPLETED');
    expect(result.health.checks).toBeGreaterThan(2);
    expect(deps.browser.close).toHaveBeenCalledOnce();
    expect(deps.browser.close.mock.invocationCallOrder[0]).toBeLessThan(deps.getStatus.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(result)).not.toContain(env.BROWSERBASE_API_KEY);
  });
  it('closes the created session even when fixture verification throws a sensitive error', async () => {
    const deps = dependencies();
    deps.browser.loadFixture.mockRejectedValueOnce(new Error('synthetic-secret-marker'));
    const result = await checkHostedFixture(config, deps);
    expect(result.success).toBe(false);
    expect(result.failurePhase).toBe('fixture');
    expect(result.finalStatus).toBe('COMPLETED');
    expect(deps.browser.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(result) + JSON.stringify(deps.emit.mock.calls)).not.toContain(env.BROWSERBASE_API_KEY);
  });
  it('does not mistake a release request for verified session termination', async () => {
    const deps = dependencies();
    deps.getStatus.mockResolvedValue('RUNNING');
    const result = await checkHostedFixture(config, deps);
    expect(result.success).toBe(false);
    expect(result.failurePhase).toBe('termination');
    expect(deps.getStatus).toHaveBeenCalledTimes(8);
  });
  it('reports cleanup failures even if the provider later completes the session', async () => {
    const deps = dependencies();
    deps.browser.close.mockRejectedValueOnce(new Error('synthetic-secret-marker'));
    const result = await checkHostedFixture(config, deps);
    expect(result.success).toBe(false);
    expect(result.failurePhase).toBe('cleanup');
    expect(result.closeSucceeded).toBe(false);
  });
  it('does not create a paid session when the automation API fails its initial health check', async () => {
    const deps = dependencies();
    deps.probeHealth.mockRejectedValue(new Error('unavailable'));
    const result = await checkHostedFixture(config, deps);
    expect(result.failurePhase).toBe('health');
    expect(deps.launch).not.toHaveBeenCalled();
  });
  it('fails when the API becomes unresponsive while the remote operation runs', async () => {
    const deps = dependencies();
    deps.probeHealth.mockResolvedValueOnce().mockRejectedValue(new Error('unavailable'));
    const result = await checkHostedFixture(config, deps);
    expect(result.success).toBe(false);
    expect(result.failurePhase).toBe('health');
    expect(deps.browser.close).toHaveBeenCalledOnce();
  });
});
