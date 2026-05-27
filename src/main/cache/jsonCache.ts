// Namespaced disk-backed JSON cache.
//
// Each namespace lives in its own file under `<userData>/cache/<ns>.json`.
// Reads go through an in-memory mirror so they're zero-cost after the first
// load; writes update the mirror immediately and persist on a short debounce
// so a burst of cache-puts during a single PR open doesn't fan out into a
// thundering herd of fs.writeFile calls.
//
// Why JSON files instead of SQLite: the project already uses this pattern for
// drafts.ts and reviewed.ts, the payloads are small and bounded, and there's
// no native compilation step to handle in CI. If the working set grows past
// what JSON can comfortably hold (millions of file-diff entries), swap this
// module out for a SQLite-backed one without changing call sites — the
// `getCached` / `putCached` / `invalidate*` shape is sufficient.

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface Entry<T> {
  value: T;
  storedAt: number; // unix ms
}

interface NamespaceFile<T> {
  // Single object so we can JSON.stringify the whole namespace in one go.
  entries: Record<string, Entry<T>>;
}

// Loaded mirrors and load-promises (so concurrent loads of the same namespace
// don't race on the disk read).
const mirrors = new Map<string, NamespaceFile<unknown>>();
const loadPromises = new Map<string, Promise<NamespaceFile<unknown>>>();

// Per-namespace debounce timers. We coalesce successive puts within
// WRITE_DEBOUNCE_MS into one write.
const pendingWrites = new Map<string, NodeJS.Timeout>();
const WRITE_DEBOUNCE_MS = 250;

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'cache');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function namespacePath(namespace: string): string {
  return join(cacheDir(), `${namespace}.json`);
}

async function load<T>(namespace: string): Promise<NamespaceFile<T>> {
  const existing = mirrors.get(namespace);
  if (existing) return existing as NamespaceFile<T>;
  const pending = loadPromises.get(namespace);
  if (pending) return (await pending) as NamespaceFile<T>;

  const promise = (async (): Promise<NamespaceFile<unknown>> => {
    let data: NamespaceFile<unknown> = { entries: {} };
    try {
      const raw = await fs.readFile(namespacePath(namespace), 'utf8');
      const parsed = JSON.parse(raw) as NamespaceFile<unknown> | unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'entries' in parsed &&
        typeof (parsed as NamespaceFile<unknown>).entries === 'object'
      ) {
        data = parsed as NamespaceFile<unknown>;
      }
    } catch (err) {
      // ENOENT on first-ever read is expected and not an error. Anything else
      // (parse error, permission issue) we log and treat as empty so a single
      // bad cache file doesn't take the whole app down.
      const e = err as { code?: string };
      if (e.code !== 'ENOENT') {
        console.error(`[cache] failed to load ${namespace}:`, err);
      }
    }
    mirrors.set(namespace, data);
    loadPromises.delete(namespace);
    return data;
  })();
  loadPromises.set(namespace, promise);
  return (await promise) as NamespaceFile<T>;
}

function schedulePersist(namespace: string): void {
  const existing = pendingWrites.get(namespace);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingWrites.delete(namespace);
    const data = mirrors.get(namespace);
    if (!data) return;
    // No await — if the disk write fails we log and move on; the in-memory
    // mirror is the source of truth for the rest of this session.
    fs.writeFile(namespacePath(namespace), JSON.stringify(data), 'utf8').catch(
      (err) => {
        console.error(`[cache] failed to persist ${namespace}:`, err);
      },
    );
  }, WRITE_DEBOUNCE_MS);
  pendingWrites.set(namespace, timer);
}

/**
 * Returns the cached value, or null if absent / expired.
 *
 * @param ttlMs Optional TTL. Entries older than ttlMs are treated as misses
 *   (and silently dropped). Omit for immutable data keyed by something the
 *   server treats as content-addressed (commit IDs, blob IDs, revisionId).
 */
export async function getCached<T>(
  namespace: string,
  key: string,
  ttlMs?: number,
): Promise<T | null> {
  const data = await load<T>(namespace);
  const entry = data.entries[key];
  if (!entry) return null;
  if (ttlMs !== undefined && Date.now() - entry.storedAt > ttlMs) {
    delete data.entries[key];
    schedulePersist(namespace);
    return null;
  }
  return entry.value;
}

/**
 * Stores a value under (namespace, key), evicting oldest entries first when
 * the namespace exceeds maxEntries.
 */
export async function putCached<T>(
  namespace: string,
  key: string,
  value: T,
  maxEntries?: number,
): Promise<void> {
  const data = await load<T>(namespace);
  data.entries[key] = { value, storedAt: Date.now() };
  if (maxEntries && Object.keys(data.entries).length > maxEntries) {
    // Sort by storedAt asc, drop from the front until we're under the cap.
    const keys = Object.keys(data.entries).sort(
      (a, b) =>
        (data.entries[a]?.storedAt ?? 0) - (data.entries[b]?.storedAt ?? 0),
    );
    const toDrop = keys.length - maxEntries;
    for (let i = 0; i < toDrop; i++) {
      const k = keys[i];
      if (k) delete data.entries[k];
    }
  }
  schedulePersist(namespace);
}

export async function invalidateCached(
  namespace: string,
  key: string,
): Promise<void> {
  const data = await load(namespace);
  if (data.entries[key]) {
    delete data.entries[key];
    schedulePersist(namespace);
  }
}

/** Drop every entry in a namespace. */
export async function invalidateNamespace(namespace: string): Promise<void> {
  const data = await load(namespace);
  if (Object.keys(data.entries).length === 0) return;
  data.entries = {};
  schedulePersist(namespace);
}

/** Drop entries whose key matches the predicate. */
export async function invalidateMatching(
  namespace: string,
  predicate: (key: string) => boolean,
): Promise<void> {
  const data = await load(namespace);
  let changed = false;
  for (const k of Object.keys(data.entries)) {
    if (predicate(k)) {
      delete data.entries[k];
      changed = true;
    }
  }
  if (changed) schedulePersist(namespace);
}

/** Wipe the entire cache directory. */
export async function clearAllCaches(): Promise<void> {
  mirrors.clear();
  for (const t of pendingWrites.values()) clearTimeout(t);
  pendingWrites.clear();
  try {
    const dir = cacheDir();
    const files = await fs.readdir(dir);
    await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) =>
          fs.unlink(join(dir, f)).catch((err) => {
            console.error(`[cache] failed to unlink ${f}:`, err);
          }),
        ),
    );
  } catch (err) {
    console.error('[cache] failed to clear cache dir:', err);
  }
}
