import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { join } from 'node:path';
import { ApiErrorSchema, HealthResponseSchema } from '@interface-ai/contracts';
import { createStaffRouter } from './staff-router.js';
import type { MemberStore } from './staff-router.js';

export function createApp(options: { repository?: MemberStore; webDirectory?: string; sessionTtlMs?: number } = {}) {
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', 'loopback');
  app.use((_request, response, next) => {
    response.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'; form-action 'self'" });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get(['/healthz', '/api/healthz'], (_request, response) => {
    response.json(HealthResponseSchema.parse({ status: 'ok', service: 'demo-target' }));
  });
  const staff = createStaffRouter(options.repository, options.sessionTtlMs);
  app.use('/api/staff', staff); app.use('/staff', staff);
  if (options.webDirectory) {
    app.use(express.static(options.webDirectory, { index: false, dotfiles: 'deny' }));
    app.get(['/', '/servicing'], (_request, response) => {
      response.set('Cache-Control', 'no-store').sendFile(join(options.webDirectory!, 'index.html'));
    });
  }
  app.use((_request, response) => {
    response.status(404).json(ApiErrorSchema.parse({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  });
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    if (status === 400 || status === 413 || status === 415) {
      response.status(status).json({ error: {
        code: status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_JSON',
        message: status === 413 ? 'Request body is too large.' : status === 415 ? 'Unsupported request content.' : 'Invalid JSON request body.',
      } }); return;
    }
    // Database/parser/provider messages may contain sensitive values. Do not echo them.
    response.status(503).json({ error: { code: 'MEMBER_SERVICES_UNAVAILABLE', message: 'Member services are temporarily unavailable. Try again.' } });
  };
  app.use(handleError);
  return app;
}
