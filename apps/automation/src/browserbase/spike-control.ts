export type Owner = 'automation' | 'human' | 'none';
export class ControlConflict extends Error {
  constructor() { super('Control changed, an action is in flight, or this view is stale. Refresh and try again.'); }
}

// Compatibility-spike gate only. Durable run/intervention coordination is INT-013.
export class SpikeControl {
  private owner: Owner = 'automation';
  private revision = 1;
  private busy = false;
  private closed = false;
  snapshot() { return { owner: this.owner, revision: this.revision, busy: this.busy, closed: this.closed }; }
  private check(owner: Owner, revision: number) {
    if (this.closed || this.busy || this.owner !== owner || revision !== this.revision) throw new ControlConflict();
  }
  async dispatch<T>(actor: Exclude<Owner, 'none'>, revision: number, operation: () => Promise<T>): Promise<T> {
    this.check(actor, revision);
    this.busy = true;
    try { return await operation(); }
    finally { this.busy = false; }
  }
  pause(revision: number) {
    this.check('automation', revision);
    this.owner = 'none';
    return ++this.revision;
  }
  claim(revision: number) {
    this.check('none', revision);
    this.owner = 'human';
    return ++this.revision;
  }
  async resume(revision: number, validate: () => Promise<boolean>) {
    this.check('human', revision);
    this.owner = 'none';
    this.revision++;
    this.busy = true;
    try {
      if (!await validate()) throw new ControlConflict();
      this.owner = 'automation';
      return this.revision;
    } finally { this.busy = false; }
  }
  close() { this.closed = true; this.owner = 'none'; this.revision++; }
}

export function assertFreshObservation(
  observation: { id: string; revision: number; createdAt: number; fingerprint: string },
  request: { observationId: string; revision: number },
  fingerprint: string,
  now = Date.now(),
) {
  if (observation.id !== request.observationId || observation.revision !== request.revision
    || now - observation.createdAt > 60_000 || observation.fingerprint !== fingerprint) throw new ControlConflict();
}
