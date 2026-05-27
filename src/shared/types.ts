// Types shared across main, preload, and renderer.
// Keep these provider-agnostic — no CodeCommit-specific shapes leak here.

export type PRStatus = 'OPEN' | 'CLOSED';

// Approval rollup as a single value the UI can filter on.
// 'UNKNOWN' = we haven't evaluated approval rules yet for this PR.
export type ApprovalState = 'APPROVED' | 'NOT_APPROVED' | 'NO_RULES' | 'UNKNOWN';

export type MergeState = 'MERGED' | 'NOT_MERGED';

export interface PullRequestTarget {
  repositoryName: string;
  sourceReference: string; // e.g. "refs/heads/feature/foo" or just "feature/foo"
  destinationReference: string;
  sourceCommitId?: string;
  destinationCommitId?: string;
  mergeBase?: string;
}

export interface PullRequestSummary {
  id: string;
  title: string;
  description?: string;
  authorArn?: string;
  status: PRStatus;
  mergeState: MergeState;
  approvalState: ApprovalState;
  createdAt?: string; // ISO
  lastActivityAt?: string; // ISO
  targets: PullRequestTarget[];
}

export interface PullRequestDetail extends PullRequestSummary {
  // Reserved for M2+: file list, commit ids, etc.
}

export interface ListPRsFilter {
  status?: PRStatus;
  // Cap on the number of PR summaries to fetch in this session. CodeCommit's
  // ListPullRequests returns IDs newest-first, so this is the "next N most
  // recent" after afterId (or the absolute N most recent if afterId is
  // unset). Used both for the initial load and for incremental "Load more".
  limit?: number;
  // Continuation cursor. When set, the provider skips PR IDs up to and
  // including this one and starts streaming from the next one. Drives "Load
  // more" without re-fetching what's already on screen. Unset means start
  // from the newest PR.
  afterId?: string;
  // Server-side filtering for approval is not supported by CodeCommit,
  // so the renderer applies it client-side after enrichment.
}

// Result of one streaming session: what the renderer needs to know after the
// stream of items has finished (or been cancelled). The list of items itself
// is delivered via the `prs:list-item` event stream, not here.
export interface ListSessionResult {
  // True when the provider stopped at the limit while AWS had more to give.
  // Drives the "Showing N most recent — Load more" banner.
  truncated: boolean;
  // Number of items the provider actually emitted via onItem before stop.
  // May be less than the requested limit if some PR fetches failed (each
  // failure is logged + skipped, the session continues).
  deliveredCount: number;
  // The ID of the last successfully-emitted PR. Used as `afterId` on the
  // next "Load more" call so it picks up exactly where this one stopped.
  lastId?: string;
  // True when the caller aborted via cancelList. The renderer keeps any
  // items already streamed but knows the session didn't complete naturally.
  cancelled: boolean;
}

// Payloads for the main → renderer event channels that drive the streaming
// PR-list session. All include sessionId so multiple concurrent sessions
// (e.g. a Load more racing a Refresh) don't get cross-wired.
export interface ListItemEvent {
  sessionId: string;
  item: PullRequestSummary;
  // 1-based position in the *current* session — useful for the loading chip
  // ("loaded 47"). Not a global index across Load more calls.
  loaded: number;
  // Best-known total for this session (the count of IDs the provider
  // enumerated before starting enrichment). Stable for the lifetime of the
  // session — won't shift as items arrive.
  total: number;
}

export interface ListDoneEvent extends ListSessionResult {
  sessionId: string;
}

export interface ListErrorEvent {
  sessionId: string;
  error: string;
  errorCode?: IpcErrorCode;
  errorHint?: string;
}

export type CredentialSource = 'profile' | 'keys';

// Sent renderer → main when the user saves access keys. Never sent main → renderer.
export interface ManualCredentialsInput {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface AppSettings {
  credentialSource: CredentialSource;
  profile?: string; // when credentialSource === 'profile'
  region?: string;
  repositoryName?: string;
  favoriteRepos: string[];
  // Whether encrypted manual keys exist on disk. The renderer uses this to
  // know if a "Keys saved" state should be shown. The actual keys never
  // travel back to the renderer.
  hasManualKeys: boolean;
}

export interface AwsProfileInfo {
  name: string;
  source: 'credentials' | 'config';
  region?: string;
}

export interface AwsRegionInfo {
  id: string; // e.g. "us-east-1"
  label: string; // e.g. "US East (N. Virginia)"
}

// Curated list of regions where AWS CodeCommit is generally available.
// If a user needs one not listed, they can still select via profile/config.
export const AWS_CODECOMMIT_REGIONS: AwsRegionInfo[] = [
  { id: 'us-east-1', label: 'US East (N. Virginia)' },
  { id: 'us-east-2', label: 'US East (Ohio)' },
  { id: 'us-west-1', label: 'US West (N. California)' },
  { id: 'us-west-2', label: 'US West (Oregon)' },
  { id: 'ca-central-1', label: 'Canada (Central)' },
  { id: 'sa-east-1', label: 'South America (São Paulo)' },
  { id: 'eu-west-1', label: 'Europe (Ireland)' },
  { id: 'eu-west-2', label: 'Europe (London)' },
  { id: 'eu-west-3', label: 'Europe (Paris)' },
  { id: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { id: 'eu-north-1', label: 'Europe (Stockholm)' },
  { id: 'eu-south-1', label: 'Europe (Milan)' },
  { id: 'af-south-1', label: 'Africa (Cape Town)' },
  { id: 'me-south-1', label: 'Middle East (Bahrain)' },
  { id: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { id: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { id: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
  { id: 'ap-northeast-3', label: 'Asia Pacific (Osaka)' },
  { id: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { id: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
];

export interface RepositorySummary {
  name: string;
  id?: string;
}

// ---- Diff types ---------------------------------------------------------

export type DiffChangeType = 'A' | 'M' | 'D' | 'R';

export interface FileDiffEntry {
  // The "current" path the user sees in the file tree. For deletes this is
  // the path on the BEFORE side; otherwise the AFTER path.
  path: string;
  beforePath?: string;
  afterPath?: string;
  changeType: DiffChangeType;
  beforeBlobId?: string;
  afterBlobId?: string;
}

export interface PRDifferences {
  pullRequestId: string;
  repositoryName: string;
  beforeCommitId: string;
  afterCommitId: string;
  files: FileDiffEntry[];
}

export interface FileContent {
  // Decoded UTF-8 text. Empty when binary === true.
  text: string;
  binary: boolean;
  size: number;
}

export interface FilePair {
  before: FileContent | null; // null = file didn't exist on that side
  after: FileContent | null;
}

// ---- Hunk-based diff (GitHub-style continuous renderer) ---------------

export type DiffLineType = 'context' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  // Line numbers in the BEFORE / AFTER files (1-based). undefined where the
  // side has no corresponding line: oldLineNumber is set for context+del,
  // newLineNumber is set for context+add.
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string; // raw line content (no leading +/-/space)
}

export interface DiffHunk {
  // 1-based starts. Lines counts come from the diff library.
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  // Synthetic hunks injected by "expand context" are flagged so the renderer
  // doesn't draw a hunk header for them.
  isExpansion?: boolean;
}

export interface FileDiff {
  path: string;
  beforePath?: string;
  afterPath?: string;
  changeType: DiffChangeType;
  beforeBlobId?: string;
  afterBlobId?: string;
  // True when either side was detected as binary; hunks will be empty.
  binary: boolean;
  // Line totals on each side; used to clamp "expand context" requests.
  oldTotalLines: number;
  newTotalLines: number;
  hunks: DiffHunk[];
}

export interface ExpandLinesRequest {
  repositoryName: string;
  blobId: string;
  side: 'before' | 'after';
  // 1-based inclusive line range to fetch.
  fromLine: number;
  toLine: number;
}

export interface ExpandLinesResponse {
  lines: string[]; // raw line content
  fromLine: number;
  toLine: number;
}

// ---- Comment types ------------------------------------------------------

export type RelativeFileVersion = 'BEFORE' | 'AFTER';

export interface CommentNode {
  id: string;
  authorArn?: string;
  content: string;
  inReplyTo?: string;
  createdAt?: string;
  lastModified?: string;
  deleted?: boolean;
}

export interface CommentThread {
  // CodeCommit groups comments by (commitIds + location); we use the first
  // comment's id as the thread id for stable React keys.
  threadId: string;
  pullRequestId: string;
  repositoryName: string;
  beforeCommitId: string;
  afterCommitId: string;
  filePath?: string; // undefined => general PR comment
  filePosition?: number; // 1-based line number
  relativeFileVersion?: RelativeFileVersion;
  comments: CommentNode[];
}

export interface PostCommentInput {
  pullRequestId: string;
  repositoryName: string;
  beforeCommitId: string;
  afterCommitId: string;
  filePath: string;
  filePosition: number;
  relativeFileVersion: RelativeFileVersion;
  content: string;
}

export interface PostReplyInput {
  inReplyTo: string;
  content: string;
}

// Soft-delete a single comment by id. The provider verifies that the caller
// is the comment's author before issuing the SDK call (CodeCommit
// itself enforces author-only as well, but rejecting client-side gives a
// cleaner error than the AWS exception text).
export interface DeleteCommentInput {
  // The CodeCommit comment id of the comment to soft-delete.
  commentId: string;
  // Provided so the provider can drop the right cache entries.
  pullRequestId: string;
  repositoryName: string;
}

// ---- Drafts -------------------------------------------------------------

export interface CommentDraft {
  id: string; // local UUID
  pullRequestId: string;
  repositoryName: string;
  filePath: string;
  filePosition: number;
  relativeFileVersion: RelativeFileVersion;
  content: string;
  createdAt: string; // ISO
  // If set, this draft will be posted as a reply rather than a new thread.
  inReplyTo?: string;
}

// ---- Approval / identity ----------------------------------------------

export type ApprovalAction = 'APPROVE' | 'REVOKE';

export interface ApprovalStateEntry {
  userArn: string;
  approvalState: 'APPROVE' | 'REVOKE';
  // ISO timestamp of the most recent state change for this user, when
  // available. Looked up via DescribePullRequestEvents — best-effort; if
  // the event lookup fails we still surface the approval, just without a time.
  changedAt?: string;
}

export interface PullRequestApprovalView {
  revisionId: string;
  states: ApprovalStateEntry[];
  // Whether the *currently authenticated* user has APPROVE on this revision.
  selfApproved: boolean;
  selfArn?: string;
}

// ---- Mergeability -----------------------------------------------------

export type MergeOptionId =
  | 'FAST_FORWARD_MERGE'
  | 'SQUASH_MERGE'
  | 'THREE_WAY_MERGE';

export type MergeabilityState =
  // Auto-mergeable — at least one strategy applies cleanly.
  | 'mergeable'
  // PR was already merged.
  | 'already_merged'
  // PR was closed without being merged (rejected / abandoned).
  | 'closed_unmerged'
  // Merge would conflict on at least one file; manual resolution needed.
  | 'has_conflicts'
  // Couldn't determine — surface `reason` to the user.
  | 'unknown';

export interface PullRequestMergeability {
  state: MergeabilityState;
  // Strategies CodeCommit says are *available* (whether they'd actually merge
  // cleanly is a separate question answered by `state`).
  mergeOptions: MergeOptionId[];
  // Conflict info when state === 'has_conflicts'.
  conflictCount?: number;
  conflictFiles?: string[]; // up to ~10 file paths
  // Merge info when state === 'already_merged'.
  mergedBy?: string;
  mergeCommitId?: string;
  // ISO timestamp of the merge event, when known. Sourced from
  // DescribePullRequestEvents; falls back to undefined if events are
  // unavailable.
  mergedAt?: string;
  // Which strategy was actually used for the merge (FAST_FORWARD/SQUASH/3-way).
  mergedWith?: MergeOptionId;
  // Closure info when state === 'closed_unmerged'. Sourced from the latest
  // PULL_REQUEST_STATUS_CHANGED → CLOSED event. Both may be undefined if
  // DescribePullRequestEvents was unavailable; in that case the UI shows the
  // status without the who/when attribution.
  closedBy?: string;
  closedAt?: string;
  // Why we landed in this state (especially for 'unknown' or 'has_conflicts').
  reason?: string;
}

// ---- Per-file local review state --------------------------------------

export interface ReviewedFile {
  pullRequestId: string;
  filePath: string;
  // The afterCommitId at the time the user marked this file. If the PR's
  // current afterCommitId differs, the reviewed flag is considered stale.
  reviewedAtAfterCommit: string;
  reviewedAt: string; // ISO
}

// Stable, renderer-facing classification of failures from the main process.
// The renderer uses this to (a) decorate the error UI with the right icon /
// retry affordance, (b) decide whether the issue is recoverable by the user,
// and (c) show a human-actionable next step (`hint`). The codes are
// intentionally provider-agnostic so a future GitHub/GitLab provider can
// reuse them without renaming.
export type IpcErrorCode =
  | 'throttled' // AWS Rate exceeded / ThrottlingException — user should wait + retry
  | 'credentials_expired' // STS / SSO / temporary creds expired
  | 'credentials_missing' // No credentials configured at all
  | 'access_denied' // Authenticated but IAM denied the action
  | 'not_found' // Repo or PR doesn't exist (or user can't see it)
  | 'conflict' // Resource state conflict (e.g. already merged, stale revision)
  | 'network' // Could not reach AWS
  | 'timeout' // Request timed out
  | 'unknown'; // Anything else — error message is the only signal

// Result envelope used by every IPC call so the renderer can render errors
// uniformly without try/catch around every invoke.
export type IpcResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      // Short human-readable message. Suitable for showing directly in a
      // toast/banner; never contains stack traces or SDK internals.
      error: string;
      // Stable code used by the renderer to choose UI treatment.
      errorCode?: IpcErrorCode;
      // One-sentence next action the user can take. Optional — when absent,
      // the renderer falls back to a generic "Try again" affordance.
      errorHint?: string;
    };
