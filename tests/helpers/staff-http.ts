import type { ScenarioLoader } from '../../apps/demo-api/src/scenarios.js';
import { once } from 'node:events';
import { createApp } from '../../apps/demo-api/src/app.js';
import type { MemberStore } from '../../apps/demo-api/src/staff-router.js';

export async function staffServer(repository: MemberStore, sessionTtlMs?: number, scenario?: ScenarioLoader) {
  const server = createApp({ repository, ...(scenario ? {scenario} : {}), ...(sessionTtlMs ? { sessionTtlMs } : {}) }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
  const base = `http://127.0.0.1:${address.port}`;
  const client = () => {
    let cookie = '';
    return async (path: string, body?: unknown, origin = base) => {
      const response = await fetch(base + '/api/staff' + path, {
        headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      });
      const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]!;
      return response;
    };
  };
  return { client, close: () => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve());
  }) };
}
export type StaffClient = ReturnType<Awaited<ReturnType<typeof staffServer>>['client']>;
export async function selectMember(client: StaffClient, memberId: string) {
  const search = await client('/search', { memberId });
  if (search.status !== 200) throw new Error('Search failed');
  const result = await search.json() as { searchRevision: number };
  return client('/selection', { memberId, searchRevision: result.searchRevision });
}
