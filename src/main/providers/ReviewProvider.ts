import type {
  CommentThread,
  FileContent,
  FilePair,
  ListPRsFilter,
  PostCommentInput,
  PostReplyInput,
  PRDifferences,
  PullRequestDetail,
  PullRequestSummary,
  RepositorySummary,
} from '@shared/types';

/**
 * The single seam between the app and whatever code-review backend we're
 * talking to. CodeCommit is the first implementation; GitHub/GitLab/Bitbucket
 * may follow. UI and IPC code must depend ONLY on this interface, never on
 * a specific provider's SDK types.
 */
export interface ReviewProvider {
  readonly name: string;

  // Repos & PRs
  listRepositories(): Promise<RepositorySummary[]>;
  listPullRequests(
    repositoryName: string,
    filter: ListPRsFilter,
  ): Promise<PullRequestSummary[]>;
  getPullRequest(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<PullRequestDetail>;

  // Diffs
  getDifferences(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<PRDifferences>;
  getFilePair(
    repositoryName: string,
    beforeBlobId: string | undefined,
    afterBlobId: string | undefined,
  ): Promise<FilePair>;

  // Comments
  listComments(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<CommentThread[]>;
  postComment(input: PostCommentInput): Promise<CommentThread>;
  postReply(input: PostReplyInput): Promise<CommentThread>;
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
