import {
  CodeCommitClient,
  EvaluatePullRequestApprovalRulesCommand,
  GetBlobCommand,
  GetCommentsForPullRequestCommand,
  GetPullRequestApprovalStatesCommand,
  GetPullRequestCommand,
  type Comment as CCComment,
  type CommentsForPullRequest,
  GetDifferencesCommand,
  ListPullRequestsCommand,
  ListRepositoriesCommand,
  PostCommentForPullRequestCommand,
  PostCommentReplyCommand,
  UpdatePullRequestApprovalStateCommand,
  type Difference,
  type PullRequest,
  type PullRequestStatusEnum,
  type PullRequestTarget as CCPullRequestTarget,
} from '@aws-sdk/client-codecommit';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type {
  ApprovalAction,
  ApprovalState,
  ApprovalStateEntry,
  CommentNode,
  CommentThread,
  DiffChangeType,
  ExpandLinesRequest,
  ExpandLinesResponse,
  FileContent,
  FileDiff,
  FileDiffEntry,
  FilePair,
  ListPRsFilter,
  MergeState,
  PostCommentInput,
  PostReplyInput,
  PRDifferences,
  PRStatus,
  PullRequestApprovalView,
  PullRequestDetail,
  PullRequestSummary,
  PullRequestTarget,
  RelativeFileVersion,
  RepositorySummary,
} from '@shared/types';
import {
  decodeFile,
  looksBinary,
  type ProviderConfig,
  type ReviewProvider,
} from './ReviewProvider';
import { computeFileDiff, sliceLines } from '../diff/computeFileDiff';
import { getCachedBlob, putBlobInCache } from '../diff/blobCache';

const PR_LIST_PAGE_SIZE = 100;
const DETAIL_FETCH_CONCURRENCY = 8;
// CodeCommit GetDifferences caps MaxResults at 400. Anything higher is rejected
// with "A valid limit is between 1 and 400".
const DIFF_PAGE_SIZE = 400;

// Set DEBUG_CODECOMMIT=1 to log every CodeCommit call's name + inputs.
const DEBUG = process.env.DEBUG_CODECOMMIT === '1';

export class CodeCommitProvider implements ReviewProvider {
  readonly name = 'codecommit';

  private readonly client: CodeCommitClient;
  private readonly sts: STSClient;
  private cachedCallerArn: string | null = null;

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
    this.sts = new STSClient({ region: config.region, credentials });
  }

  // Wrap every SDK call so failures carry the command name + the AWS message,
  // and so we always know which API rejected us. Also logs to the main-process
  // console so it shows in the `npm run dev` terminal.
  private async cc<TIn extends object, TOut>(
    name: string,
    input: TIn,
    send: (i: TIn) => Promise<TOut>,
  ): Promise<TOut> {
    if (DEBUG) console.log(`[CodeCommit ${name}] →`, sanitizeForLog(input));
    try {
      return await send(input);
    } catch (err) {
      const aws = err instanceof Error ? err.message : String(err);
      console.error(
        `[CodeCommit ${name}] ✗ ${aws}\n  input=${JSON.stringify(sanitizeForLog(input))}`,
      );
      throw new Error(
        `[${name}] ${aws} (input: ${JSON.stringify(sanitizeForLog(input))})`,
      );
    }
  }

  // ---- Repos ------------------------------------------------------------

  async listRepositories(): Promise<RepositorySummary[]> {
    const out: RepositorySummary[] = [];
    let nextToken: string | undefined;
    do {
      const input = { nextToken };
      const res = await this.cc('ListRepositories', input, (i) =>
        this.client.send(new ListRepositoriesCommand(i)),
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

  // ---- PRs --------------------------------------------------------------

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
    const input = { pullRequestId };
    const res = await this.cc('GetPullRequest', input, (i) =>
      this.client.send(new GetPullRequestCommand(i)),
    );
    if (!res.pullRequest) {
      throw new Error(`Pull request ${pullRequestId} not found`);
    }
    const approvalState = await this.evaluateApproval(res.pullRequest);
    return mapPullRequest(res.pullRequest, approvalState);
  }

  // ---- Diffs ------------------------------------------------------------

  async getDifferences(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<PRDifferences> {
    const pr = await this.getPullRequest(repositoryName, pullRequestId);
    const target =
      pr.targets.find(
        (t) => t.repositoryName.toLowerCase() === repositoryName.toLowerCase(),
      ) ?? pr.targets[0];
    if (!target) {
      throw new Error(`Pull request ${pullRequestId} has no targets.`);
    }

    const afterCommit = nonEmpty(target.sourceCommitId);
    // mergeBase shows only PR-introduced changes; falls back to destination
    // tip if AWS hasn't computed the merge base yet. CodeCommit sometimes
    // returns mergeBase as an empty string, so `??` alone is not enough.
    const beforeCommit =
      nonEmpty(target.mergeBase) ?? nonEmpty(target.destinationCommitId);

    // Always log the resolved commits so we can verify they're real values,
    // not empty strings, when diagnosing diff-load failures.
    console.log(
      `[CodeCommit getDifferences] pullRequestId=${pullRequestId} ` +
        `repo=${repositoryName} ` +
        `sourceRef=${target.sourceReference} destRef=${target.destinationReference} ` +
        `sourceCommitId=${j(target.sourceCommitId)} ` +
        `destinationCommitId=${j(target.destinationCommitId)} ` +
        `mergeBase=${j(target.mergeBase)} ` +
        `→ before=${j(beforeCommit)} after=${j(afterCommit)}`,
    );

    if (!afterCommit) {
      throw new Error(
        `Pull request ${pullRequestId} has no source commit id ` +
          `(sourceReference=${target.sourceReference}, raw sourceCommitId=${j(target.sourceCommitId)}).`,
      );
    }
    if (!beforeCommit) {
      throw new Error(
        `Pull request ${pullRequestId} has no destination/merge-base commit id ` +
          `(destinationReference=${target.destinationReference}, ` +
          `raw destinationCommitId=${j(target.destinationCommitId)}, ` +
          `raw mergeBase=${j(target.mergeBase)}).`,
      );
    }

    const diffs: Difference[] = [];
    let nextToken: string | undefined;
    do {
      const input = {
        repositoryName,
        beforeCommitSpecifier: beforeCommit,
        afterCommitSpecifier: afterCommit,
        MaxResults: DIFF_PAGE_SIZE,
        NextToken: nextToken,
      };
      const res = await this.cc('GetDifferences', input, (i) =>
        this.client.send(new GetDifferencesCommand(i)),
      );
      diffs.push(...(res.differences ?? []));
      nextToken = res.NextToken;
    } while (nextToken);

    const files = diffs.map(mapDifference);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return {
      pullRequestId,
      repositoryName,
      beforeCommitId: beforeCommit,
      afterCommitId: afterCommit,
      files,
    };
  }

  async getFilePair(
    repositoryName: string,
    beforeBlobId: string | undefined,
    afterBlobId: string | undefined,
  ): Promise<FilePair> {
    const [before, after] = await Promise.all([
      this.fetchBlob(repositoryName, beforeBlobId),
      this.fetchBlob(repositoryName, afterBlobId),
    ]);
    return { before, after };
  }

  async getFileDiff(
    repositoryName: string,
    entry: FileDiffEntry,
  ): Promise<FileDiff> {
    const [beforeBytes, afterBytes] = await Promise.all([
      this.fetchBlobBytes(repositoryName, entry.beforeBlobId),
      this.fetchBlobBytes(repositoryName, entry.afterBlobId),
    ]);
    const binary =
      (beforeBytes ? looksBinary(beforeBytes) : false) ||
      (afterBytes ? looksBinary(afterBytes) : false);
    const beforeText = beforeBytes && !binary ? decodeUtf8(beforeBytes) : null;
    const afterText = afterBytes && !binary ? decodeUtf8(afterBytes) : null;
    return computeFileDiff({
      path: entry.path,
      beforePath: entry.beforePath,
      afterPath: entry.afterPath,
      changeType: entry.changeType,
      beforeBlobId: entry.beforeBlobId,
      afterBlobId: entry.afterBlobId,
      beforeText,
      afterText,
      binary,
    });
  }

  async expandLines(req: ExpandLinesRequest): Promise<ExpandLinesResponse> {
    const bytes = await this.fetchBlobBytes(req.repositoryName, req.blobId);
    if (!bytes) {
      return { lines: [], fromLine: req.fromLine, toLine: req.toLine };
    }
    if (looksBinary(bytes)) {
      return { lines: [], fromLine: req.fromLine, toLine: req.toLine };
    }
    const text = decodeUtf8(bytes);
    const lines = sliceLines(text, req.fromLine, req.toLine);
    return { lines, fromLine: req.fromLine, toLine: req.toLine };
  }

  // ---- Comments ---------------------------------------------------------

  async listComments(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<CommentThread[]> {
    // CodeCommit's GetCommentsForPullRequest requires beforeCommitId and
    // afterCommitId in practice (the docs say "optional" but the service
    // returns CommitIdRequiredException when they're omitted). Derive them
    // from the PR target — same commits the diff viewer uses.
    const { beforeCommitId, afterCommitId } =
      await this.resolveCommits(repositoryName, pullRequestId);

    const raw: CommentsForPullRequest[] = [];
    let nextToken: string | undefined;
    do {
      const input = {
        pullRequestId,
        repositoryName,
        beforeCommitId,
        afterCommitId,
        nextToken,
      };
      const res = await this.cc('GetCommentsForPullRequest', input, (i) =>
        this.client.send(new GetCommentsForPullRequestCommand(i)),
      );
      raw.push(...(res.commentsForPullRequestData ?? []));
      nextToken = res.nextToken;
    } while (nextToken);

    return raw
      .map((g) => mapCommentGroup(g, pullRequestId, repositoryName))
      .filter((t): t is CommentThread => t !== null);
  }

  private async resolveCommits(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<{ beforeCommitId: string; afterCommitId: string }> {
    const pr = await this.getPullRequest(repositoryName, pullRequestId);
    const target =
      pr.targets.find(
        (t) => t.repositoryName.toLowerCase() === repositoryName.toLowerCase(),
      ) ?? pr.targets[0];
    if (!target) {
      throw new Error(`Pull request ${pullRequestId} has no targets.`);
    }
    const afterCommitId = nonEmpty(target.sourceCommitId);
    const beforeCommitId =
      nonEmpty(target.mergeBase) ?? nonEmpty(target.destinationCommitId);
    if (!afterCommitId || !beforeCommitId) {
      throw new Error(
        `Pull request ${pullRequestId} is missing commit ids ` +
          `(sourceCommitId=${j(target.sourceCommitId)}, ` +
          `destinationCommitId=${j(target.destinationCommitId)}, ` +
          `mergeBase=${j(target.mergeBase)}).`,
      );
    }
    return { beforeCommitId, afterCommitId };
  }

  async postComment(input: PostCommentInput): Promise<CommentThread> {
    const before = nonEmpty(input.beforeCommitId);
    const after = nonEmpty(input.afterCommitId);
    if (!before || !after) {
      throw new Error(
        `postComment requires non-empty beforeCommitId and afterCommitId ` +
          `(before=${j(input.beforeCommitId)} after=${j(input.afterCommitId)})`,
      );
    }
    const sdkInput = {
      pullRequestId: input.pullRequestId,
      repositoryName: input.repositoryName,
      beforeCommitId: before,
      afterCommitId: after,
      content: input.content,
      location: {
        filePath: input.filePath,
        filePosition: input.filePosition,
        relativeFileVersion: input.relativeFileVersion,
      },
    };
    const res = await this.cc('PostCommentForPullRequest', sdkInput, (i) =>
      this.client.send(new PostCommentForPullRequestCommand(i)),
    );
    const comment = res.comment;
    if (!comment?.commentId) {
      throw new Error('CodeCommit did not return the new comment.');
    }
    return {
      threadId: comment.commentId,
      pullRequestId: input.pullRequestId,
      repositoryName: input.repositoryName,
      beforeCommitId: before,
      afterCommitId: after,
      filePath: input.filePath,
      filePosition: input.filePosition,
      relativeFileVersion: input.relativeFileVersion,
      comments: [mapComment(comment)],
    };
  }

  // ---- Approval ---------------------------------------------------------

  async getApprovalView(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<PullRequestApprovalView> {
    const pr = await this.getRawPullRequest(pullRequestId);
    const revisionId = nonEmpty(pr.revisionId);
    if (!revisionId) {
      throw new Error(
        `Pull request ${pullRequestId} has no revisionId — cannot read approvals.`,
      );
    }
    const states = await this.fetchApprovalStates(pullRequestId, revisionId);
    const selfArn = await this.callerArn();
    const selfApproved = states.some(
      (s) => s.userArn === selfArn && s.approvalState === 'APPROVE',
    );
    return { revisionId, states, selfApproved, selfArn };
  }

  async updateApprovalState(
    repositoryName: string,
    pullRequestId: string,
    action: ApprovalAction,
  ): Promise<PullRequestApprovalView> {
    const pr = await this.getRawPullRequest(pullRequestId);
    const revisionId = nonEmpty(pr.revisionId);
    if (!revisionId) {
      throw new Error(
        `Pull request ${pullRequestId} has no revisionId — cannot ${action.toLowerCase()}.`,
      );
    }
    const input = { pullRequestId, revisionId, approvalState: action };
    await this.cc('UpdatePullRequestApprovalState', input, (i) =>
      this.client.send(new UpdatePullRequestApprovalStateCommand(i)),
    );
    return this.getApprovalView(repositoryName, pullRequestId);
  }

  private async fetchApprovalStates(
    pullRequestId: string,
    revisionId: string,
  ): Promise<ApprovalStateEntry[]> {
    const input = { pullRequestId, revisionId };
    const res = await this.cc('GetPullRequestApprovalStates', input, (i) =>
      this.client.send(new GetPullRequestApprovalStatesCommand(i)),
    );
    return (res.approvals ?? [])
      .filter(
        (a): a is { userArn: string; approvalState: 'APPROVE' | 'REVOKE' } =>
          !!a.userArn && (a.approvalState === 'APPROVE' || a.approvalState === 'REVOKE'),
      )
      .map((a) => ({ userArn: a.userArn, approvalState: a.approvalState }));
  }

  private async callerArn(): Promise<string | undefined> {
    if (this.cachedCallerArn) return this.cachedCallerArn;
    try {
      const res = await this.cc('STS:GetCallerIdentity', {}, () =>
        this.sts.send(new GetCallerIdentityCommand({})),
      );
      if (res.Arn) {
        this.cachedCallerArn = res.Arn;
        return res.Arn;
      }
    } catch (err) {
      console.error('[CodeCommit] could not resolve caller ARN:', err);
    }
    return undefined;
  }

  // Internal raw fetch — gives back the SDK shape (with revisionId, etc.).
  private async getRawPullRequest(pullRequestId: string): Promise<PullRequest> {
    const input = { pullRequestId };
    const res = await this.cc('GetPullRequest', input, (i) =>
      this.client.send(new GetPullRequestCommand(i)),
    );
    if (!res.pullRequest) {
      throw new Error(`Pull request ${pullRequestId} not found`);
    }
    return res.pullRequest;
  }

  async postReply(input: PostReplyInput): Promise<CommentThread> {
    const sdkInput = {
      inReplyTo: input.inReplyTo,
      content: input.content,
    };
    const res = await this.cc('PostCommentReply', sdkInput, (i) =>
      this.client.send(new PostCommentReplyCommand(i)),
    );
    const comment = res.comment;
    if (!comment?.commentId) {
      throw new Error('CodeCommit did not return the reply comment.');
    }
    return {
      threadId: input.inReplyTo,
      pullRequestId: '',
      repositoryName: '',
      beforeCommitId: '',
      afterCommitId: '',
      comments: [mapComment(comment)],
    };
  }

  // ---- internals --------------------------------------------------------

  private async fetchBlob(
    repositoryName: string,
    blobId: string | undefined,
  ): Promise<FileContent | null> {
    const bytes = await this.fetchBlobBytes(repositoryName, blobId);
    if (!bytes) return null;
    return decodeFile(bytes);
  }

  // Returns raw blob bytes, using and populating the in-process LRU cache so
  // repeated calls (file diff + expand context + post-comment recompute) hit
  // CodeCommit at most once per blob.
  private async fetchBlobBytes(
    repositoryName: string,
    blobId: string | undefined,
  ): Promise<Uint8Array | null> {
    if (!blobId) return null;
    const cached = getCachedBlob(repositoryName, blobId);
    if (cached) return cached;
    const input = { repositoryName, blobId };
    const res = await this.cc('GetBlob', input, (i) =>
      this.client.send(new GetBlobCommand(i)),
    );
    if (!res.content) return null;
    putBlobInCache(repositoryName, blobId, res.content);
    return res.content;
  }

  private async collectPullRequestIds(
    repositoryName: string,
    status: PRStatus | undefined,
  ): Promise<string[]> {
    const ids: string[] = [];
    let nextToken: string | undefined;
    do {
      const input = {
        repositoryName,
        pullRequestStatus: status as PullRequestStatusEnum | undefined,
        maxResults: PR_LIST_PAGE_SIZE,
        nextToken,
      };
      const res = await this.cc('ListPullRequests', input, (i) =>
        this.client.send(new ListPullRequestsCommand(i)),
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
          const input = { pullRequestId: id };
          const res = await this.cc('GetPullRequest', input, (inp) =>
            this.client.send(new GetPullRequestCommand(inp)),
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
      const input = { pullRequestId: id, revisionId };
      const res = await this.cc(
        'EvaluatePullRequestApprovalRules',
        input,
        (i) =>
          this.client.send(new EvaluatePullRequestApprovalRulesCommand(i)),
      );
      return res.evaluation?.approved ? 'APPROVED' : 'NOT_APPROVED';
    } catch {
      // Approval evaluation is best-effort — never let it kill the PR list load.
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

function mapDifference(d: Difference): FileDiffEntry {
  const ct = mapChangeType(d.changeType);
  const beforePath = d.beforeBlob?.path;
  const afterPath = d.afterBlob?.path;
  const path =
    ct === 'D'
      ? (beforePath ?? afterPath ?? '?')
      : (afterPath ?? beforePath ?? '?');
  return {
    path,
    beforePath,
    afterPath,
    changeType: ct,
    beforeBlobId: d.beforeBlob?.blobId,
    afterBlobId: d.afterBlob?.blobId,
  };
}

function mapChangeType(ct: string | undefined): DiffChangeType {
  switch (ct) {
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
      return 'R';
    case 'M':
    default:
      return 'M';
  }
}

function mapCommentGroup(
  g: CommentsForPullRequest,
  pullRequestId: string,
  repositoryName: string,
): CommentThread | null {
  const comments = (g.comments ?? []).map(mapComment);
  if (comments.length === 0) return null;
  return {
    threadId: comments[0]?.id ?? `t-${Math.random()}`,
    pullRequestId,
    repositoryName,
    beforeCommitId: g.beforeCommitId ?? '',
    afterCommitId: g.afterCommitId ?? '',
    filePath: g.location?.filePath,
    filePosition: g.location?.filePosition,
    relativeFileVersion: g.location?.relativeFileVersion as
      | RelativeFileVersion
      | undefined,
    comments,
  };
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function nonEmpty(s: string | undefined): string | undefined {
  if (s === undefined || s === null) return undefined;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function j(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

// Strip values that could be sensitive (credentials, large blobs) from log output.
function sanitizeForLog<T>(input: T): T {
  if (!input || typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (k === 'content' && typeof v === 'string' && v.length > 80) {
      out[k] = `<string len=${v.length}>`;
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

function mapComment(c: CCComment): CommentNode {
  return {
    id: c.commentId ?? '',
    authorArn: c.authorArn,
    content: c.content ?? '',
    inReplyTo: c.inReplyTo,
    createdAt: c.creationDate?.toISOString(),
    lastModified: c.lastModifiedDate?.toISOString(),
    deleted: c.deleted,
  };
}
