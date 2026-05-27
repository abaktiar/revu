// Bounded-concurrency runner. Used so the diff viewer doesn't fire dozens of
// `prs:file-diff` IPC calls in parallel when several sections enter the
// viewport during a fast scroll — each of those triggers two GetBlob AWS calls
// in the main process, and the pile-up was freezing the app on large PRs.
export interface Semaphore {
  acquire<T>(fn: () => Promise<T>): Promise<T>;
}

export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const queue: Array<() => void> = [];

  function tryNext(): void {
    if (active >= max) return;
    const next = queue.shift();
    if (!next) return;
    active += 1;
    next();
  }

  return {
    async acquire<T>(fn: () => Promise<T>): Promise<T> {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
        tryNext();
      });
      try {
        return await fn();
      } finally {
        active -= 1;
        tryNext();
      }
    },
  };
}

// Global limit for `api.prs.fileDiff` calls from FileDiffSection. Keep small —
// the cost is dominated by the renderer-side render+highlight that follows
// each completed fetch, not by the network.
export const fileDiffSemaphore = createSemaphore(3);
