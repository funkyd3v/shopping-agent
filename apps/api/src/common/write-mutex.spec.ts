import { describe, expect, it } from 'vitest';
import { WriteMutex } from './write-mutex';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('WriteMutex', () => {
  it('runs queued sections one at a time in FIFO order', async () => {
    const mutex = new WriteMutex();
    const order: number[] = [];
    let running = 0;
    let maxConcurrent = 0;

    const task = (id: number) => async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      order.push(id);
      await tick();
      running -= 1;
      return id;
    };

    const results = await Promise.all([mutex.run(task(1)), mutex.run(task(2)), mutex.run(task(3))]);

    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(maxConcurrent).toBe(1);
    expect(mutex.depth).toBe(0);
  });

  it('releases the lock when a task rejects', async () => {
    const mutex = new WriteMutex();

    await expect(mutex.run(async () => 'ok')).resolves.toBe('ok');
    await expect(
      mutex.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(mutex.depth).toBe(0);
    await expect(mutex.run(async () => 'after')).resolves.toBe('after');
  });

  it('reports queued sections as depth', async () => {
    const mutex = new WriteMutex();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = mutex.run(() => gate);
    const second = mutex.run(async () => 'second');
    expect(mutex.depth).toBe(2);

    release();
    await first;
    await second;
    expect(mutex.depth).toBe(0);
  });
});
