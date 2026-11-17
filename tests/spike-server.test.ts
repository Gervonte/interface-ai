import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createSpikeApp } from '../apps/automation/src/browserbase/spike-server.js';
import { ControlConflict } from '../apps/automation/src/browserbase/spike-control.js';

describe('local operator transport HTTP boundary', () => {
  const token = 'synthetic-local-operator-token';
  const viewId = '33333333-3333-4333-8333-333333333333';
  const spike = {
    state: () => ({ phase: 'waiting_for_human', sessionId: undefined, observation: undefined, events: [], result: {}, control: { owner: 'none' as const, revision: 2, busy: false, closed: false } }),
    image: new Uint8Array([1, 2, 3]),
    observation: { id: viewId, revision: 2, createdAt: Date.now(), fingerprint: 'fixture', controls: [] },
    start: vi.fn(), claim: vi.fn(async (_revision: number) => {}),
    manual: vi.fn(async (_body: unknown) => {}), refresh: vi.fn(async () => {}), resume: vi.fn(async (_revision: number) => {}),
  };
  const server = createServer(); let origin: string;
  beforeAll(async () => {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    origin = `http://127.0.0.1:${address.port}`;
    server.on('request', createSpikeApp(spike, origin, token));
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Spike-Token': token, ...headers }, body: JSON.stringify(body) });
  }
  it('rejects cross-origin and missing-token mutations without dispatching', async () => {
    expect((await post('/claim', { revision: 2 }, { Origin: 'https://untrusted.example' })).status).toBe(403);
    expect((await post('/claim', { revision: 2 }, { 'X-Spike-Token': '' })).status).toBe(403);
    expect(spike.claim).not.toHaveBeenCalled();
  });
  it('rejects unexpected Host values to prevent DNS rebinding', async () => {
    // Node fetch normalizes Host; use a real HTTP request to send the hostile header.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(origin + '/state', { headers: { Host: 'untrusted.example' } }, (response) => {
        response.resume(); resolve(response.statusCode);
      });
      request.on('error', reject); request.end();
    });
    expect(status).toBe(403);
  });
  it('dispatches a valid claim but rejects unknown target/secret input without echoing it', async () => {
    expect((await post('/claim', { revision: 2 })).status).toBe(200);
    expect(spike.claim).toHaveBeenCalledWith(2);
    const response = await post('/manual', { revision: 3, observationId: viewId, target: 'evaluate', value: 'synthetic-secret-marker' });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('synthetic-secret-marker');
    expect(spike.manual).not.toHaveBeenCalled();
  });
  it('maps ownership conflicts to 409 and masks raw provider errors', async () => {
    spike.resume.mockRejectedValueOnce(new ControlConflict());
    expect((await post('/resume', { revision: 3 })).status).toBe(409);
    spike.refresh.mockRejectedValueOnce(new Error('https://provider.example/?apiKey=synthetic-secret-marker'));
    const response = await post('/refresh', {});
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('synthetic-secret-marker');
  });
  it('serves only the current observation image with no caching', async () => {
    expect((await fetch(origin + '/observation.png?id=old-view')).status).toBe(409);
    const response = await fetch(origin + '/observation.png?id=' + viewId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });
});
