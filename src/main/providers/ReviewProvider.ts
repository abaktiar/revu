import type {
  ListPRsFilter,
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

  listRepositories(): Promise<RepositorySummary[]>;

  listPullRequests(
    repositoryName: string,
    filter: ListPRsFilter,
  ): Promise<PullRequestSummary[]>;

  getPullRequest(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<PullRequestDetail>;

  // M3+ surface — declared here so the contract is visible, implemented later.
  // listComments?(repositoryName: string, pullRequestId: string): Promise<CommentThread[]>;
  // postComment?(input: PostCommentInput): Promise<Comment>;
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
