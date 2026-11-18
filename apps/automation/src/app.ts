import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiErrorSchema, CancelRequestSchema, HealthResponseSchema, IdentifierSchema, MutationMetadataSchema, RunRequestSchema } from '@interface-ai/contracts';
import type { Coordinator } from './execution/coordinator.js';
import { RepositoryError } from './db/repository.js';
import { parseRequestJson } from './execution/json.js';

export interface ApiIdentity { token: string; principal: string; access: 'operator' | 'read' }
const digest = (value: string) => createHash('sha256').update(value).digest();
export function createApp(options: { coordinator?: Coordinator; identities?: readonly ApiIdentity[] } = {}) {
  const app = express(); app.disable('x-powered-by');
  const identities = (options.identities ?? []).map(identity => ({ ...identity, hash: digest(identity.token) }));
  const error = (response: express.Response, status: number, code: string) => response.status(status).json(ApiErrorSchema.parse({ error: { code, message: status === 401 ? 'Authentication required.' : status === 404 ? 'Resource not found.' : status === 503 ? 'Automation service is unavailable. Check server configuration and cleanup status.' : 'Request could not be accepted.' } }));
  app.get('/healthz', (_request, response) => response.json(HealthResponseSchema.parse({ status: 'ok', service: 'automation' })));
  const authenticated: RequestHandler = (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (!identities.length || !options.coordinator) { error(response, 503, 'AUTOMATION_NOT_CONFIGURED'); return; }
    const authorization = request.headers.authorization;
    const candidate = authorization?.startsWith('Bearer ') && authorization.length <= 520 ? digest(authorization.slice(7)) : digest('');
    const identity = identities.find(value => timingSafeEqual(value.hash, candidate));
    if (!identity) { error(response, 401, 'UNAUTHORIZED'); return; }
    if (request.method !== 'GET' && identity.access !== 'operator') { error(response, 403, 'FORBIDDEN'); return; }
    response.locals.principal = identity.principal; next();
  };
  app.use('/v1', authenticated);
  app.use(express.text({ type: 'application/json', limit: '16kb' }));
  app.use((request, _response, next) => {
    if (typeof request.body === 'string') {
      try { request.body = parseRequestJson(request.body); } catch { next(Object.assign(new Error('INVALID_JSON'), { status: 400 })); return; }
    }
    next();
  });
  const coordinator = () => { if (!options.coordinator) throw new RepositoryError('COORDINATOR_UNAVAILABLE'); return options.coordinator; };
  const runId = (request: express.Request) => z.uuid().parse(request.params.runId);
  const key = (request: express.Request) => MutationMetadataSchema.parse({ idempotencyKey: request.headers['idempotency-key'] }).idempotencyKey;
  app.post('/v1/runs', async (request, response) => {
    const accepted = await coordinator().accept(RunRequestSchema.parse(request.body), response.locals.principal, key(request));
    response.set('Location', accepted.statusUrl).status(202).json(accepted);
  });
  app.get('/v1/runs/:runId', async (request, response) => response.json(await coordinator().read(runId(request), response.locals.principal)));
  app.get('/v1/capabilities/:capabilityId/versions/:version', async (request, response) => {
    const id = IdentifierSchema.parse(request.params.capabilityId); const version = z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).parse(request.params.version);
    response.json(await coordinator().repository.capability(id, version, response.locals.principal));
  });
  app.get('/v1/runs/:runId/events', async (request, response) => {
    const query = z.strictObject({ afterSequence: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
    response.json(await coordinator().repository.events(runId(request), response.locals.principal, query.afterSequence, query.limit));
  });
  app.get('/v1/runs/:runId/operations/:receiptId', async (request, response) => response.json(await coordinator().repository.operation(runId(request), z.uuid().parse(request.params.receiptId), response.locals.principal)));
  app.get('/v1/runs/:runId/evidence/:evidenceId', async (request, response) => response.json(await coordinator().evidenceFor(runId(request), z.uuid().parse(request.params.evidenceId), response.locals.principal)));
  app.post('/v1/runs/:runId/cancel', async (request, response) => {
    const id = runId(request); const result = await coordinator().cancel(id, response.locals.principal, key(request), CancelRequestSchema.parse(request.body));
    response.status(result.run.status === 'cancelled' ? 200 : 202).json({ runId: id, status: result.run.status, statusUrl: `/v1/runs/${id}`, operationUrl: `/v1/runs/${id}/operations/${result.receiptId}` });
  });
  app.use((_request, response) => error(response, 404, 'NOT_FOUND'));
  const handleError: ErrorRequestHandler = (failure: unknown, _request, response, _next) => {
    if (failure instanceof z.ZodError) { error(response, 400, 'INVALID_REQUEST'); return; }
    const status = typeof failure === 'object' && failure !== null && 'status' in failure ? failure.status : undefined;
    if (status === 400 || status === 413 || status === 415) { error(response, status, status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_JSON'); return; }
    if (failure instanceof RepositoryError) {
      const missing = ['RUN_NOT_FOUND', 'CAPABILITY_NOT_FOUND', 'TARGET_NOT_FOUND', 'OPERATION_NOT_FOUND', 'EVIDENCE_NOT_FOUND'];
      const invalid = ['INVALID_CAPABILITY_INPUTS', 'INCOMPATIBLE_TARGET'];
      const conflicts = ['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_WINDOW_EXPIRED', 'RUN_STATE_CONFLICT', 'RUN_CAPACITY_REACHED'];
      error(response, missing.includes(failure.code) ? 404 : invalid.includes(failure.code) ? 422 : conflicts.includes(failure.code) ? 409 : 503, failure.code); return;
    }
    error(response, 503, 'INFRASTRUCTURE_UNAVAILABLE');
  };
  app.use(handleError); return app;
}
