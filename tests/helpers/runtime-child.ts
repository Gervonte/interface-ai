import { createPool } from '@interface-ai/postgres';
import { AutomationRepository, loadConfigurations } from '../../apps/automation/src/db/repository.js';
import { Coordinator } from '../../apps/automation/src/execution/coordinator.js';
import { EvidenceStore } from '../../apps/automation/src/execution/evidence.js';
import { createApp } from '../../apps/automation/src/app.js';
const pool = createPool(process.env.AUTOMATION_TEST_DB!);
const coordinator = new Coordinator(new AutomationRepository(pool, process.env.REQUEST_FINGERPRINT_KEY!), process.env.REQUEST_FINGERPRINT_KEY!, await loadConfigurations(),
  new EvidenceStore(process.env.AUTOMATION_TEST_EVIDENCE!), { async open() { await new Promise(() => {}); throw new Error('unreachable'); }, async reconcile() { return false; } },
  async (_request, context) => { await context.executor({}); });
await coordinator.start();
const server = createApp({ coordinator, identities: [{ token: 'a'.repeat(64), principal: 'test-operator', access: 'operator' }] }).listen(0, '127.0.0.1', () => {
  const address = server.address(); if (address && typeof address !== 'string') process.send?.({ port: address.port });
});
