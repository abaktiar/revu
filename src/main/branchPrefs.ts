import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { RepoBranchPrefs } from '@shared/types';

// Persists per-repo Create-PR state: pinned destination branches (the user's
// "favorites") and the source branch they used on their most recent submit.
// Follows the same pattern as drafts.ts / reviewed.ts — a single JSON file
// keyed by repository name, loaded once into memory.
const FILE_NAME = 'branch-prefs.json';

type Persisted = Record<string, RepoBranchPrefs>;

let cache: Persisted | null = null;

function prefsPath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

async function readAll(): Promise<Persisted> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(prefsPath(), 'utf8');
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
  await fs.writeFile(prefsPath(), JSON.stringify(next, null, 2), 'utf8');
}

function emptyPrefs(repositoryName: string): RepoBranchPrefs {
  return { repositoryName, favoriteDestinations: [] };
}

export async function loadBranchPrefs(
  repositoryName: string,
): Promise<RepoBranchPrefs> {
  const all = await readAll();
  return all[repositoryName] ?? emptyPrefs(repositoryName);
}

export async function setFavoriteDestination(
  repositoryName: string,
  branchName: string,
  favorite: boolean,
): Promise<RepoBranchPrefs> {
  const all = await readAll();
  const cur = all[repositoryName] ?? emptyPrefs(repositoryName);
  const set = new Set(cur.favoriteDestinations);
  if (favorite) set.add(branchName);
  else set.delete(branchName);
  const next: RepoBranchPrefs = {
    ...cur,
    favoriteDestinations: [...set].sort((a, b) => a.localeCompare(b)),
  };
  all[repositoryName] = next;
  await writeAll(all);
  return next;
}

export async function setLastSourceBranch(
  repositoryName: string,
  branchName: string,
): Promise<RepoBranchPrefs> {
  const all = await readAll();
  const cur = all[repositoryName] ?? emptyPrefs(repositoryName);
  const next: RepoBranchPrefs = { ...cur, lastSourceBranch: branchName };
  all[repositoryName] = next;
  await writeAll(all);
  return next;
}
