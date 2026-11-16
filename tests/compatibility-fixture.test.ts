import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createCompatibilityFixture } from '../apps/demo-api/src/compatibility-fixture.js';

describe('public compatibility fixture HTTP boundary', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createCompatibilityFixture().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  it('serves a staff shell and a same-origin framed member workspace', async () => {
    const response = await fetch(`${base}/compatibility`);
    const html = await response.text();
    expect(html).toContain('Staff Services');
    expect(html).toContain('iframe title="Member servicing workspace" src="/compatibility/workspace"');
    expect(response.headers.get('content-security-policy')).toContain("frame-src 'self'");
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('has repeated row controls and different member balances with reordered savings rows', async () => {
    const first = await (await fetch(`${base}/compatibility/workspace?memberId=M1001`)).text();
    const second = await (await fetch(`${base}/compatibility/workspace?memberId=M1002`)).text();
    expect(first.match(/>Open<\/button>/g)).toHaveLength(2);
    expect(first).toContain('$1,250.34');
    expect(first).toContain('$1,200.34');
    expect(first.indexOf('<td>C3001')).toBeLessThan(first.indexOf('<td>S2001'));
    expect(second.indexOf('<td>S2002')).toBeLessThan(second.indexOf('<td>C3001'));
    expect(second).toContain('$87.65');
    expect(second).not.toContain('$1,250.34');
  });
  it('opens only accounts belonging to the selected synthetic member', async () => {
    const valid = await fetch(`${base}/compatibility/account?memberId=M1001&accountId=S2001`);
    expect(valid.status).toBe(200);
    expect(await valid.text()).toContain('<h1>Account Details</h1>');
    const wrong = await fetch(`${base}/compatibility/account?memberId=M1001&accountId=S2002`);
    expect(wrong.status).toBe(404);
  });
  it.each(['/.env', '/src/fixture-server.ts', '/runtime/result.json', '/api/members', '/healthz/synthetic-secret-marker'])(
    'exposes no filesystem or business API at %s', async (path) => {
      const response = await fetch(base + path);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Route not found.');
    },
  );
  it('does not interpolate untrusted member/query values into HTML', async () => {
    const response = await fetch(`${base}/compatibility/workspace?memberId=%3Cscript%3Esynthetic-secret-marker`);
    expect(await response.text()).not.toContain('synthetic-secret-marker');
  });
});
