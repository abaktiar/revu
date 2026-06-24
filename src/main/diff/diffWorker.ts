// Worker thread that runs the CPU-bound diff computation off the main process.
//
// `structuredPatch` (in computeFileDiff) is synchronous and O(N·D); on a big
// file like a regenerated package-lock.json it can block for seconds. Running it
// on the main thread freezes the whole app (the OS shows a spinner until it
// returns). This worker takes the decoded before/after text and returns the
// computed FileDiff, so the main event loop stays responsive.
//
// It depends only on `computeFileDiff` (which imports the `diff` library and
// type-only `@shared/types`), so it stays a lean, side-effect-free worker.
import { parentPort } from 'node:worker_threads';
import {
  computeFileDiff,
  type ComputeFileDiffInput,
} from './computeFileDiff';

interface JobMessage {
  id: number;
  input: ComputeFileDiffInput;
}

const port = parentPort;
if (port) {
  port.on('message', (job: JobMessage) => {
    try {
      const result = computeFileDiff(job.input);
      port.postMessage({ id: job.id, result });
    } catch (err) {
      port.postMessage({
        id: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
