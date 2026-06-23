import type { QueueInterface } from '../../domain/queue/queue-interface.js';

/**
 * InMemoryQueue — concurrency-limited + inter-request-delayed executor.
 *
 * NOT a persistent work queue: tasks run in-process and the caller awaits the
 * result. With `concurrency = 1` it serializes Playwright page loads (DF-5)
 * and applies a configurable delay after each task completes, isolating the
 * worker so the query/analytics API is never starved (DF-7). Surplus requests
 * are buffered in `backlog` (queued, not rejected).
 *
 * Swap for BullMQ/Redis behind the same `QueueInterface` when resilience is
 * needed (design open question).
 */
export class InMemoryQueue implements QueueInterface {
  private readonly concurrency: number;
  private readonly delayMs: number;
  private active = 0;
  private readonly backlog: Array<() => void> = [];

  constructor(opts: { concurrency: number; delayMs: number }) {
    this.concurrency = opts.concurrency;
    this.delayMs = opts.delayMs;
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.backlog.length;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const runTask = async (): Promise<void> => {
        this.active += 1;
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.active -= 1;
          // Rate-limit: pause before releasing the slot (DF-5 inter-request delay).
          if (this.delayMs > 0) {
            setTimeout(() => this.drain(), this.delayMs);
          } else {
            void this.drain();
          }
        }
      };

      if (this.active < this.concurrency) {
        void runTask();
      } else {
        // At capacity — park until a slot frees (queued, NOT rejected).
        this.backlog.push(runTask);
      }
    });
  }

  /** Promote the next waiting task, if any, into an active slot. */
  private drain(): void {
    const next = this.backlog.shift();
    if (next) void next();
  }
}
