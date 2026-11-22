import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const scenarioNames = ['baseline', 'member-not-found', 'no-primary-savings', 'access-denied', 'slow-search', 'slow-inquiry',
  'failed-inquiry', 'transient-inquiry', 'servicing-notice', 'persistent-notice', 'unexpected-modal', 'session-expired', 'validation-error',
  'duplicate-account', 'wrong-member', 'wrong-account', 'conflicting-outcomes', 'embedded-instruction'] as const;
export const ScenarioSchema = z.strictObject({ name: z.enum(scenarioNames), delayMs: z.number().int().min(0).max(15_000).default(1000),
  failuresBeforeSuccess: z.number().int().min(1).max(10).default(1) });
export type Scenario = z.infer<typeof ScenarioSchema>;
export const baselineScenario = (): Scenario => ScenarioSchema.parse({ name: 'baseline' });
export type ScenarioLoader = () => Promise<Scenario>;
export function fileScenarioLoader(path: string): ScenarioLoader {
  return async () => {
    try { return ScenarioSchema.parse(JSON.parse(await readFile(path, 'utf8'))); }
    catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return baselineScenario(); throw new Error('Invalid demo scenario setup.'); }
  };
}
