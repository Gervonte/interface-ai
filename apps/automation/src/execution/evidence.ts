import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { BrowserSurface, SurfacePolicy } from './surface.js';
import { ExecutionError } from './errors.js';

const label = z.string().max(500).nullable();
const snapshotSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('structural-snapshot'), redactedValues: z.literal(true),
  omittedFrames: z.number().int().min(0).max(1000), documents: z.array(z.strictObject({ depth: z.number().int().min(0).max(4),
    headings: z.array(z.strictObject({ kind: z.string().regex(/^(h[123]|div|section|dialog)$/), label })).max(30),
    controls: z.array(z.strictObject({ kind: z.enum(['button', 'input', 'textarea', 'select', 'a']), label, enabled: z.boolean() })).max(80),
    tables: z.array(z.strictObject({ columns: z.array(label).max(16), rowCount: z.number().int().min(0).max(1000) })).max(8),
  })).max(8) });
const envelope = z.strictObject({ evidenceId: z.uuid(), runId: z.uuid(), stepId: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/).nullable(),
  capturedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), sanitizationVersion: z.literal(1), snapshot: snapshotSchema });
const staticLabels = ['Staff workspace', 'Member Search', 'Member Overview', 'Account Inquiry', 'Account Details', 'No matching member',
  'No primary savings account', 'Access denied', 'Unable to continue', 'Member ID', 'Account ID', 'Account Type', 'Designation', 'Status',
  'Servicing notice', 'Servicing review required', 'Staff session expired', 'Acknowledge notice', 'Dismiss servicing review', 'Restore staff session', 'Account inquiry unavailable', 'Member search validation error', 'Loading servicing screen', 'Searched Member ID', 'Current Balance', 'Available Balance', 'Currency', 'Action', 'Member Name', 'Membership Status'];
export class EvidenceStore {
  constructor(private readonly directory: string, private readonly now: () => number = Date.now) {}
  async capture(runId: string, stepId: string | null, surface: Pick<BrowserSurface, 'snapshot'>, policy: SurfacePolicy) {
    const snapshot = snapshotSchema.parse(await surface.snapshot(policy));
    const allowed = new Set([...staticLabels, ...policy.allowedClickNames, ...policy.allowedFillNames]);
    // Validate the actual outbound payload, even if the adapter supplies unexpected data.
    for (const doc of snapshot.documents) {
      for (const field of [...doc.headings, ...doc.controls]) if (field.label !== null && !allowed.has(field.label)) throw new ExecutionError('EVIDENCE_UNAVAILABLE');
      if (doc.tables.some(table => table.columns.some(value => value !== null && !allowed.has(value)))) throw new ExecutionError('EVIDENCE_UNAVAILABLE');
    }
    const id = randomUUID(); const time = this.now();
    const data = envelope.parse({ evidenceId: id, runId, stepId, capturedAt: new Date(time).toISOString(), expiresAt: new Date(time + 86_400_000).toISOString(), sanitizationVersion: 1, snapshot });
    const folder = join(this.directory, z.uuid().parse(runId)); await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(join(folder, id + '.json'), JSON.stringify(data) + '\n', { flag: 'wx', mode: 0o600 });
    return id;
  }
  async read(runId: string, id: string) {
    const file = await open(join(this.directory, z.uuid().parse(runId), z.uuid().parse(id) + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if ((await file.stat()).size > 65_536) throw new ExecutionError('EVIDENCE_UNAVAILABLE');
      const data = envelope.parse(JSON.parse(await file.readFile('utf8')));
      if (data.runId !== runId || data.evidenceId !== id || Date.parse(data.expiresAt) <= this.now()) throw new ExecutionError('EVIDENCE_UNAVAILABLE');
      return data;
    } finally { await file.close(); }
  }
}
