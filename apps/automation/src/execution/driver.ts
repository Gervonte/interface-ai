import { CDPConnectionClosedError } from '@browserbasehq/stagehand';
import type { Page } from '@browserbasehq/stagehand';
import { z } from 'zod';
import type { Values } from '@interface-ai/contracts';
import { observeDom } from '../workflows/observation-dom.js';
import { ObservationSchema, safeLabels, staticValues } from '../workflows/contracts.js';
import type { BrowserSurface, ResolvedTarget, SurfacePolicy } from './surface.js';
import { TargetStateSchema } from './surface.js';
import { operateDom, snapshotDom } from './dom.js';
import { ExecutionError, failureCodes } from './errors.js';

export class StagehandSurface implements BrowserSurface {
  constructor(private readonly page: Page) {}
  private transport(error:unknown):never { if(error instanceof CDPConnectionClosedError || (error instanceof Error && ['RPC client is closed','RPC client closed','CDP client is closed','CDP client closed','CDP connection is not open','Stagehand closed'].includes(error.message)))throw new ExecutionError('SESSION_LOST');throw error; }
  private evaluate(expression:string){return this.page.evaluate(expression).catch(error=>this.transport(error));}
  async observe(inputs: Values, policy: SurfacePolicy) {
    return ObservationSchema.parse(await this.evaluate(`(() => { const __name = (value) => value; return (${observeDom.toString()})(${JSON.stringify(inputs)}, ${JSON.stringify(policy)}, ${JSON.stringify(safeLabels)}, ${JSON.stringify(staticValues)}); })()`));
  }
  async location() { return this.page.url().catch(error=>this.transport(error)); }
  private async invoke(target: ResolvedTarget, policy: SurfacePolicy, mode: 'inspect' | 'fill' | 'click', value?: string) {
    const data: unknown = await this.evaluate(`(() => { const __name = (value) => value; return (${operateDom.toString()})(${JSON.stringify({ target, policy, mode, ...(value === undefined ? {} : { value }) })}); })()`);
    const error = z.object({ error: z.enum(failureCodes) }).safeParse(data);
    if (error.success) throw new ExecutionError(error.data.error, error.data.error === 'ACTION_OUTCOME_UNKNOWN' ? 'unknown' : 'not_sent', error.data.error === 'ACTION_OUTCOME_UNKNOWN' ? 'unknown' : 'not_applied');
    return TargetStateSchema.parse(data);
  }
  async inspectMany(targets:Record<string,ResolvedTarget>,policy:SurfacePolicy){
    const values:unknown=await this.evaluate(`(() => { const __name=value=>value; const inspect=${operateDom.toString()}; const targets=${JSON.stringify(targets)}; const policy=${JSON.stringify(policy)}; return Object.fromEntries(Object.entries(targets).map(([key,target])=>[key,inspect({target,policy,mode:'inspect'})])); })()`);
    const data=z.record(z.string(),z.unknown()).parse(values);const states:Record<string,z.infer<typeof TargetStateSchema>>={};
    for(const [key,value]of Object.entries(data)){const failure=z.object({error:z.enum(failureCodes)}).safeParse(value);if(failure.success)throw new ExecutionError(failure.data.error);states[key]=TargetStateSchema.parse(value);}
    if(Object.keys(targets).some(key=>!states[key]))throw new ExecutionError('READ_FAILED');return states;
  }
  async inspect(target: ResolvedTarget, policy: SurfacePolicy) { return this.invoke(target, policy, 'inspect'); }
  async dispatch(type: 'click' | 'fill', target: ResolvedTarget, policy: SurfacePolicy, value?: string) {
    const result = await this.invoke(target, policy, type, value);
    if (result.count !== 1) throw new ExecutionError(result.count ? 'AMBIGUOUS_TARGET' : 'TARGET_NOT_FOUND', 'not_sent', 'not_applied');
  }
  async navigate(url: string, timeoutMs: number) {
    const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(error=>this.transport(error));
    if (!response?.ok()) throw new ExecutionError('ACTION_OUTCOME_UNKNOWN', 'unknown', 'unknown');
  }
  async image() { return this.page.screenshot({type:'png'}).catch(error=>this.transport(error)); }
  async snapshot(policy: SurfacePolicy) { return this.evaluate(`(() => { const __name = (value) => value; return (${snapshotDom.toString()})(${JSON.stringify(policy)}); })()`); }
}
