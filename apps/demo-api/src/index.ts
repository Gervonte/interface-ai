import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { createPool } from '@interface-ai/postgres';
import { createApp } from './app.js';
import { DemoRepository } from './db/repository.js';

const config = z.object({
  HOST: z.string().min(1).default('127.0.0.1'), PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  DATABASE_URL: z.string().min(1).optional(),
}).safeParse(process.env);
if (!config.success) { console.error('Invalid demo server configuration. Check HOST, PORT, and DATABASE_URL.'); process.exit(1); }
const { HOST, PORT, DATABASE_URL } = config.data;
const pool = DATABASE_URL ? createPool(DATABASE_URL) : undefined;
const server = createApp({ ...(pool ? { repository: new DemoRepository(pool) } : {}),
  webDirectory: fileURLToPath(new URL('../../demo-web/dist/', import.meta.url)),
}).listen(PORT, HOST, () => console.info('Demo Credit Union listening on http://' + HOST + ':' + PORT));
server.on('error', () => { console.error('Server startup failed. Check that the host and port are available.'); void pool?.end(); process.exitCode = 1; });
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exitCode = 1; }, 5000); deadline.unref();
  server.close(() => { clearTimeout(deadline); void pool?.end().catch(() => { process.exitCode = 1; }); });
}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
