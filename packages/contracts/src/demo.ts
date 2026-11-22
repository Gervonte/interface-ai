import { z } from 'zod';

export const DemoMemberIdSchema = z.string().regex(/^M\d{4}$/);
export const DemoAccountIdSchema = z.string().regex(/^[SC]\d{4}$/);
export const DemoMemberSchema = z.strictObject({
  id: DemoMemberIdSchema, name: z.string().min(1).max(100), status: z.enum(['active', 'inactive']), accountAccess: z.enum(['allowed', 'denied']),
});
export type DemoMember = z.infer<typeof DemoMemberSchema>;
export const DemoAccountSchema = z.strictObject({
  id: DemoAccountIdSchema, memberId: DemoMemberIdSchema, type: z.enum(['savings', 'checking']), isPrimary: z.boolean(),
  status: z.enum(['active', 'closed']), currentBalanceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  availableBalanceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), currency: z.literal('USD'),
}).refine((value) => !value.isPrimary || value.type === 'savings');
export type DemoAccount = z.infer<typeof DemoAccountSchema>;
export const DemoSessionSchema = z.strictObject({
  operator: z.strictObject({ id: z.string(), name: z.string(), branch: z.string(), role: z.string() }),
  status: z.literal('active'), contextRevision: z.number().int().min(0), activeMember: DemoMemberSchema.nullable(),
});
export type DemoSession = z.infer<typeof DemoSessionSchema>;
export const DemoSearchSchema = z.strictObject({ memberId: DemoMemberIdSchema, member: DemoMemberSchema.nullable(), searchRevision: z.number().int().positive() });
export type DemoSearch = z.infer<typeof DemoSearchSchema>;
export const DemoOverviewSchema = z.strictObject({ member: DemoMemberSchema,
  accountSummary: z.strictObject({ total: z.number().int().min(0), savings: z.number().int().min(0), checking: z.number().int().min(0) }).nullable(),
});
export type DemoOverview = z.infer<typeof DemoOverviewSchema>;
export const DemoAccountsSchema = z.strictObject({ member: DemoMemberSchema, accounts: z.array(DemoAccountSchema), conflictingSignals: z.boolean().optional() })
  .refine((value) => value.accounts.every((account) => account.memberId === value.member.id));
export const DemoDetailsSchema = z.strictObject({ member: DemoMemberSchema, account: DemoAccountSchema, notice: z.string().max(500).optional() })
  .refine((value) => value.account.memberId === value.member.id);
