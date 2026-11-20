import { z } from 'zod';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPool } from '@interface-ai/postgres';
import { createApp } from './app.js';
import { AutomationRepository, loadConfigurations } from './db/repository.js';
import { Coordinator } from './execution/coordinator.js';
import { EvidenceStore } from './execution/evidence.js';
import { workflowWorker } from './workflows/worker.js';
import { BrowserbaseSessions } from './execution/provider.js';

async function main() {
  const env = z.object({ HOST: z.string().min(1).default('127.0.0.1'), PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.string().min(1).optional(), REQUEST_FINGERPRINT_KEY: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    AUTOMATION_API_TOKEN: z.string().regex(/^[a-f0-9]{64}$/).optional(), BROWSERBASE_API_KEY: z.string().min(1).optional(), BROWSERBASE_PROJECT_ID: z.uuid().optional(),
    AUTOMATION_TARGET_FILE: z.string().min(1).optional(), AUTOMATION_POLICY_FILE: z.string().min(1).optional(),
  }).safeParse(Object.fromEntries(Object.entries(process.env).filter(([_key, value]) => value !== '')));
  if (!env.success) throw new Error('Invalid server configuration');
  const config = env.data;
  const configured = !!(config.DATABASE_URL && config.REQUEST_FINGERPRINT_KEY && config.AUTOMATION_API_TOKEN);
  if (!!config.AUTOMATION_TARGET_FILE !== !!config.AUTOMATION_POLICY_FILE) throw new Error('Both configuration files are required');
  const pool = configured ? createPool(config.DATABASE_URL!) : undefined;
  let coordinator: Coordinator | undefined;
  try {
    if (pool) {
      const configuration = await loadConfigurations(config.AUTOMATION_TARGET_FILE && config.AUTOMATION_POLICY_FILE
        ? { target: pathToFileURL(resolve(config.AUTOMATION_TARGET_FILE)), policy: pathToFileURL(resolve(config.AUTOMATION_POLICY_FILE)) }
        : { target: new URL('../config/target.v3.json', import.meta.url), policy: new URL('../config/policy.v3.json', import.meta.url) });
      const sessions = config.BROWSERBASE_API_KEY && config.BROWSERBASE_PROJECT_ID ? new BrowserbaseSessions(config.BROWSERBASE_API_KEY, config.BROWSERBASE_PROJECT_ID) : undefined;
      coordinator = new Coordinator(new AutomationRepository(pool, config.REQUEST_FINGERPRINT_KEY!), config.REQUEST_FINGERPRINT_KEY!, configuration,
        new EvidenceStore(resolve(import.meta.dirname, '../runtime/evidence')), sessions, workflowWorker);
      await coordinator.start();
    }
    const server = createApp(coordinator ? { coordinator, identities: [{ token: config.AUTOMATION_API_TOKEN!, principal: 'demo-operator', access: 'operator' }] } : {})
      .listen(config.PORT, config.HOST, () => console.info('Automation API listening on http://' + config.HOST + ':' + config.PORT));
    server.on('error', () => { console.error('Automation listener failed. Check host/port availability.'); void coordinator?.stop().finally(() => pool?.end()); process.exitCode = 1; });
    let stopping = false;
    const stop = () => {
      if (stopping) return; stopping = true;
      server.close(); server.closeAllConnections();
      void coordinator?.stop().catch(() => { console.error('Shutdown cleanup unconfirmed; restart reconciliation is required.'); process.exitCode = 1; }).finally(() => pool?.end());
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) { await coordinator?.stop(); await pool?.end(); throw error; }
}
main().catch(() => { console.error('Automation startup failed. Check database migrations, private authentication/configuration, and coordinator ownership. No credentials were printed.'); process.exitCode = 1; });
