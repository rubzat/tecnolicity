import { describe, it, expect, vi } from 'vitest';
import { InMemoryQueue } from './in-memory-queue.js';

describe('InMemoryQueue', () => {
  it('runs tasks immediately when under the concurrency cap', async () => {
    const q = new InMemoryQueue({ concurrency: 2, delayMs: 0 });
    const a = vi.fn(async () => 'a');
    const b = vi.fn(async () => 'b');

    const [ra, rb] = await Promise.all([q.run(a), q.run(b)]);

    expect(ra).toBe('a');
    expect(rb).toBe('b');
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('serializes tasks at concurrency=1 (never two active at once)', async () => {
    const q = new InMemoryQueue({ concurrency: 1, delayMs: 0 });
    let active = 0;
    let maxActive = 0;

    const task = async (label: string): Promise<string> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return label;
    };

    const results = await Promise.all([
      q.run(() => task('a')),
      q.run(() => task('b')),
      q.run(() => task('c')),
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
    // Never exceeded the cap.
    expect(maxActive).toBe(1);
  });

  it('queues (does not reject) a surplus request (DF-5)', async () => {
    const q = new InMemoryQueue({ concurrency: 1, delayMs: 0 });
    const order: string[] = [];
    const slow = new Promise<void>((r) => setTimeout(r, 15));

    const p1 = q.run(async () => {
      order.push('start-1');
      await slow;
      order.push('end-1');
    });
    const p2 = q.run(async () => {
      order.push('start-2');
    });

    // While task 1 runs, task 2 is waiting in the backlog.
    expect(q.pendingCount).toBe(1);
    await Promise.all([p1, p2]);
    expect(order).toEqual(['start-1', 'end-1', 'start-2']);
  });

  it('applies the inter-request delay between tasks', async () => {
    vi.useFakeTimers();
    try {
      const q = new InMemoryQueue({ concurrency: 1, delayMs: 100 });
      const events: string[] = [];

      // Task 1 takes 50ms (simulated) so task 2 is enqueued WHILE task 1 is
      // still active — that is the only situation the delay gates.
      const p1 = q.run(async () => {
        await new Promise<void>((r) => setTimeout(r, 50));
        events.push('done-1');
      });
      await vi.advanceTimersByTimeAsync(0); // flush so task 1 starts (active=1)

      // Task 2 arrives while task 1 runs → parked in the backlog.
      const p2 = q.run(async () => {
        events.push('done-2');
      });
      expect(q.pendingCount).toBe(1);

      // Advance past task 1's duration → it finishes, delay timer armed (100ms).
      await vi.advanceTimersByTimeAsync(50);
      expect(events).toEqual(['done-1']);

      // Just before the delay elapses → task 2 still hasn't started.
      await vi.advanceTimersByTimeAsync(99);
      expect(events).toEqual(['done-1']);

      // Delay elapses → task 2 starts and completes.
      await vi.advanceTimersByTimeAsync(5);
      await p1;
      await p2;
      expect(events).toEqual(['done-1', 'done-2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates task rejections to the caller', async () => {
    const q = new InMemoryQueue({ concurrency: 1, delayMs: 0 });
    await expect(q.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // Queue still drains after a failure.
    const r = await q.run(async () => 'ok');
    expect(r).toBe('ok');
  });
});
