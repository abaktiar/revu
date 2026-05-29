import type {
  ApprovalAction,
  BranchSummary,
  BranchTip,
  CommentNode,
  CommentThread,
  CreatePullRequestInput,
  DeleteCommentInput,
  ExpandLinesRequest,
  ExpandLinesResponse,
  FileContent,
  FileDiff,
  FileDiffEntry,
  FilePair,
  ListPRsFilter,
  PostCommentInput,
  PostReplyInput,
  PRDifferences,
  ListSessionResult,
  PullRequestApprovalView,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestMergeability,
  PullRequestSummary,
  RepositorySummary,
} from '@shared/types';

// Pass `{ forceFresh: true }` from the renderer's Refresh button to skip the
// disk cache for this single call. The provider is still free to use any
// in-memory coalescing (e.g. de-duping concurrent identical fetches inside
// the same request burst); forceFresh only opts out of cross-call caching.
export interface ReadOptions {
  forceFresh?: boolean;
}

/**
 * The single seam between the app and whatever code-review backend we're
 * talking to. CodeCommit is the first implementation; GitHub/GitLab/Bitbucket
 * may follow. UI and IPC code must depend ONLY on this interface, never on
 * a specific provider's SDK types.
 */
export interface ReviewProvider {
  readonly name: string;

  // Repos & PRs
  listRepositories(opts?: ReadOptions): Promise<RepositorySummary[]>;
  // Streaming PR-list session. The provider enumerates IDs, then enriches
  // each one and pushes it to `onItem` *as it resolves* (in newest-first
  // order — out-of-order arrivals are buffered until earlier items land).
  // The returned promise resolves with the session summary after the last
  // item is emitted (or the signal fires). Cooperative cancellation: the
  // provider checks signal.aborted between enrichment batches; an aborted
  // session resolves with `cancelled: true`, never rejects.
  streamPullRequests(
    repositoryName: string,
    filter: ListPRsFilter,
    opts: {
      forceFresh?: boolean;
      signal?: AbortSignal;
      onItem: (event: { item: PullRequestSummary; loaded: number; total: number }) => void;
    },
  ): Promise<ListSessionResult>;
  getPullRequest(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PullRequestDetail>;

  // Branches — used by the Create-PR flow. Returned alphabetical; implementations
  // are expected to paginate internally and cache for a short TTL (branches
  // turn over more often than repos but not so often that every picker open
  // should hit the network).
  listBranches(
    repositoryName: string,
    opts?: ReadOptions,
  ): Promise<BranchSummary[]>;

  // Resolve a branch name to its tip commit and read the commit message —
  // used by the Create-PR flow to auto-fill title (subject) and description
  // (body) when the user picks a source branch. Implementations may cache
  // the (branchName → commitId) hop briefly; the commit itself is content-
  // addressed and safe to cache forever.
  getBranchTip(
    repositoryName: string,
    branchName: string,
    opts?: ReadOptions,
  ): Promise<BranchTip>;

  // Pre-PR diff: what the diff WOULD look like if a PR was opened between
  // these two refs right now. Implementations should resolve refs to commit
  // IDs and route through the same diff pipeline as getDifferences /
  // getCommitDifferences so the renderer's existing diff viewer renders it.
  // pullRequestId on the result is the empty string (no PR exists yet).
  getRefDifferences(
    repositoryName: string,
    sourceRef: string,
    destinationRef: string,
    opts?: ReadOptions,
  ): Promise<PRDifferences>;

  // Create a new pull request. Implementations are responsible for
  // idempotency (e.g. generating a clientRequestToken). On success, the
  // provider MUST invalidate any list/detail caches that would otherwise
  // hide the new PR from the renderer's PR list. Returns the summary as
  // it appears in the post-creation state — the caller typically navigates
  // straight to the PR's detail view.
  createPullRequest(input: CreatePullRequestInput): Promise<PullRequestSummary>;

  // Diffs
  getDifferences(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PRDifferences>;
  // Like getDifferences, but for an arbitrary commit pair (typically the
  // commit's first parent → the commit itself). Used by the per-commit view in
  // the file sidebar. Returned shape mirrors PRDifferences so the renderer's
  // diff pipeline accepts it without branching; pullRequestId is left empty
  // since this view is not anchored to a PR.
  getCommitDifferences(
    repositoryName: string,
    beforeCommitId: string,
    afterCommitId: string,
    opts?: ReadOptions,
  ): Promise<PRDifferences>;
  getFilePair(
    repositoryName: string,
    beforeBlobId: string | undefined,
    afterBlobId: string | undefined,
  ): Promise<FilePair>;
  // Compute hunk-based diff for one file. Sends only changed lines + context,
  // not the full file content — the renderer never sees unchanged regions
  // unless the user expands them.
  getFileDiff(
    repositoryName: string,
    entry: FileDiffEntry,
    opts?: ReadOptions,
  ): Promise<FileDiff>;
  // Returns a slice of one side's blob; used by the "expand context" buttons
  // between hunks.
  expandLines(request: ExpandLinesRequest): Promise<ExpandLinesResponse>;

  // Comments
  listComments(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<CommentThread[]>;
  postComment(input: PostCommentInput): Promise<CommentThread>;
  postReply(input: PostReplyInput): Promise<CommentThread>;
  // Soft-delete a single comment. CodeCommit's DeleteCommentContent only
  // clears the content (sets `deleted: true`); the comment node and its
  // children remain so threads don't collapse. Provider implementations
  // should refuse to delete comments not authored by the current user.
  deleteComment(input: DeleteCommentInput): Promise<CommentNode>;

  // Commits unique to the PR (everything reachable from the source tip but
  // not from the merge base / destination). Returned newest-first. The
  // provider is responsible for bounding the walk so a runaway history doesn't
  // hang the UI.
  listPullRequestCommits(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PullRequestCommit[]>;

  // Approval
  getApprovalView(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PullRequestApprovalView>;
  updateApprovalState(
    repositoryName: string,
    pullRequestId: string,
    action: ApprovalAction,
  ): Promise<PullRequestApprovalView>;

  // Mergeability — which merge strategies (if any) are valid for the current
  // source/destination, or "already merged" / "has conflicts" with a reason.
  getMergeability(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PullRequestMergeability>;

  // Deep-link to the provider's own web UI for a given pull request. Used by
  // the "View on AWS" button and similar — the renderer hands it to
  // shell.openExternal. Implementations return undefined if they can't build
  // a URL (e.g. missing region).
  webUrlForPullRequest(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<string | undefined>;

  // Cache management. Implementations that don't cache can no-op these.
  invalidatePullRequest(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<void>;
  invalidateRepository(repositoryName: string): Promise<void>;
  invalidateAll(): Promise<void>;
}

export interface StaticCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface ProviderConfig {
  region?: string;
  // Mutually exclusive — if staticCredentials is set, profile is ignored.
  profile?: string;
  staticCredentials?: StaticCredentials;
}

export type ProviderFactory = (config: ProviderConfig) => ReviewProvider;

// Heuristic — matches what most editors consider binary: any NUL byte in the
// first ~8 KB or > ~30% non-ASCII control chars.
export function looksBinary(buf: Uint8Array): boolean {
  const sample = buf.subarray(0, Math.min(buf.byteLength, 8192));
  let suspicious = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 7 || (b > 14 && b < 32)) suspicious++;
  }
  return suspicious / Math.max(sample.byteLength, 1) > 0.3;
}

export function decodeFile(buf: Uint8Array): FileContent {
  if (looksBinary(buf)) {
    return { text: '', binary: true, size: buf.byteLength };
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return { text, binary: false, size: buf.byteLength };
}
