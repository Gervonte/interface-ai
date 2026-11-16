import { isIP } from 'node:net';
import { z } from 'zod';

const fixtureUrl = z.url().refine((value) => {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && !url.port && url.pathname === '/compatibility'
    && !isIP(url.hostname) && !url.hostname.startsWith('[')
    && url.hostname.includes('.') && !url.hostname.endsWith('.')
    && !['localhost', 'local', 'internal', 'test', 'invalid'].some((suffix) => url.hostname.endsWith(`.${suffix}`));
}, 'Use a public HTTPS URL ending in /compatibility, without credentials, port, query, or fragment.');

const configSchema = z.object({
  BROWSERBASE_API_KEY: z.string().trim().min(1),
  BROWSERBASE_PROJECT_ID: z.uuid(),
  BROWSERBASE_FIXTURE_URL: fixtureUrl,
});

export const browserbaseSettings = {
  modelName: 'openai/gpt-5',
  region: 'us-west-2',
  sessionTimeoutSeconds: 180,
  requestTimeoutMs: 30_000,
  navigationTimeoutMs: 20_000,
} as const;

export function readBrowserbaseConfig(env: NodeJS.ProcessEnv) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    // Zod issues and input values can contain credentials. Expose field names only.
    const fields = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid Browserbase configuration. Check ${fields.join(', ')} in apps/automation/.env.`);
  }
  return {
    apiKey: result.data.BROWSERBASE_API_KEY,
    projectId: result.data.BROWSERBASE_PROJECT_ID,
    fixtureUrl: result.data.BROWSERBASE_FIXTURE_URL,
  };
}
export type BrowserbaseConfig = ReturnType<typeof readBrowserbaseConfig>;
