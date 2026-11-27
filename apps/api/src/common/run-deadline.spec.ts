import { describe, expect, it } from 'vitest';
import { withRunDeadline } from './run-deadline';

describe('withRunDeadline', () => {
  it('distinguishes a server timeout from a client Stop', async () => {
    const external = new AbortController();
    const deadline = withRunDeadline(external.signal, 10);
    expect(deadline.expired()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(deadline.signal.aborted).toBe(true);
    expect(external.signal.aborted).toBe(false);
    expect(deadline.expired()).toBe(true);
  });

  it('does not mark a client disconnect as a deadline expiry', () => {
    const external = new AbortController();
    const deadline = withRunDeadline(external.signal, 60_000);
    external.abort();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.expired()).toBe(false);
  });

  it('can be disabled with a non-positive timeout', () => {
    const external = new AbortController();
    const deadline = withRunDeadline(external.signal, 0);
    expect(deadline.signal).toBe(external.signal);
    expect(deadline.expired()).toBe(false);
  });
});
