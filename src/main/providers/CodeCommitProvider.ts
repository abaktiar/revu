import {
  CodeCommitClient,
  EvaluatePullRequestApprovalRulesCommand,
  GetBlobCommand,
  GetCommentsForPullRequestCommand,
  GetMergeConflictsCommand,
  GetMergeOptionsCommand,
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
  MergeOptionId,
  MergeState,
  PostCommentInput,
  PostReplyInput,
  PRDifferences,
  PRStatus,
  PullRequestApprovalView,
  PullRequestDetail,
  PullRequestMergeability,
  PullRequestSummary,
  PullRequestTarget,
  RelativeFileVersion,
  RepositorySummary,
} from '@shared/types';
import {
  decodeFile,
  looksBinary,
  type ProviderConfig,
  type ReadOptions,
  type ReviewProvider,
} from './ReviewProvider';
import { computeFileDiff, sliceLines } from '../diff/computeFileDiff';
import { getCachedBlob, putBlobInCache } from '../diff/blobCache';
import {
  getCached,
  invalidateCached,
  invalidateMatching,
  invalidateNamespace,
  putCached,
} from '../cache/jsonCache';
import {
  approvalKey,
  commentsKey,
  differencesKey,
  fileDiffKey,
  LIMITS,
  mergeabilityKey,
  NS,
  prDetailKey,
  prListKey,
  TTL,
} from '../cache/keys';

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

  // In-flight request coalescing. Opening a single PR triggers Promise.all of
  // ~7 IPC calls from the renderer (detail / differences / comments /
  // approval / mergeability / drafts / reviewed). Five of those independently
  // re-fetch the same PR object via GetPullRequest. Without coalescing,
  // CodeCommit rate-limits, the SDK retries with exponential backoff, and
  // main is locked up for ~10s — which is what the user sees as "the app
  // froze." We hold only the in-flight promise (auto-evicted when settled),
  // so this can never serve stale data: it only deduplicates calls already
  // racing each other.
  private inFlightPullRequests = new Map<string, Promise<PullRequest>>();
  // Approval evaluation has the same problem (called 3× in parallel per open).
  // Key includes revisionId so a new revision invalidates the cache implicitly.
  private inFlightApprovalEvals = new Map<string, Promise<ApprovalState>>();

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
      // Detect expired federated/SSO/STS credentials and surface a clear,
      // actionable message instead of the cryptic AWS text. Without this,
      // every downstream call returns the same opaque error and the user
      // has no idea their session just timed out.
      if (looksLikeExpiredCredentials(err)) {
        throw new Error(
          'AWS session expired. Refresh your credentials (re-run aws sso login, ' +
            're-export your env vars, or paste a fresh AWS access key block in Settings) and try again.',
        );
      }
      throw new Error(
        `[${name}] ${aws} (input: ${JSON.stringify(sanitizeForLog(input))})`,
      );
    }
  }

  // ---- Repos ------------------------------------------------------------

  async listRepositories(opts?: ReadOptions): Promise<RepositorySummary[]> {
    if (!opts?.forceFresh) {
      const cached = await getCached<RepositorySummary[]>(
        NS.repos,
        '_',
        TTL.repos,
      );
      if (cached) return cached;
    }
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
    await putCached(NS.repos, '_', out, LIMITS.repos);
    return out;
  }

  // ---- PRs --------------------------------------------------------------

  async listPullRequests(
    repositoryName: string,
    filter: ListPRsFilter,
    opts?: ReadOptions,
  ): Promise<PullRequestSummary[]> {
    const ck = prListKey(repositoryName, filter.status);
    if (!opts?.forceFresh) {
      const cached = await getCached<PullRequestSummary[]>(
        NS.prList,
        ck,
        TTL.prList,
      );
      if (cached) return cached;
    }
    const ids = await this.collectPullRequestIds(repositoryName, filter.status);
    const summaries = await this.fetchSummaries(ids, opts?.forceFresh);
    await putCached(NS.prList, ck, summaries, LIMITS.prList);
    return summaries;
  }

  async getPullRequest(
    _repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PullRequestDetail> {
    if (!opts?.forceFresh) {
      const cached = await getCached<PullRequestDetail>(
        NS.prDetail,
        prDetailKey(pullRequestId),
        TTL.prDetail,
      );
      if (cached) return cached;
    }
    const pr = await this.fetchRawPullRequest(pullRequestId, opts?.forceFresh);
    const approvalState = await this.evaluateApproval(pr);
    const detail = mapPullRequest(pr, approvalState);
    await putCached(
      NS.prDetail,
      prDetailKey(pullRequestId),
      detail,
      LIMITS.prDetail,
    );
    return detail;
  }

  // ---- Diffs ------------------------------------------------------------

  async getDifferences(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PRDifferences> {
    const pr = await this.getPullRequest(repositoryName, pullRequestId, opts);
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

    // Cache lookup: keyed by the (before, after) commit pair. Commits are
    // immutable in git, so this entry stays valid forever — no TTL.
    const dKey = differencesKey(repositoryName, beforeCommit, afterCommit);
    if (!opts?.forceFresh) {
      const cached = await getCached<PRDifferences>(NS.differences, dKey);
      if (cached) return cached;
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
    const result: PRDifferences = {
      pullRequestId,
      repositoryName,
      beforeCommitId: beforeCommit,
      afterCommitId: afterCommit,
      files,
    };
    await putCached(NS.differences, dKey, result, LIMITS.differences);
    return result;
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
    opts?: ReadOptions,
  ): Promise<FileDiff> {
    // Cache lookup: keyed by the (beforeBlobId, afterBlobId, changeType)
    // triple. Blob IDs are content-addressed, so the same pair always
    // produces the same diff. No TTL.
    const fKey = fileDiffKey(
      entry.beforeBlobId,
      entry.afterBlobId,
      entry.changeType,
    );
    if (!opts?.forceFresh) {
      const cached = await getCached<FileDiff>(NS.fileDiff, fKey);
      if (cached) return cached;
    }

    const [beforeBytes, afterBytes] = await Promise.all([
      this.fetchBlobBytes(repositoryName, entry.beforeBlobId),
      this.fetchBlobBytes(repositoryName, entry.afterBlobId),
    ]);
    const binary =
      (beforeBytes ? looksBinary(beforeBytes) : false) ||
      (afterBytes ? looksBinary(afterBytes) : false);
    const beforeText = beforeBytes && !binary ? decodeUtf8(beforeBytes) : null;
    const afterText = afterBytes && !binary ? decodeUtf8(afterBytes) : null;
    const diff = computeFileDiff({
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
    await putCached(NS.fileDiff, fKey, diff, LIMITS.fileDiff);
    return diff;
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
    opts?: ReadOptions,
  ): Promise<CommentThread[]> {
    const cKey = commentsKey(repositoryName, pullRequestId);
    if (!opts?.forceFresh) {
      const cached = await getCached<CommentThread[]>(
        NS.comments,
        cKey,
        TTL.comments,
      );
      if (cached) return cached;
    }

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

    const threads = raw
      .map((g) => mapCommentGroup(g, pullRequestId, repositoryName))
      .filter((t): t is CommentThread => t !== null);
    await putCached(NS.comments, cKey, threads, LIMITS.comments);
    return threads;
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
    // Comments cache is now stale; next listComments must hit AWS.
    await invalidateCached(
      NS.comments,
      commentsKey(input.repositoryName, input.pullRequestId),
    );
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
    opts?: ReadOptions,
  ): Promise<PullRequestApprovalView> {
    const pr = await this.getRawPullRequest(pullRequestId, opts?.forceFresh);
    const revisionId = nonEmpty(pr.revisionId);
    if (!revisionId) {
      throw new Error(
        `Pull request ${pullRequestId} has no revisionId — cannot read approvals.`,
      );
    }
    // Cache lookup: keyed by revisionId. CodeCommit changes revisionId on any
    // PR update, so the cached entry is implicitly invalidated whenever the
    // PR's approval-relevant state could have shifted. No TTL needed.
    const aKey = approvalKey(pullRequestId, revisionId);
    if (!opts?.forceFresh) {
      const cached = await getCached<PullRequestApprovalView>(
        NS.approval,
        aKey,
      );
      if (cached) return cached;
    }
    const states = await this.fetchApprovalStates(pullRequestId, revisionId);
    const selfArn = await this.callerArn();
    const selfApproved = states.some(
      (s) => s.userArn === selfArn && s.approvalState === 'APPROVE',
    );
    const view: PullRequestApprovalView = {
      revisionId,
      states,
      selfApproved,
      selfArn,
    };
    await putCached(NS.approval, aKey, view, LIMITS.approval);
    return view;
  }

async getMergeability(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PullRequestMergeability> {
    const mKey = mergeabilityKey(repositoryName, pullRequestId);
    if (!opts?.forceFresh) {
      const cached = await getCached<PullRequestMergeability>(
        NS.mergeability,
        mKey,
        TTL.mergeability,
      );
      if (cached) return cached;
    }
    const result = await this.computeMergeability(
      repositoryName,
      pullRequestId,
      opts?.forceFresh,
    );
    await putCached(NS.mergeability, mKey, result, LIMITS.mergeability);
    return result;
  }

  private async computeMergeability(
    repositoryName: string,
    pullRequestId: string,
    forceFresh: boolean | undefined,
  ): Promise<PullRequestMergeability> {
    const pr = await this.getRawPullRequest(pullRequestId, forceFresh);
    const target =
      (pr.pullRequestTargets ?? []).find(
        (t) =>
          (t.repositoryName ?? '').toLowerCase() ===
          repositoryName.toLowerCase(),
      ) ?? pr.pullRequestTargets?.[0];

    if (target?.mergeMetadata?.isMerged === true) {
      return {
        state: 'already_merged',
        mergeOptions: [],
        mergedBy: target.mergeMetadata.mergedBy,
        mergeCommitId: target.mergeMetadata.mergeCommitId,
      };
    }

    const destinationCommit = nonEmpty(target?.destinationCommit);
    const sourceCommit = nonEmpty(target?.sourceCommit);
    if (!destinationCommit || !sourceCommit) {
      return {
        state: 'unknown',
        mergeOptions: [],
        reason: 'PR is missing source/destination commit ids.',
      };
    }

    // Step 1: ask CodeCommit which strategies are available. GetMergeOptions
    // throws ManualMergeRequiredException when there's no way to auto-merge
    // (which usually means conflicts in every strategy).
    let strategies: MergeOptionId[] = [];
    try {
      const res = await this.cc(
        'GetMergeOptions',
        {
          repositoryName,
          destinationCommitSpecifier: destinationCommit,
          sourceCommitSpecifier: sourceCommit,
        },
        (i) => this.client.send(new GetMergeOptionsCommand(i)),
      );
      strategies = (res.mergeOptions ?? []) as MergeOptionId[];
    } catch (err) {
      return {
        state: 'has_conflicts',
        mergeOptions: [],
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    // Step 2: GetMergeOptions returning a strategy doesn't actually guarantee
    // a clean merge — it just means CodeCommit can attempt that strategy. To
    // match the console's "Resolve conflicts" indicator, we have to ask
    // GetMergeConflicts (THREE_WAY_MERGE is the most permissive — if it can't
    // merge cleanly, the other strategies won't either).
    if (strategies.length === 0) {
      return {
        state: 'has_conflicts',
        mergeOptions: [],
        reason: 'No merge strategy is available for this PR.',
      };
    }
    try {
      const res = await this.cc(
        'GetMergeConflicts',
        {
          repositoryName,
          destinationCommitSpecifier: destinationCommit,
          sourceCommitSpecifier: sourceCommit,
          mergeOption: 'THREE_WAY_MERGE' as const,
          conflictDetailLevel: 'FILE_LEVEL' as const,
          maxConflictFiles: 50,
        },
        (i) => this.client.send(new GetMergeConflictsCommand(i)),
      );
      if (res.mergeable === true) {
        return { state: 'mergeable', mergeOptions: strategies };
      }
      const conflictFiles = (res.conflictMetadataList ?? [])
        .map((c) => c.filePath)
        .filter((p): p is string => !!p);
      return {
        state: 'has_conflicts',
        mergeOptions: strategies,
        conflictCount: conflictFiles.length,
        conflictFiles: conflictFiles.slice(0, 10),
      };
    } catch (err) {
      return {
        state: 'unknown',
        mergeOptions: strategies,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
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
    // Approval changed → drop cached approval/pr-detail/pr-list entries that
    // depend on it. PR-list filters by approval state, so its cache is also
    // stale until a fresh refresh.
    await Promise.all([
      invalidateCached(NS.approval, approvalKey(pullRequestId, revisionId)),
      invalidateCached(NS.prDetail, prDetailKey(pullRequestId)),
      invalidateNamespace(NS.prList),
    ]);
    return this.getApprovalView(repositoryName, pullRequestId, {
      forceFresh: true,
    });
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
  // All internal call sites go through here so concurrent loads coalesce onto
  // a single GetPullRequest. (See fetchRawPullRequest comment for context.)
  private async getRawPullRequest(
    pullRequestId: string,
    forceFresh?: boolean,
  ): Promise<PullRequest> {
    return this.fetchRawPullRequest(pullRequestId, forceFresh);
  }

  // The one place that actually issues GetPullRequest. Everything else routes
  // through here. Only in-flight promises are cached — once settled the entry
  // is evicted, so we can never serve stale data; we only avoid the
  // rate-limit storm when multiple call sites race.
  //
  // `forceFresh` opts out of the in-flight coalescing too — when the user hits
  // Refresh we genuinely want a new SDK call, not the in-flight one that
  // started before the refresh button was pressed.
  private async fetchRawPullRequest(
    pullRequestId: string,
    forceFresh?: boolean,
  ): Promise<PullRequest> {
    if (!forceFresh) {
      const existing = this.inFlightPullRequests.get(pullRequestId);
      if (existing) return existing;
    }
    const promise = (async () => {
      const input = { pullRequestId };
      const res = await this.cc('GetPullRequest', input, (i) =>
        this.client.send(new GetPullRequestCommand(i)),
      );
      if (!res.pullRequest) {
        throw new Error(`Pull request ${pullRequestId} not found`);
      }
      return res.pullRequest;
    })();
    this.inFlightPullRequests.set(pullRequestId, promise);
    void promise.finally(() => {
      if (this.inFlightPullRequests.get(pullRequestId) === promise) {
        this.inFlightPullRequests.delete(pullRequestId);
      }
    });
    return promise;
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
    // We don't know which PR this reply belongs to from PostReplyInput, so
    // we conservatively drop every cached comments list. The namespace is
    // capped tightly (LIMITS.comments), so this is cheap.
    await invalidateNamespace(NS.comments);
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

  private async fetchSummaries(
    ids: string[],
    forceFresh?: boolean,
  ): Promise<PullRequestSummary[]> {
    const out: PullRequestSummary[] = [];
    for (let i = 0; i < ids.length; i += DETAIL_FETCH_CONCURRENCY) {
      const batch = ids.slice(i, i + DETAIL_FETCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            // Per-PR cache: if a PR detail is cached and we're not forcing
            // fresh, reuse it. This is the big win for revisiting the PR
            // list — only PRs we don't have yet (or that have rolled past
            // their TTL) hit AWS.
            if (!forceFresh) {
              const cached = await getCached<PullRequestSummary>(
                NS.prDetail,
                prDetailKey(id),
                TTL.prDetail,
              );
              if (cached) return cached;
            }
            const pr = await this.fetchRawPullRequest(id, forceFresh);
            const approvalState = await this.evaluateApproval(pr);
            const summary = mapPullRequest(pr, approvalState);
            await putCached(
              NS.prDetail,
              prDetailKey(id),
              summary,
              LIMITS.prDetail,
            );
            return summary;
          } catch {
            // One PR failing (e.g. not-found, or transient throttle) must not
            // tank the whole list. Skip it.
            return null;
          }
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

    const key = `${id}|${revisionId}`;
    const existing = this.inFlightApprovalEvals.get(key);
    if (existing) return existing;

    const promise = (async (): Promise<ApprovalState> => {
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
    })();
    this.inFlightApprovalEvals.set(key, promise);
    void promise.finally(() => {
      if (this.inFlightApprovalEvals.get(key) === promise) {
        this.inFlightApprovalEvals.delete(key);
      }
    });
    return promise;
  }

  // ---- Cache management ----------------------------------------------

  // Drop every cached entry tied to one PR. Used by the renderer's per-PR
  // Refresh button: after this returns, the next read for this PR will hit
  // AWS regardless of TTLs. We intentionally do NOT touch the file-diff
  // cache (keyed by blob IDs) or the differences cache (keyed by commit
  // IDs) — those are content-addressed and remain valid; if a new commit
  // got pushed the keys themselves change.
  async invalidatePullRequest(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<void> {
    await Promise.all([
      invalidateCached(NS.prDetail, prDetailKey(pullRequestId)),
      invalidateCached(NS.comments, commentsKey(repositoryName, pullRequestId)),
      invalidateCached(
        NS.mergeability,
        mergeabilityKey(repositoryName, pullRequestId),
      ),
      // We don't know revisionId here, so drop every approval entry for
      // this PR.
      invalidateMatching(NS.approval, (k) =>
        k.startsWith(`${pullRequestId}|`),
      ),
    ]);
  }

  // Drop every cached entry tied to one repo. Used by the PR-list Refresh
  // button. Touches PR list + every per-PR cache for this repo.
  async invalidateRepository(repositoryName: string): Promise<void> {
    await Promise.all([
      invalidateMatching(NS.prList, (k) => k.startsWith(`${repositoryName}|`)),
      invalidateMatching(NS.comments, (k) =>
        k.startsWith(`${repositoryName}|`),
      ),
      invalidateMatching(NS.mergeability, (k) =>
        k.startsWith(`${repositoryName}|`),
      ),
      invalidateMatching(NS.differences, (k) =>
        k.startsWith(`${repositoryName}|`),
      ),
      // PR-detail and approval are not keyed by repo; we drop them wholesale
      // because the user's intent on "refresh repo" is "show me the truth."
      invalidateNamespace(NS.prDetail),
      invalidateNamespace(NS.approval),
    ]);
  }

  async invalidateAll(): Promise<void> {
    await Promise.all([
      invalidateNamespace(NS.repos),
      invalidateNamespace(NS.prList),
      invalidateNamespace(NS.prDetail),
      invalidateNamespace(NS.comments),
      invalidateNamespace(NS.mergeability),
      invalidateNamespace(NS.differences),
      invalidateNamespace(NS.fileDiff),
      invalidateNamespace(NS.approval),
    ]);
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

function looksLikeExpiredCredentials(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // AWS SDK v3 attaches a `name` / `Code` of "ExpiredToken" or
  // "ExpiredTokenException" for STS-issued temporary credentials, and may
  // also report "InvalidClientTokenId" / "UnrecognizedClientException" if
  // the access key itself was revoked. Match on either the typed name or
  // the human-readable message because different services format these
  // slightly differently.
  const e = err as { name?: string; Code?: string; message?: string };
  const tag = (e.name ?? e.Code ?? '').toString();
  const msg = (e.message ?? '').toString().toLowerCase();
  if (/expiredtoken|invalidclienttoken|unrecognizedclient/i.test(tag)) {
    return true;
  }
  if (
    msg.includes('security token included in the request is expired') ||
    msg.includes('the security token included in the request is invalid') ||
    msg.includes('credentials could not be refreshed')
  ) {
    return true;
  }
  return false;
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
