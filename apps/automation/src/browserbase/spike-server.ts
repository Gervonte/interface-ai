import { randomBytes } from 'node:crypto';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { ControlConflict } from './spike-control.js';
import { manualRequestSchema } from './spike.js';
import type { SdkSpike } from './spike.js';
import { operatorPage } from './operator-page.js';

type SpikePort = Pick<SdkSpike, 'state' | 'image' | 'observation' | 'start' | 'claim' | 'manual' | 'refresh' | 'resume'>;
const revisionSchema = z.strictObject({ revision: z.number().int().positive() });
export function createSpikeApp(spike: SpikePort, origin: string, token = randomBytes(32).toString('hex')) {
  const app = express();
  const host = new URL(origin).host;
  const nonce = randomBytes(24).toString('hex');
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
    if (request.headers.host !== host) { response.status(403).json({ error: 'Invalid local host.' }); return; }
    if (request.method !== 'GET' && (request.headers.origin !== origin || request.headers['x-spike-token'] !== token)) {
      response.status(403).json({ error: 'Local operator authorization required.' }); return;
    }
    next();
  });
  app.use(express.json({ limit: '2kb' }));
  app.get('/', (_request, response) => response.type('html').send(operatorPage(token, nonce)));
  app.get('/state', (_request, response) => response.json(spike.state()));
  app.get('/observation.png', (request, response) => {
    if (!spike.image || request.query.id !== spike.observation?.id) { response.sendStatus(409); return; }
    response.type('png').send(Buffer.from(spike.image));
  });
  app.post('/start', (_request, response) => { spike.start(); response.status(202).json({ ok: true }); });
  app.post('/claim', async (request, response) => { await spike.claim(revisionSchema.parse(request.body).revision); response.json({ ok: true }); });
  app.post('/manual', async (request, response) => { await spike.manual(manualRequestSchema.parse(request.body)); response.json({ ok: true }); });
  app.post('/refresh', async (_request, response) => { await spike.refresh(); response.json({ ok: true }); });
  app.post('/resume', async (request, response) => { await spike.resume(revisionSchema.parse(request.body).revision); response.json({ ok: true }); });
  app.use((_request, response) => response.status(404).json({ error: 'Route not found.' }));
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ControlConflict) { response.status(409).json({ error: error.message }); return; }
    if (error instanceof z.ZodError) { response.status(400).json({ error: 'Invalid operator request.' }); return; }
    const parserError = typeof error === 'object' && error !== null && 'status' in error && [400, 413].includes(Number(error.status));
    response.status(parserError ? 400 : 502).json({ error: parserError ? 'Invalid operator request.' : 'Session operation failed. Refresh the view or inspect the check phase.' });
  };
  app.use(handleError);
  return app;
}
