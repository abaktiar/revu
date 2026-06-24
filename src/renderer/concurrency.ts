// Bounded-concurrency runner. Used so the diff viewer doesn't fire dozens of
// `prs:file-diff` IPC calls in parallel when several sections enter the
// viewport during a fast scroll — each of those triggers two GetBlob AWS calls
// in the main process, and the pile-up was freezing the app on large PRs.
export interface Semaphore {
  // `key` tags the waiter so a later `prioritize(key)` can jump it forward in
  // the queue (used to load the file the user just navigated to first).
  acquire<T>(fn: () => Promise<T>, key?: string): Promise<T>;
  // Move the still-queued waiter with this key to the front of the queue. No-op
  // if it's already running (slot acquired) or not queued.
  prioritize(key: string): void;
}

export function createSemaphore(max: number): Semaphore {
  let active = 0;
  interface Waiter {
    resolve: () => void;
    key?: string;
  }
  const queue: Waiter[] = [];

  function tryNext(): void {
    if (active >= max) return;
    const next = queue.shift();
    if (!next) return;
    active += 1;
    next.resolve();
  }

  return {
    async acquire<T>(fn: () => Promise<T>, key?: string): Promise<T> {
      await new Promise<void>((resolve) => {
        queue.push({ resolve, key });
        tryNext();
      });
      try {
        return await fn();
      } finally {
        active -= 1;
        tryNext();
      }
    },
    prioritize(key: string): void {
      // The whole PR background-loads on open, so the file a reviewer clicks
      // (often the last one in the list) can be stuck at the back of the queue
      // behind every other file's fetch — which reads as "the click didn't
      // load anything." Hoisting it to the front means it grabs the next freed
      // permit instead of waiting its turn.
      const i = queue.findIndex((w) => w.key === key);
      if (i > 0) {
        const [w] = queue.splice(i, 1);
        queue.unshift(w!);
      }
    },
  };
}

// Global limit for `api.prs.fileDiff` calls from FileDiffSection. The whole PR's
// files are now background-loaded on open (so sidebar navigation always lands
// and there's no "scroll to load" wait), so this paces that fill. Kept modest:
// each completed fetch only builds cheap per-hunk *placeholders* for offscreen
// files (HunkView defers the real rows + highlighting until a hunk nears the
// viewport), so the dominant cost is the main-process blob fetch + diff, which
// a handful of concurrent calls saturates without freezing the renderer.
export const fileDiffSemaphore = createSemaphore(6);
