import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ReviewedFile } from '@shared/types';

const FILE_NAME = 'reviewed.json';

// Structure on disk: keyed by `${pullRequestId}|${filePath}` for fast lookup
// and to keep the file small.
type Persisted = Record<string, ReviewedFile>;

let cache: Persisted | null = null;

function reviewedPath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

function key(pullRequestId: string, filePath: string): string {
  return `${pullRequestId}|${filePath}`;
}

async function readAll(): Promise<Persisted> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(reviewedPath(), 'utf8');
    const parsed = JSON.parse(raw) as Persisted;
    cache = parsed && typeof parsed === 'object' ? parsed : {};
    return cache;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      cache = {};
      return cache;
    }
    throw err;
  }
}

async function writeAll(next: Persisted): Promise<void> {
  cache = next;
  await fs.writeFile(reviewedPath(), JSON.stringify(next, null, 2), 'utf8');
}

export async function listReviewed(
  pullRequestId: string,
): Promise<ReviewedFile[]> {
  const all = await readAll();
  return Object.values(all).filter((r) => r.pullRequestId === pullRequestId);
}

export async function setReviewed(
  pullRequestId: string,
  filePath: string,
  reviewedAtAfterCommit: string,
  reviewed: boolean,
): Promise<ReviewedFile | null> {
  const all = await readAll();
  const k = key(pullRequestId, filePath);
  if (!reviewed) {
    delete all[k];
    await writeAll(all);
    return null;
  }
  const entry: ReviewedFile = {
    pullRequestId,
    filePath,
    reviewedAtAfterCommit,
    reviewedAt: new Date().toISOString(),
  };
  all[k] = entry;
  await writeAll(all);
  return entry;
}
