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
  // Server-side filtering for approval is not supported by CodeCommit,
  // so the renderer applies it client-side after enrichment.
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

// Result envelope used by every IPC call so the renderer can render errors
// uniformly without try/catch around every invoke.
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
