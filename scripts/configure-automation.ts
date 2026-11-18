import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const file = new URL('../apps/automation/.env', import.meta.url);
let text = '';
try { text = await readFile(file, 'utf8'); }
catch (error) { if (!(typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT')) throw error; }
const env = parseEnv(text);
if (!env.AUTOMATION_API_TOKEN) text = text.trimEnd() + '\nAUTOMATION_API_TOKEN=' + randomBytes(32).toString('hex') + '\n';
else if (!/^[0-9a-f]{64}$/.test(env.AUTOMATION_API_TOKEN)) throw new Error('Existing automation token is invalid; it was not replaced.');
await writeFile(file, text, { mode: 0o600 }); await chmod(file, 0o600);
console.info('Server-only automation authentication is configured in apps/automation/.env. No credentials were printed.');
