import type { Page } from '@browserbasehq/stagehand';
import { z } from 'zod';
import type { BrowserSurface, ResolvedTarget, SurfacePolicy } from './surface.js';
import { TargetStateSchema } from './surface.js';
import { operateDom, snapshotDom } from './dom.js';
import { ExecutionError, failureCodes } from './errors.js';

export class StagehandSurface implements BrowserSurface {
  constructor(private readonly page: Page) {}
  async location() { return this.page.url(); }
  private async invoke(target: ResolvedTarget, policy: SurfacePolicy, mode: 'inspect' | 'fill' | 'click', value?: string) {
    const data: unknown = await this.page.evaluate(`(() => { const __name = (value) => value; return (${operateDom.toString()})(${JSON.stringify({ target, policy, mode, ...(value === undefined ? {} : { value }) })}); })()`);
    const error = z.object({ error: z.enum(failureCodes) }).safeParse(data);
    if (error.success) throw new ExecutionError(error.data.error, error.data.error === 'ACTION_OUTCOME_UNKNOWN' ? 'unknown' : 'not_sent', error.data.error === 'ACTION_OUTCOME_UNKNOWN' ? 'unknown' : 'not_applied');
    return TargetStateSchema.parse(data);
  }
  async inspect(target: ResolvedTarget, policy: SurfacePolicy) { return this.invoke(target, policy, 'inspect'); }
  async dispatch(type: 'click' | 'fill', target: ResolvedTarget, policy: SurfacePolicy, value?: string) {
    const result = await this.invoke(target, policy, type, value);
    if (result.count !== 1) throw new ExecutionError(result.count ? 'AMBIGUOUS_TARGET' : 'TARGET_NOT_FOUND', 'not_sent', 'not_applied');
  }
  async navigate(url: string, timeoutMs: number) {
    const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok()) throw new ExecutionError('ACTION_OUTCOME_UNKNOWN', 'unknown', 'unknown');
  }
  async snapshot(policy: SurfacePolicy) { return this.page.evaluate(`(() => { const __name = (value) => value; return (${snapshotDom.toString()})(${JSON.stringify(policy)}); })()`); }
}
