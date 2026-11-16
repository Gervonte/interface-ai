import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { createApp as automationApp } from '../apps/automation/src/app.js';
import { createApp as demoApp } from '../apps/demo-api/src/app.js';
import { ApiErrorSchema, HealthResponseSchema } from '@interface-ai/contracts';

// Real HTTP requests protect the service boundary and safe error responses.
for (const [name, factory] of [['automation', automationApp], ['demo-target', demoApp]] as const) {
  describe(name, () => {
    let server: Server;
    let baseUrl: string;
    beforeAll(async () => {
      server = factory().listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing server address');
      baseUrl = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    });
    it('identifies the independent service using the shared public contract', async () => {
      const response = await fetch(`${baseUrl}/healthz`);
      expect(response.status).toBe(200);
      expect(HealthResponseSchema.parse(await response.json()).service).toBe(name);
      expect(response.headers.get('x-powered-by')).toBeNull();
    });
    it('does not echo sensitive URL values in unsupported-route responses', async () => {
      const response = await fetch(`${baseUrl}/missing/synthetic-secret-marker?token=synthetic-secret-marker`);
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).not.toContain('synthetic-secret-marker');
      expect(ApiErrorSchema.parse(JSON.parse(body)).error.code).toBe('NOT_FOUND');
    });
    it('does not echo malformed JSON values in parser errors', async () => {
      const response = await fetch(`${baseUrl}/healthz`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"secret":"synthetic-secret-marker",',
      });
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).not.toContain('synthetic-secret-marker');
      expect(ApiErrorSchema.parse(JSON.parse(body)).error.code).toBe('INVALID_JSON');
    });
  });
}
