import type { Target, Values } from '@interface-ai/contracts';
import { z } from 'zod';

export interface ResolvedTarget extends Omit<Target, 'within'> {
  within: Array<Exclude<Target['within'][number], { kind: 'tableRow' }> | { kind: 'tableRow'; tableCaption: string; cells: Array<{ columnHeader: string; equals: string }> }>;
}
export const TargetStateSchema = z.strictObject({ count: z.number().int().min(0), visible: z.boolean(), enabled: z.boolean(), editable: z.boolean(),
  text: z.string().max(16_384), value: z.string().max(4096), checked: z.boolean(), tag: z.string().max(20), name: z.string().max(500), inputType: z.string().max(30) });
export type TargetState = z.infer<typeof TargetStateSchema>;
export interface SurfacePolicy { allowedOrigins: readonly string[]; allowedClickNames: readonly string[]; allowedFillNames: readonly string[] }
export interface BrowserSurface {
  location(): Promise<string>;
  inspect(target: ResolvedTarget, policy: SurfacePolicy): Promise<TargetState>;
  dispatch(type: 'click' | 'fill', target: ResolvedTarget, policy: SurfacePolicy, value?: string): Promise<void>;
  navigate(url: string, timeoutMs: number): Promise<void>;
  snapshot(policy: SurfacePolicy): Promise<unknown>;
}
export function resolveTarget(target: Target, inputs: Values, variables: Values): ResolvedTarget {
  return { ...target, within: target.within.map((scope) => {
    if (scope.kind !== 'tableRow') return scope;
    return { ...scope, cells: scope.cells.map((cell) => {
      const ref = cell.equals;
      const value = ref.kind === 'literal' ? ref.value : (ref.kind === 'input' ? inputs : variables)[ref.name];
      if (typeof value !== 'string') throw new Error('Unresolved binding');
      return { ...cell, equals: value };
    }) };
  }) };
}
