import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { ApiErrorSchema, HealthResponseSchema } from '@interface-ai/contracts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/healthz', (_request, response) => {
    response.json(HealthResponseSchema.parse({ status: 'ok', service: 'demo-target' }));
  });
  app.use((_request, response) => {
    response.status(404).json(ApiErrorSchema.parse({
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    }));
  });
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? error.status : undefined;
    // Do not echo parser errors: they may contain request bodies or credentials.
    if (status === 400 || status === 413) {
      response.status(status).json({ error: {
        code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
        message: status === 413 ? 'Request body is too large.' : 'Invalid JSON request body.',
      } });
      return;
    }
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Request failed.' } });
  };
  app.use(handleError);
  return app;
}
