import { useEffect, useState } from 'react';
import { HealthResponseSchema } from '@interface-ai/contracts';

export function useServiceHealth() {
  const [status, setStatus] = useState<'checking' | 'connected' | 'unavailable'>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let active = true;
    setStatus('checking');
    void fetch('/api/healthz', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Service unavailable');
        const body = HealthResponseSchema.parse(await response.json());
        if (body.service !== 'automation') throw new Error('Unexpected service');
        if (active) setStatus('connected');
      })
      .catch(() => { if (active) setStatus('unavailable'); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [attempt]);
  return { status, retry: () => setAttempt((value) => value + 1) };
}
