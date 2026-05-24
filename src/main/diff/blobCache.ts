// Tiny LRU cache for raw blob bytes, keyed by `${repo}|${blobId}`. We keep
// them around so the renderer's "expand context" button can fetch additional
// lines without a fresh CodeCommit round-trip every time.
//
// Capacity is in bytes; values are evicted oldest-first when we exceed it.

const MAX_BYTES = 64 * 1024 * 1024; // 64 MB

interface Entry {
  key: string;
  bytes: Uint8Array;
}

const map = new Map<string, Entry>();
let totalBytes = 0;

function makeKey(repo: string, blobId: string): string {
  return `${repo}|${blobId}`;
}

export function getCachedBlob(
  repo: string,
  blobId: string,
): Uint8Array | undefined {
  const key = makeKey(repo, blobId);
  const entry = map.get(key);
  if (!entry) return undefined;
  // Touch — move to end so it's most-recently-used.
  map.delete(key);
  map.set(key, entry);
  return entry.bytes;
}

export function putBlobInCache(
  repo: string,
  blobId: string,
  bytes: Uint8Array,
): void {
  const key = makeKey(repo, blobId);
  const existing = map.get(key);
  if (existing) {
    totalBytes -= existing.bytes.byteLength;
    map.delete(key);
  }
  map.set(key, { key, bytes });
  totalBytes += bytes.byteLength;

  while (totalBytes > MAX_BYTES) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) break;
    const old = map.get(oldestKey);
    if (!old) break;
    map.delete(oldestKey);
    totalBytes -= old.bytes.byteLength;
  }
}
