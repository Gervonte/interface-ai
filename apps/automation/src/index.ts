import { z } from 'zod';
import { createApp } from './app.js';

const config = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
}).safeParse(process.env);

if (!config.success) {
  console.error('Invalid server configuration. Check HOST and PORT.');
  process.exit(1);
}

const { HOST, PORT } = config.data;
const server = createApp().listen(PORT, HOST, () => {
  console.info('automation API listening on http://' + HOST + ':' + PORT);
});
server.on('error', () => {
  console.error('Server startup failed. Check that the host and port are available.');
  process.exitCode = 1;
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exitCode = 1;
  }, 5000);
  deadline.unref();
  server.close(() => clearTimeout(deadline));
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
