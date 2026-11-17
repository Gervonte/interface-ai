import { resolve } from 'node:path';
import { readBrowserbaseConfig } from './config.js';
import { SdkSpike } from './spike.js';
import { createSpikeApp } from './spike-server.js';

let config;
try { config = readBrowserbaseConfig(process.env); }
catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid Browserbase configuration.');
  process.exit(1);
}
const directory = resolve(import.meta.dirname, '../../runtime/int-003');
const spike = new SdkSpike(config, directory);
const origin = 'http://127.0.0.1:3004';
const server = createSpikeApp(spike, origin).listen(3004, '127.0.0.1', () => {
  console.info(`INT-003 operator check: ${origin}`);
  console.info('Open the page and click Start live check when ready. No hosted session opens before that click.');
  console.info(`Runtime results: ${directory}`);
});
server.on('error', () => { console.error('Operator check could not start. Check that port 3004 is free.'); process.exitCode = 1; });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await spike.stop();
  server.closeAllConnections();
  server.close();
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
