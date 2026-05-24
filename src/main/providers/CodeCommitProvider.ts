import {
  CodeCommitClient,
  EvaluatePullRequestApprovalRulesCommand,
  GetPullRequestCommand,
  ListPullRequestsCommand,
  ListRepositoriesCommand,
  type PullRequest,
  type PullRequestStatusEnum,
  type PullRequestTarget as CCPullRequestTarget,
} from '@aws-sdk/client-codecommit';
import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type {
  ApprovalState,
  ListPRsFilter,
  MergeState,
  PRStatus,
  PullRequestDetail,
  PullRequestSummary,
  PullRequestTarget,
  RepositorySummary,
} from '@shared/types';
import type { ProviderConfig, ReviewProvider } from './ReviewProvider';

const PR_LIST_PAGE_SIZE = 100;
const DETAIL_FETCH_CONCURRENCY = 8;

export class CodeCommitProvider implements ReviewProvider {
  readonly name = 'codecommit';

  private readonly client: CodeCommitClient;

  constructor(config: ProviderConfig) {
    const credentials = config.staticCredentials
      ? {
          accessKeyId: config.staticCredentials.accessKeyId,
          secretAccessKey: config.staticCredentials.secretAccessKey,
          sessionToken: config.staticCredentials.sessionToken,
        }
      : config.profile
        ? fromIni({ profile: config.profile })
        : fromNodeProviderChain();

    this.client = new CodeCommitClient({
      region: config.region,
      credentials,
    });
  }

  async listRepositories(): Promise<RepositorySummary[]> {
    const out: RepositorySummary[] = [];
    let nextToken: string | undefined;
    do {
      const res = await this.client.send(
        new ListRepositoriesCommand({ nextToken }),
      );
      for (const r of res.repositories ?? []) {
        if (r.repositoryName) {
          out.push({ name: r.repositoryName, id: r.repositoryId });
        }
      }
      nextToken = res.nextToken;
    } while (nextToken);
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async listPullRequests(
    repositoryName: string,
    filter: ListPRsFilter,
  ): Promise<PullRequestSummary[]> {
    const ids = await this.collectPullRequestIds(repositoryName, filter.status);
    return this.fetchSummaries(ids);
  }

  async getPullRequest(
    _repositoryName: string,
    pullRequestId: string,
  ): Promise<PullRequestDetail> {
    const res = await this.client.send(
      new GetPullRequestCommand({ pullRequestId }),
    );
    if (!res.pullRequest) {
      throw new Error(`Pull request ${pullRequestId} not found`);
    }
    const approvalState = await this.evaluateApproval(res.pullRequest);
    return mapPullRequest(res.pullRequest, approvalState);
  }

  private async collectPullRequestIds(
    repositoryName: string,
    status: PRStatus | undefined,
  ): Promise<string[]> {
    const ids: string[] = [];
    let nextToken: string | undefined;
    do {
      const res = await this.client.send(
        new ListPullRequestsCommand({
          repositoryName,
          pullRequestStatus: status as PullRequestStatusEnum | undefined,
          maxResults: PR_LIST_PAGE_SIZE,
          nextToken,
        }),
      );
      if (res.pullRequestIds) ids.push(...res.pullRequestIds);
      nextToken = res.nextToken;
    } while (nextToken);
    return ids;
  }

  private async fetchSummaries(ids: string[]): Promise<PullRequestSummary[]> {
    const out: PullRequestSummary[] = [];
    for (let i = 0; i < ids.length; i += DETAIL_FETCH_CONCURRENCY) {
      const batch = ids.slice(i, i + DETAIL_FETCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (id) => {
          const res = await this.client.send(
            new GetPullRequestCommand({ pullRequestId: id }),
          );
          if (!res.pullRequest) return null;
          const approvalState = await this.evaluateApproval(res.pullRequest);
          return mapPullRequest(res.pullRequest, approvalState);
        }),
      );
      for (const r of results) {
        if (r) out.push(r);
      }
    }
    return out;
  }

  private async evaluateApproval(pr: PullRequest): Promise<ApprovalState> {
    const id = pr.pullRequestId;
    const revisionId = pr.revisionId;
    const rules = pr.approvalRules ?? [];
    if (!id || !revisionId) return 'UNKNOWN';
    if (rules.length === 0) return 'NO_RULES';
    try {
      const res = await this.client.send(
        new EvaluatePullRequestApprovalRulesCommand({
          pullRequestId: id,
          revisionId,
        }),
      );
      return res.evaluation?.approved ? 'APPROVED' : 'NOT_APPROVED';
    } catch {
      // Evaluation can fail (e.g. revision mismatch). Don't kill the whole list.
      return 'UNKNOWN';
    }
  }
}

function mapPullRequest(
  pr: PullRequest,
  approvalState: ApprovalState,
): PullRequestDetail {
  const targets = (pr.pullRequestTargets ?? []).map(mapTarget);
  const merged = targets.some(
    (_t, i) => pr.pullRequestTargets?.[i]?.mergeMetadata?.isMerged === true,
  );
  return {
    id: pr.pullRequestId ?? '',
    title: pr.title ?? '(untitled)',
    description: pr.description,
    authorArn: pr.authorArn,
    status: (pr.pullRequestStatus as PRStatus | undefined) ?? 'OPEN',
    mergeState: merged ? 'MERGED' : 'NOT_MERGED',
    approvalState,
    createdAt: pr.creationDate?.toISOString(),
    lastActivityAt: pr.lastActivityDate?.toISOString(),
    targets,
  };
}

function mapTarget(t: CCPullRequestTarget): PullRequestTarget {
  return {
    repositoryName: t.repositoryName ?? '',
    sourceReference: t.sourceReference ?? '',
    destinationReference: t.destinationReference ?? '',
    sourceCommitId: t.sourceCommit,
    destinationCommitId: t.destinationCommit,
    mergeBase: t.mergeBase,
  };
}
