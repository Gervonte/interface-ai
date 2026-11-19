import { z } from 'zod';
import { TargetSchema } from '@interface-ai/contracts';

export const safeLabels = ['Staff workspace', 'Member Search', 'Member Overview', 'Account Inquiry', 'Account Details', 'Member servicing workspace', 'Active member',
  'Start Member Search', 'Search', 'Clear', 'Open', 'New member search', 'Start a new search', 'Back to Accounts', 'Back to Member Overview', 'Try again',
  'Member search results', 'Member accounts', 'Search results', 'Member ID', 'Member Name', 'Membership Status', 'Account ID', 'Account Type', 'Designation', 'Status',
  'Current Balance', 'Available Balance', 'Currency', 'Action', 'No matching member', 'No primary savings account', 'Access denied'] as const;
export const staticValues = ['Primary Savings', 'Savings', 'Checking', 'Primary', 'Standard', 'Active', 'Closed', 'USD'] as const;
const safeText = z.enum(safeLabels);
const ref = z.string().regex(/^[cf]\d{1,3}$/);
export const ObservationSchema = z.strictObject({
  observationId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), ready: z.boolean(),
  headings: z.array(z.strictObject({ label: safeText, target: TargetSchema })).max(16),
  controls: z.array(z.strictObject({ ref, kind: z.enum(['click', 'fill']), label: safeText, target: TargetSchema, enabled: z.boolean(),
    filled: z.boolean(), row: z.partialRecord(safeText, z.enum(staticValues)), matchesInputs: z.array(z.string()).max(32), accountIdTarget: TargetSchema.optional() })).max(64),
  fields: z.array(z.strictObject({ ref, label: safeText, region: safeText, target: TargetSchema, matchesInputs: z.array(z.string()).max(32), constant: z.enum(staticValues).nullable() })).max(32),
});
export type Observation = z.infer<typeof ObservationSchema>;
const outputRefs = z.strictObject({ memberId: z.string().max(10), accountId: z.string().max(10), accountType: z.string().max(10), currentBalanceMinor: z.string().max(10), currency: z.string().max(10) });
export const DecisionSchema = z.strictObject({ observationId: z.uuid(), action: z.enum(['click', 'fill', 'finish', 'help']),
  controlRef: z.string().max(10), inputName: z.string().max(64), outputs: outputRefs,
  reason: z.enum(['continue', 'goal_complete', 'blocked', 'unsupported_goal']) });
export type Decision = z.infer<typeof DecisionSchema>;
export interface ModelUsage { inputTokens: number; outputTokens: number }
export interface Planner {
  decide(context: { goal: string; inputNames: string[]; observation: Observation; history: Array<{ action: string; label: string }> }, timeoutMs: number): Promise<{ decision: Decision; usage: ModelUsage }>;
}
export interface SessionStatistics { mode: 'discovery' | 'replay'; modelCalls: number; inferenceAttempts: number; inputTokens: number; outputTokens: number; finalStatus: string }
export const balanceInputSchema = { type: 'object', properties: { memberId: { type: 'string', format: 'member-id', maxLength: 5 } }, required: ['memberId'], additionalProperties: false } as const;
export const balanceOutputSchema = { type: 'object', properties: {
  memberId: { type: 'string', format: 'member-id', maxLength: 5 }, accountId: { type: 'string', format: 'account-id', maxLength: 5 },
  accountType: { type: 'string', enum: ['savings'], maxLength: 20 }, currentBalanceMinor: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  currency: { type: 'string', enum: ['USD'], maxLength: 3 },
}, required: ['memberId', 'accountId', 'accountType', 'currentBalanceMinor', 'currency'], additionalProperties: false } as const;
export const outputLabels = { memberId: 'Member ID', accountId: 'Account ID', accountType: 'Account Type', currentBalanceMinor: 'Current Balance', currency: 'Currency' } as const;
