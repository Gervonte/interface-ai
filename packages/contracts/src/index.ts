import { z } from 'zod';

// Public transport contracts only: never import target fixtures or server configuration.
export const ServiceNameSchema = z.enum(['automation', 'demo-target']);
export type ServiceName = z.infer<typeof ServiceNameSchema>;

export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: ServiceNameSchema,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string(), runId: z.uuid().optional() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export * from './data.js';
export * from './budgets.js';
export * from './capability.js';
export * from './runs.js';
export * from './demo.js';
