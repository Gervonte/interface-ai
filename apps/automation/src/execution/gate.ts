import { ExecutionError } from './errors.js';

// Closing admission never makes an in-flight command disappear or release its slot.
export class DispatchGate {
  private busy = false;
  private closed = false;
  private revision: number;
  private pending: Promise<unknown> | undefined;
  constructor(revision: number) { this.revision = revision; }
  snapshot() { return { revision: this.revision, busy: this.busy, closed: this.closed }; }
  check(revision: number) {
    if (this.closed || revision !== this.revision) throw new ExecutionError('CONTROL_CHANGED');
  }
  async dispatch<T>(revision: number, operation: () => Promise<T>): Promise<T> {
    this.check(revision);
    if (this.busy) throw new ExecutionError('ACTION_IN_FLIGHT');
    this.busy = true;
    const work = Promise.resolve().then(() => { this.check(revision); return operation(); });
    this.pending = work;
    try { return await work; }
    finally { this.busy = false; if (this.pending === work) this.pending = undefined; }
  }
  close() { if (!this.closed) { this.closed = true; this.revision++; } }
  reopen(revision: number) {
    if (!this.closed || this.busy || revision < this.revision) throw new ExecutionError('CONTROL_CHANGED');
    this.closed = false; this.revision = revision;
  }
  async drain(timeoutMs: number) {
    if (!this.pending) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.pending.then(() => true, () => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
}
