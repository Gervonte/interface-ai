import { describe, expect, it } from 'vitest';
import { BlockedContextSchema } from '@interface-ai/contracts';
import { describeStepFailure, failureSummary, sessionStartError } from '../apps/automation/src/execution/diagnostics.js';
import { ExecutionError } from '../apps/automation/src/execution/errors.js';

describe('actionable failure diagnostics', () => {
  it.each([[401, 'provider_auth'], [403, 'provider_auth'], [402, 'provider_usage_limit'], [429, 'provider_rate_or_concurrency_limit'], [404, 'provider_rejected']])(
    'classifies a definitive HTTP %i refusal as not created (%s) without retaining provider text', (status, category) => {
      const error = sessionStartError(Object.assign(new Error('synthetic-provider-text-marker'), { status }));
      expect(error).toMatchObject({ code: 'SESSION_NOT_CREATED', category });
      expect(JSON.stringify({ ...error, message: error.message })).not.toContain('synthetic-provider-text-marker');
    });
  it.each([new Error('timeout'), Object.assign(new Error('x'), { status: 503 }), 'opaque'])('keeps non-definitive start errors uncertain', error => {
    expect(sessionStartError(error).code).toBe('SESSION_START_UNCERTAIN');
  });
  it('passes through existing execution errors unchanged', () => {
    const original = new ExecutionError('POLICY_BLOCKED'); expect(sessionStartError(original)).toBe(original);
  });
  it('names the provider reason category in the not-created summary', () => {
    expect(failureSummary('SESSION_NOT_CREATED', 'provider_usage_limit')).toContain('(usage or plan limit)');
    expect(failureSummary('SESSION_NOT_CREATED')).toContain('No session was created and no model call or UI action ran.');
    expect(failureSummary('SESSION_NOT_CREATED', 'provider_unreachable')).toMatch(/could not be reached before session creation\. No session was created/);
  });
  it('describes identity mismatch and exhausted recovery as themselves, never as a timeout', () => {
    for (const code of ['IDENTITY_MISMATCH', 'RECOVERY_EXHAUSTED', 'CONFLICTING_SIGNALS', 'INVALID_EXTRACTION', 'READ_FAILED']) {
      const described = describeStepFailure(code, 'account-identity');
      expect(described.reason).not.toBe('STATE_TIMEOUT'); expect(described.observed.code).toBe(code);
      expect(described.observed.description).toContain('Rule: account-identity.');
      expect(BlockedContextSchema.safeParse({ stepId: 'step-007', actionIndex: null, ...described, dispatchState: 'not_sent', effectState: 'not_checked', checkpointId: null, evidenceIds: [] }).success).toBe(true);
    }
    expect(describeStepFailure('IDENTITY_MISMATCH').expected.code).toBe('RECORD_IDENTITY_MATCH');
    expect(describeStepFailure('STATE_TIMEOUT').reason).toBe('STATE_TIMEOUT');
  });
  it('falls back to a code-bearing summary for unmapped codes', () => {
    expect(failureSummary('SOMETHING_NEW')).toContain('(SOMETHING_NEW)');
  });
});

describe('declared risky-control policy', () => {
  it('loads the committed baseline policy with risky controls blocked', async () => {
    const { loadConfigurations } = await import('../apps/automation/src/db/repository.js');
    const config = await loadConfigurations({ target: new URL('../apps/automation/config/target.v3.json', import.meta.url), policy: new URL('../apps/automation/config/policy.v5.json', import.meta.url) });
    expect(config.policy.allowRiskyActions).toBe(false);
    expect(config.policy.riskyControls?.map(control => [control.name, control.treatment])).toEqual([['Close account', 'block'], ['Transfer funds', 'block']]);
  });
  it.each(['allowedClickNames', 'manualClickNames', 'allowedFillNames'] as const)('rejects a policy that also permits a risky control via %s, including casing variants', async key => {
    const { policySchema } = await import('../apps/automation/src/db/repository.js');
    const { readFile } = await import('node:fs/promises');
    const policy = JSON.parse(await readFile(new URL('../apps/automation/config/policy.v5.json', import.meta.url), 'utf8'));
    policy[key] = [...(policy[key] ?? []), 'close  ACCOUNT'];
    expect(policySchema.safeParse(policy).success).toBe(false);
  });
});

describe('session-start classification through the real Stagehand launch path (fake transport, no network)', { timeout: 30_000 }, () => {
  async function launchWith(statuses: { extension?: number; session?: number; sessionThrows?: boolean }) {
    // Stagehand is an automation-app dependency; resolve it the way that app does.
    const { browserbase } = await import('../apps/automation/node_modules/@browserbasehq/stagehand/dist/index.mjs');
    const { sessionCreateRecorder } = await import('../apps/automation/src/execution/diagnostics.js');
    const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const transport = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/v1/extensions') return json(statuses.extension && statuses.extension >= 400 ? { error: 'synthetic-provider-text-marker' } : { id: 'ext_1' }, statuses.extension ?? 200);
      if (method === 'POST' && url.pathname === '/v1/sessions') {
        if (statuses.sessionThrows) throw new TypeError('fetch failed');
        const status = statuses.session ?? 201;
        return json(status < 300 ? { id: '00000000-0000-4000-8000-000000000001', connectUrl: 'ws://127.0.0.1:9/never' } : { error: 'synthetic-provider-text-marker' }, status);
      }
      return json({}, 200);
    };
    const recorder = sessionCreateRecorder(transport);
    try { await browserbase.launch({ apiKey: 'synthetic-test-key', projectId: '00000000-0000-4000-8000-000000000000', keepAlive: false, clientOptions: { timeout: 2000, maxRetries: 0, fetch: recorder.fetch as never } }); }
    catch (error) {
      // Stagehand replaces the SDK error: the status is not on the error itself.
      expect((error as { status?: unknown }).status).toBeUndefined();
      return sessionStartError(error, recorder.observation());
    }
    throw new Error('launch unexpectedly succeeded');
  }
  it('reports a 402 from the create request as not created with its category', async () => {
    const error = await launchWith({ session: 402 });
    expect(error).toMatchObject({ code: 'SESSION_NOT_CREATED', category: 'provider_usage_limit' });
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain('synthetic-provider-text-marker');
  });
  it('reports a refusal before any create request (extension upload 401) as not created', async () => {
    expect(await launchWith({ extension: 401 })).toMatchObject({ code: 'SESSION_NOT_CREATED', category: 'provider_auth' });
  });
  it('keeps a created session whose connection failed uncertain, never "not created"', async () => {
    expect((await launchWith({ session: 201 })).code).toBe('SESSION_START_UNCERTAIN');
  });
  it('keeps a create request with no response uncertain', async () => {
    expect((await launchWith({ sessionThrows: true })).code).toBe('SESSION_START_UNCERTAIN');
  });
  it('keeps a 5xx from the create request uncertain', async () => {
    expect((await launchWith({ session: 503 })).code).toBe('SESSION_START_UNCERTAIN');
  });
});

describe('the provider transport used in production', { timeout: 30_000 }, () => {
  it('sends the real multipart extension upload and classifies a 401 refusal (local server, no network)', async () => {
    const { createServer } = await import('node:http');
    const { once } = await import('node:events');
    const { browserbase } = await import('../apps/automation/node_modules/@browserbasehq/stagehand/dist/index.mjs');
    const { sdkFetch } = await import('../apps/automation/src/execution/provider.js');
    const { sessionCreateRecorder } = await import('../apps/automation/src/execution/diagnostics.js');
    const requests: string[] = [];
    const server = createServer((request, response) => {
      let size = 0; request.on('data', chunk => { size += chunk.length; });
      request.on('end', () => { requests.push(request.method + ' ' + request.url + ' ' + (size > 0 ? 'body' : 'empty'));
        response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'synthetic-provider-text-marker' })); });
    }).listen(0, '127.0.0.1');
    await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
    const recorder = sessionCreateRecorder(sdkFetch);
    try {
      await expect(browserbase.launch({ apiKey: 'synthetic-test-key', baseUrl: `http://127.0.0.1:${address.port}`, projectId: '00000000-0000-4000-8000-000000000000', keepAlive: false,
        clientOptions: { timeout: 5000, maxRetries: 0, fetch: recorder.fetch as never } })).rejects.toBeTruthy();
    } finally { server.close(); }
    // The upload reached the server with its body; with the global fetch it threw locally before sending.
    expect(requests[0]).toMatch(/^POST \/v1\/extensions body$/);
    expect(sessionStartError(new Error('upload failed'), recorder.observation())).toMatchObject({ code: 'SESSION_NOT_CREATED', category: 'provider_auth' });
  });
});
