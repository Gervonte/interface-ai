import { z } from 'zod';
import { createCompatibilityFixture } from './compatibility-fixture.js';

const port = z.coerce.number().int().min(1).max(65535).safeParse(process.env.FIXTURE_PORT ?? 3003);
if (!port.success) {
  console.error('Invalid FIXTURE_PORT. Expected a port from 1 to 65535.');
  process.exit(1);
}
const server = createCompatibilityFixture().listen(port.data, '127.0.0.1', () => {
  console.info(`Compatibility fixture: http://127.0.0.1:${port.data}/compatibility`);
});
server.on('error', () => {
  console.error('Fixture startup failed. Check that FIXTURE_PORT is available.');
  process.exitCode = 1;
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => server.closeAllConnections(), 5000);
  deadline.unref();
  server.close(() => clearTimeout(deadline));
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
