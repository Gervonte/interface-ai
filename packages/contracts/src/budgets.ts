import { z } from 'zod';

export const RuntimeBudgetsSchema = z.strictObject({
  maxActions: z.number().int().min(1).max(1000),
  maxModelCalls: z.number().int().min(0).max(100),
  activeTimeoutMs: z.number().int().min(1000).max(3_600_000),
  stepTimeoutMs: z.number().int().min(100).max(60_000),
  pollIntervalMs: z.number().int().min(50).max(5000),
  maxRecoveryAttempts: z.number().int().min(0).max(10),
  interventionTimeoutMs: z.number().int().min(1000).max(900_000),
  overallTimeoutMs: z.number().int().min(1000).max(7_200_000),
}).refine((value) => value.pollIntervalMs < value.stepTimeoutMs && value.stepTimeoutMs <= value.activeTimeoutMs
  && value.overallTimeoutMs >= value.activeTimeoutMs && value.overallTimeoutMs >= value.interventionTimeoutMs, 'Inconsistent runtime budgets.');
export type RuntimeBudgets = z.infer<typeof RuntimeBudgetsSchema>;
export const DEFAULT_RUNTIME_BUDGETS: Readonly<RuntimeBudgets> = Object.freeze(RuntimeBudgetsSchema.parse({
  maxActions: 100, maxModelCalls: 30, activeTimeoutMs: 300_000, stepTimeoutMs: 10_000,
  pollIntervalMs: 250, maxRecoveryAttempts: 3, interventionTimeoutMs: 600_000, overallTimeoutMs: 900_000,
}));
export const StepTimeoutSchema = z.number().int().min(100).max(60_000);
