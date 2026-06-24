// Worker-thread pool for CPU-bound file-diff computation.
//
// Diffing happens in the main process, but `structuredPatch` is synchronous and
// can take seconds on a large file (e.g. a regenerated package-lock.json),
// blocking the main event loop and freezing the UI. This pool hands the
// computation to a small set of worker threads so the main thread only pays the
// cost of shipping the text across (a fast memcpy) and stays responsive.
//
// Graceful degradation: if a worker can't be spawned (or one dies mid-flight),
// we fall back to running `computeFileDiff` synchronously on the main thread —
// the feature keeps working, just without the offload.
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { join } from 'node:path';
import type { FileDiff } from '@shared/types';
import {
  computeFileDiff,
  type ComputeFileDiffInput,
} from './computeFileDiff';

// The worker is emitted next to this module in the build output (out/main/).
// electron.vite.config.ts adds it as a second main-process entry.
const WORKER_PATH = join(__dirname, 'diffWorker.js');

// Leave a core for the main thread + renderer; a handful of workers is plenty
// since the renderer already caps concurrent diff requests.
const POOL_SIZE = Math.min(4, Math.max(2, cpus().length - 1));

interface Pending {
  resolve: (d: FileDiff) => void;
  reject: (e: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  // Ids of jobs currently in flight on this worker, so we can reject exactly
  // those (and only those) if it dies.
  jobs: Set<number>;
}

interface WorkerReply {
  id: number;
  result?: FileDiff;
  error?: string;
}

let pool: PoolWorker[] | null = null;
// Set once spawning fails so we stop retrying and just run on the main thread.
let poolBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function makeWorker(): PoolWorker {
  const worker = new Worker(WORKER_PATH);
  const pw: PoolWorker = { worker, jobs: new Set() };

  worker.on('message', (msg: WorkerReply) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    pw.jobs.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result as FileDiff);
  });

  const onDead = (err: Error): void => {
    // Reject just this worker's in-flight jobs; other workers are unaffected.
    for (const id of pw.jobs) {
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        p.reject(err);
      }
    }
    pw.jobs.clear();
    if (pool) pool = pool.filter((w) => w !== pw);
    void worker.terminate().catch(() => {
      /* already gone */
    });
  };
  worker.on('error', (err) =>
    onDead(err instanceof Error ? err : new Error(String(err))),
  );
  worker.on('exit', (code) => {
    if (code !== 0) onDead(new Error(`diff worker exited with code ${code}`));
  });

  // Don't let idle workers keep the process alive on quit; Electron's own
  // handles keep the loop alive while jobs are actually running.
  worker.unref();
  return pw;
}

function ensurePool(): PoolWorker[] | null {
  if (poolBroken) return null;
  try {
    if (!pool) pool = [];
    while (pool.length < POOL_SIZE) pool.push(makeWorker());
    return pool.length > 0 ? pool : null;
  } catch {
    poolBroken = true;
    pool = null;
    return null;
  }
}

function runSync(input: ComputeFileDiffInput): Promise<FileDiff> {
  try {
    return Promise.resolve(computeFileDiff(input));
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Compute a file diff off the main thread. Falls back to a synchronous
 * main-thread computation if no worker is available.
 */
export function computeFileDiffAsync(
  input: ComputeFileDiffInput,
): Promise<FileDiff> {
  const workers = ensurePool();
  if (!workers || workers.length === 0) return runSync(input);

  // Dispatch to the least-loaded worker so a single huge file doesn't queue
  // behind another on the same thread while others sit idle.
  let target = workers[0]!;
  for (const w of workers) {
    if (w.jobs.size < target.jobs.size) target = w;
  }

  const id = nextId++;
  return new Promise<FileDiff>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.jobs.add(id);
    try {
      target.worker.postMessage({ id, input });
    } catch {
      // The worker died between selection and post — clean up and run inline.
      pending.delete(id);
      target.jobs.delete(id);
      runSync(input).then(resolve, reject);
    }
  });
}
