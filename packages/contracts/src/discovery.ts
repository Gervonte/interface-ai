import { z } from 'zod';
import { FieldSchema, IdentifierSchema, DataSchemaSchema } from './data.js';
import type { DataSchema } from './data.js';

export const AccountSelectionSchema = z.strictObject({
  type: z.enum(['savings', 'checking']), designation: z.enum(['Primary', 'Standard']), status: z.enum(['ACTIVE', 'CLOSED']),
});
export type AccountSelection = z.infer<typeof AccountSelectionSchema>;
export const OutputMeaningSchema = z.enum(['member-id', 'account-id', 'account-type', 'current-balance', 'available-balance', 'currency']);
export type OutputMeaning = z.infer<typeof OutputMeaningSchema>;
// Meanings are bounded metadata, not arbitrary instructions or record values.
export const OutputContractSchema = z.strictObject({
  account: AccountSelectionSchema,
  fields: z.record(IdentifierSchema, z.strictObject({ meaning: OutputMeaningSchema, schema: FieldSchema })),
}).superRefine((contract, ctx) => {
  const entries = Object.entries(contract.fields);
  const meanings = entries.map(([, field]) => field.meaning);
  if (entries.length < 5 || entries.length > 6 || new Set(meanings).size !== meanings.length
    || ['member-id', 'account-id', 'account-type', 'currency'].some(meaning => !meanings.includes(meaning as OutputMeaning))
    || !meanings.some(meaning => ['current-balance', 'available-balance'].includes(meaning))) {
    ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Require distinct identity/type/currency meanings and at least one balance meaning; maximum six outputs.' });
  }
  for (const [name, { meaning, schema }] of entries) {
    let valid = false;
    if (meaning === 'member-id' || meaning === 'account-id') {
      valid = schema.type === 'string' && schema.format === meaning && schema.maxLength === 5 && schema.enum === undefined;
    } else if (meaning === 'account-type') {
      valid = schema.type === 'string' && schema.format === undefined && schema.maxLength >= contract.account.type.length
        && schema.enum?.length === 1 && schema.enum[0] === contract.account.type;
    } else if (meaning === 'currency') {
      valid = schema.type === 'string' && schema.format === undefined && schema.maxLength === 3 && schema.enum?.length === 1 && schema.enum[0] === 'USD';
    } else valid = schema.type === 'integer' && schema.minimum >= 0;
    if (!valid) ctx.addIssue({ code: 'custom', path: ['fields', name, 'schema'], message: 'Output type/format conflicts with its meaning or requested account; identity literal enums are unsupported.' });
  }
});
export type RequestedOutputContract = z.infer<typeof OutputContractSchema>;
export function outputSchemaFor(value: RequestedOutputContract): DataSchema {
  const contract = OutputContractSchema.parse(value);
  const entries = Object.entries(contract.fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return DataSchemaSchema.parse({ type: 'object', properties: Object.fromEntries(entries.map(([name, field]) => [name, field.schema])),
    required: entries.map(([name]) => name), additionalProperties: false });
}
