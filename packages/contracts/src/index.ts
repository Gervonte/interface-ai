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
  error: z.strictObject({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
