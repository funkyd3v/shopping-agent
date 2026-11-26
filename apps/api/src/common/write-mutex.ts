/**
 * Process-wide write mutex (PLAN §9.3/§18). Order, checkout, and cancel writes
 * are serialized so a single-instance deployment can rely on a short
 * interactive transaction plus a pre-transaction idempotency read.
 *
 * The lock is FIFO: the first caller to queue runs, everyone else waits.
 * Nested `run` calls would deadlock, so a task must never take the lock twice.
 */
export class WriteMutex {
  private tail: Promise<void> = Promise.resolve();
  private held = 0;

  /** Number of queued/running sections (0 when idle). Used by tests. */
  get depth(): number {
    return this.held;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    const release = this.acquire();
    const result = this.tail.then(() => task());
    // Keep the chain alive even when a task rejects, then release.
    const chained = result.then(
      (value) => {
        release();
        return value;
      },
      (error: unknown) => {
        release();
        throw error;
      },
    );
    // Prevent unhandled-rejection warnings on the shared tail.
    this.tail = chained.then(
      () => undefined,
      () => undefined,
    );
    return chained;
  }

  private acquire(): () => void {
    this.held += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held -= 1;
    };
  }
}
