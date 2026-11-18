import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { createPool } from '@interface-ai/postgres';
import { migrateAutomation } from '../apps/automation/src/db/repository.js';
import { migrateDemo, resetDemoFixtures } from '../apps/demo-api/src/db/repository.js';
import { databaseSettings, grantRuntime, initializeLocalSecrets, provision, readSecrets } from './database-support.js';

const root = new URL('../', import.meta.url);
async function main() {
  const command = process.argv[2];
  if (command === 'up' || command === 'down') {
    if (command === 'up') await initializeLocalSecrets(root);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('docker', ['compose', '--env-file', '.env.database', '-f', 'compose.database.yaml', '-p', 'interface-ai-db', ...(command === 'up' ? ['up', '-d', '--wait'] : ['down'])], { cwd: root, stdio: 'inherit' });
      child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Docker database command failed.')));
    });
    return;
  }
  const secrets = readSecrets(parseEnv(await readFile(new URL('.env.database', root), 'utf8')));
  const settings = databaseSettings(secrets);
  if (command === 'setup') await provision(settings);
  else if (command !== 'migrate' && command !== 'reset-demo') throw new Error('Unknown database command.');
  const automation = createPool(settings.automation.migratorUrl); const demo = createPool(settings.demo.migratorUrl);
  try {
    if (command !== 'reset-demo') {
      const automationCount = await migrateAutomation(automation); const demoCount = await migrateDemo(demo);
      await grantRuntime(automation, 'automation', settings.automation.app); await grantRuntime(demo, 'demo', settings.demo.app);
      console.info(`Migrations applied: automation ${automationCount}, demo ${demoCount}.`);
    }
    if (command === 'setup' || command === 'reset-demo') {
      await resetDemoFixtures(demo); console.info('Synthetic baseline members/accounts reset (fixture version 1).');
    }
  } finally { await Promise.all([automation.end(), demo.end()]); }
}
main().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,50}$/.test(error.code) ? error.code : 'SETUP_FAILED';
  console.error(`Database command failed (${code}). Check Docker availability and the private local database configuration. No credentials were printed.`);
  process.exitCode = 1;
});
