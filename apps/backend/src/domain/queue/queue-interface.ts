/**
 * QueueInterface — a concurrency-limited, rate-limited executor used to isolate
 * the Playwright document worker from the query/analytics API (DF-5, DF-7).
 *
 * Despite the "queue" name, the operation model is `run(task) → Promise<Result>`:
 * the caller awaits the result. With `concurrency = 1` this degenerates into a
 * mutex that serializes Playwright page loads so the government source is never
 * hammered (max 1 concurrent + delay between requests). A surplus request is
 * queued (NOT rejected) — satisfying the "Concurrent requests rate-limited"
 * scenario. This keeps the worker isolated from the Express event loop while
 * still letting the fetch endpoint return synchronously (per PR4 instruction).
 */
export interface QueueInterface {
  /**
   * Enqueue a task respecting the concurrency cap + inter-request delay.
   * Resolves/rejects with the task's own outcome once it runs.
   */
  run<T>(task: () => Promise<T>): Promise<T>;

  /** How many tasks are currently executing (0 or 1 at concurrency=1). */
  readonly activeCount: number;

  /** How many tasks are waiting in the backlog. */
  readonly pendingCount: number;
}
