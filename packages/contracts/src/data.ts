import { z } from 'zod';

export const IdentifierSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
  .refine((value) => !['constructor', 'prototype', '__proto__'].includes(value), 'Reserved identifier.');
export const SafeIntegerSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const ScalarSchema = z.union([z.string().max(4096), SafeIntegerSchema, z.boolean()]);
export const ValuesSchema = z.record(IdentifierSchema, ScalarSchema).refine((value) => Object.keys(value).length <= 32, 'Too many fields.');
export type Values = z.infer<typeof ValuesSchema>;

// A small JSON Schema subset: flat objects, required scalar fields, no extra keys,
// fixed format names, and finite bounds. No supplied regex, $ref, coercion, or code.
const StringField = z.strictObject({
  type: z.literal('string'), minLength: z.number().int().min(0).max(4096).optional(),
  maxLength: z.number().int().min(1).max(4096),
  format: z.enum(['member-id', 'account-id', 'uuid']).optional(),
  enum: z.array(z.string().max(4096)).min(1).max(32).optional(),
}).superRefine((field, ctx) => {
  if ((field.minLength ?? 0) > field.maxLength) ctx.addIssue({ code: 'custom', message: 'Invalid string bounds.' });
  if (field.enum && new Set(field.enum).size !== field.enum.length) ctx.addIssue({ code: 'custom', message: 'Duplicate enum value.' });
  for (const value of field.enum ?? []) {
    if (value.length < (field.minLength ?? 0) || value.length > field.maxLength
      || (field.format === 'member-id' && !/^M\d{4}$/.test(value))
      || (field.format === 'account-id' && !/^[A-Z]\d{4}$/.test(value))
      || (field.format === 'uuid' && !z.uuid().safeParse(value).success)) {
      ctx.addIssue({ code: 'custom', message: 'Enum value violates declared bounds or format.' });
    }
  }
});
const IntegerField = z.strictObject({ type: z.literal('integer'), minimum: SafeIntegerSchema, maximum: SafeIntegerSchema })
  .refine((field) => field.minimum <= field.maximum, 'Invalid integer bounds.');
export const FieldSchema = z.union([StringField, IntegerField, z.strictObject({ type: z.literal('boolean') })]);
export type Field = z.infer<typeof FieldSchema>;
export const DataSchemaSchema = z.strictObject({
  type: z.literal('object'), properties: z.record(IdentifierSchema, FieldSchema),
  required: z.array(IdentifierSchema).min(1).max(32), additionalProperties: z.literal(false),
}).superRefine((schema, ctx) => {
  const keys = Object.keys(schema.properties);
  if (keys.length < 1 || keys.length > 32 || new Set(schema.required).size !== schema.required.length
    || keys.length !== schema.required.length || keys.some((key) => !schema.required.includes(key))) {
    ctx.addIssue({ code: 'custom', message: 'Every property must be required exactly once; maximum 32 properties.' });
  }
});
export type DataSchema = z.infer<typeof DataSchemaSchema>;

function scalarValidator(field: Field): z.ZodType {
  if (field.type === 'integer') return SafeIntegerSchema.min(field.minimum).max(field.maximum);
  if (field.type === 'boolean') return z.boolean();
  let validator = z.string().min(field.minLength ?? 0).max(field.maxLength);
  if (field.format === 'member-id') validator = validator.regex(/^M\d{4}$/);
  if (field.format === 'account-id') validator = validator.regex(/^[A-Z]\d{4}$/);
  if (field.format === 'uuid') validator = validator.uuid();
  return field.enum ? validator.refine((value) => field.enum!.includes(value), 'Value is not in the declared enum.') : validator;
}

export function validateData(schema: DataSchema, value: unknown): Values {
  const definition = DataSchemaSchema.parse(schema);
  const shape: Record<string, z.ZodType> = Object.create(null) as Record<string, z.ZodType>;
  for (const [name, field] of Object.entries(definition.properties)) shape[name] = scalarValidator(field);
  return ValuesSchema.parse(z.strictObject(shape).parse(value));
}

// Check complexity and plain JSON before recursive schema parsing. Do not invoke
// getters/toJSON or evaluate uploaded schema/selector strings.
export function isBoundedJson(value: unknown): boolean {
  let nodes = 0; let size = 0;
  const seen = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 20_000 || depth > 24) return false;
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item === 'string') { size += item.length; return size <= 131_072; }
    if (typeof item !== 'object' || seen.has(item)) return false;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return false;
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) return false;
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false;
      size += key.length;
      if (size > 131_072 || !visit(descriptor.value, depth + 1)) return false;
    }
    seen.delete(item);
    return true;
  }
  try { return visit(value, 0); } catch { return false; }
}
export const BoundedJsonSchema = z.unknown().transform((value, ctx) => {
  if (!isBoundedJson(value)) { ctx.addIssue({ code: 'custom', message: 'Expected bounded plain JSON data.' }); return z.NEVER; }
  return value;
});
