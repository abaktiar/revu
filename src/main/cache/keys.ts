// Cache namespaces, TTLs and key-builders. Centralized so the provider
// doesn't grow a forest of magic strings, and so cache invalidation has a
// single place to learn the layout.
//
// Naming convention for keys: lowercase, colon-separated. Anything that's
// part of the natural identity of the value (commit IDs, blob IDs, revisionId)
// goes into the key — that way "immutable" caches can be persisted forever
// because the key changes whenever the underlying data could change.

export const NS = {
  // Immutable — keyed by content-addressed IDs.
  fileDiff: 'fileDiff',
  differences: 'differences',
  approval: 'approval',
  prCommits: 'prCommits',

  // Mutable — TTL-based, invalidated on related writes.
  prDetail: 'prDetail',
  comments: 'comments',
  mergeability: 'mergeability',
  prList: 'prList',
  repos: 'repos',
  branches: 'branches',
} as const;

export const TTL = {
  prDetail: 60 * 1000, // 1 min
  comments: 60 * 1000, // 1 min
  mergeability: 2 * 60 * 1000, // 2 min
  prList: 60 * 1000, // 1 min
  repos: 30 * 60 * 1000, // 30 min
  branches: 5 * 60 * 1000, // 5 min — branches turn over fast but a 5-min
  // cache keeps the Create-PR picker instant on re-open.
} as const;

export const LIMITS = {
  // Per-namespace caps. File diffs can be heavy (multi-KB each), so we cap
  // it tighter than the others. Everything else is small.
  fileDiff: 500,
  differences: 200,
  approval: 500,
  prDetail: 500,
  comments: 200,
  mergeability: 200,
  prList: 50,
  repos: 10,
  prCommits: 200,
  branches: 50,
} as const;

export function fileDiffKey(
  beforeBlobId: string | undefined,
  afterBlobId: string | undefined,
  changeType: string,
  ignoreWhitespace?: boolean,
): string {
  const base = `${beforeBlobId ?? '-'}|${afterBlobId ?? '-'}|${changeType}`;
  // The whitespace-ignored diff is a different value for the same blob pair, so
  // it needs its own cache slot.
  return ignoreWhitespace ? `${base}|iw` : base;
}

export function differencesKey(
  repo: string,
  beforeCommitId: string,
  afterCommitId: string,
): string {
  return `${repo}|${beforeCommitId}|${afterCommitId}`;
}

export function approvalKey(pullRequestId: string, revisionId: string): string {
  return `${pullRequestId}|${revisionId}`;
}

export function prDetailKey(pullRequestId: string): string {
  return pullRequestId;
}

export function commentsKey(repo: string, pullRequestId: string): string {
  return `${repo}|${pullRequestId}`;
}

export function mergeabilityKey(
  repo: string,
  pullRequestId: string,
): string {
  return `${repo}|${pullRequestId}`;
}

export function prListKey(repo: string, status: string | undefined): string {
  return `${repo}|${status ?? 'ALL'}`;
}

export function prCommitsKey(
  repo: string,
  beforeCommitId: string,
  afterCommitId: string,
): string {
  return `${repo}|${beforeCommitId}|${afterCommitId}`;
}

export function branchesKey(repo: string): string {
  return repo;
}
