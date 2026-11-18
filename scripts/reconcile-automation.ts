import { createPool } from '@interface-ai/postgres';
import { resolve } from 'node:path';
import { AutomationRepository, loadConfigurations } from '../apps/automation/src/db/repository.js';
import { Coordinator } from '../apps/automation/src/execution/coordinator.js';
import { EvidenceStore } from '../apps/automation/src/execution/evidence.js';
import { BrowserbaseSessions } from '../apps/automation/src/execution/provider.js';
async function main() {
  if (!process.env.DATABASE_URL || !process.env.REQUEST_FINGERPRINT_KEY) throw new Error('Missing database configuration');
  const pool = createPool(process.env.DATABASE_URL);
  const sessions = process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID ? new BrowserbaseSessions(process.env.BROWSERBASE_API_KEY, process.env.BROWSERBASE_PROJECT_ID) : undefined;
  const coordinator = new Coordinator(new AutomationRepository(pool, process.env.REQUEST_FINGERPRINT_KEY), process.env.REQUEST_FINGERPRINT_KEY,
    await loadConfigurations(), new EvidenceStore(resolve('apps/automation/runtime/evidence')), sessions);
  try {
    await coordinator.start();
    const blocked = (await coordinator.repository.sessions()).filter(row => row.session_state !== 'none' && row.session_state !== 'closed');
    console.info(JSON.stringify({ reconciled: true, admissionBlocked: blocked.length > 0, occupiedSessions: blocked.length }));
    if (blocked.length) process.exitCode = 1;
  } finally { await coordinator.stop(); await pool.end(); }
}
main().catch(() => { console.error('Reconciliation failed. Stop other coordinators and check database/provider configuration. No credentials were printed.'); process.exitCode = 1; });
