import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../app.js';
import { checkHostedFixture } from './check.js';
import { readBrowserbaseConfig } from './config.js';
import { getHostedSessionStatus, launchHostedFixture } from './provider.js';

async function main() {
  let config;
  try { config = readBrowserbaseConfig(process.env); }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid Browserbase configuration.');
    process.exitCode = 1;
    return;
  }
  // Exercise the real automation Express app concurrently, on a temporary local port.
  const server = createApp().listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing API address');
    const healthUrl = `http://127.0.0.1:${address.port}/healthz`;
    const result = await checkHostedFixture(config, {
      launch: launchHostedFixture,
      getStatus: getHostedSessionStatus,
      emit: (event) => console.info(JSON.stringify(event)),
      async probeHealth() {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
        const body: unknown = await response.json();
        if (!response.ok || typeof body !== 'object' || body === null
          || !('status' in body) || body.status !== 'ok'
          || !('service' in body) || body.service !== 'automation') {
          throw new Error('Automation health check failed.');
        }
      },
    });
    const destination = resolve(import.meta.dirname, '../../runtime/int-002-connectivity.json');
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    console.info(JSON.stringify(result, null, 2));
    console.info(`Sanitized result: ${destination}`);
    if (!result.success) process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
main().catch(() => {
  // Provider exceptions can contain authentication/connection URLs. Do not print them.
  console.error('Connectivity check failed. Check configuration and local fixture/tunnel availability.');
  process.exitCode = 1;
});
