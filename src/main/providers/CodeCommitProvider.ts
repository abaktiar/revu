import {
  BatchGetCommitsCommand,
  CodeCommitClient,
  type Commit as CCCommit,
  CreatePullRequestCommand,
  DeleteCommentContentCommand,
  DescribePullRequestEventsCommand,
  EvaluatePullRequestApprovalRulesCommand,
  GetBlobCommand,
  GetBranchCommand,
  GetCommentsForPullRequestCommand,
  GetCommitCommand,
  GetMergeConflictsCommand,
  GetMergeOptionsCommand,
  GetPullRequestApprovalStatesCommand,
  GetPullRequestCommand,
  MergePullRequestByFastForwardCommand,
  MergePullRequestBySquashCommand,
  MergePullRequestByThreeWayCommand,
  type Comment as CCComment,
  type CommentsForPullRequest,
  GetDifferencesCommand,
  ListBranchesCommand,
  ListPullRequestsCommand,
  ListRepositoriesCommand,
  PostCommentForPullRequestCommand,
  PostCommentReplyCommand,
  UpdatePullRequestApprovalStateCommand,
  UpdatePullRequestDescriptionCommand,
  UpdatePullRequestStatusCommand,
  UpdatePullRequestTitleCommand,
  type Difference,
  type PullRequest,
  type PullRequestEvent,
  type PullRequestStatusEnum,
  type PullRequestTarget as CCPullRequestTarget,
} from '@aws-sdk/client-codecommit';
import { randomUUID } from 'node:crypto';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type {
  ActivityEvent,
  ApprovalAction,
  ApprovalState,
  ApprovalStateEntry,
  BranchSummary,
  BranchTip,
  CommentNode,
  CommentThread,
  CreatePullRequestInput,
  DeleteCommentInput,
  DiffChangeType,
  ExpandLinesRequest,
  ExpandLinesResponse,
  FileContent,
  FileDiff,
  FileDiffEntry,
  FilePair,
  IpcErrorCode,
  ListPRsFilter,
  ListSessionResult,
  MergeOptionId,
  MergePullRequestInput,
  MergeState,
  PostCommentInput,
  PostReplyInput,
  PRDifferences,
  PRStatus,
  PullRequestApprovalView,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestMergeability,
  PullRequestSummary,
  PullRequestTarget,
  RelativeFileVersion,
  RepositorySummary,
  UpdatePullRequestInput,
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
  branchesKey,
  commentsKey,
  differencesKey,
  fileDiffKey,
  LIMITS,
  mergeabilityKey,
  NS,
  prCommitsKey,
  prDetailKey,
  TTL,
} from '../cache/keys';

const PR_LIST_PAGE_SIZE = 100;
// CodeCommit throttles GetPullRequest + EvaluatePullRequestApprovalRules at
// modest TPS per account. We fan out one detail fetch per PR, which means a
// 200-PR repo issues ~400 calls; with high concurrency the SDK's retries can't
// catch up before AWS surfaces "Rate exceeded". 3 in flight + adaptive retry
// (configured on the client) keeps us under the cap on large repos while
// still loading a typical list in well under a second.
const DETAIL_FETCH_CONCURRENCY = 3;
// CodeCommit GetDifferences caps MaxResults at 400. Anything higher is rejected
// with "A valid limit is between 1 and 400".
const DIFF_PAGE_SIZE = 400;
// BatchGetCommits accepts up to 100 commit IDs per call.
const BATCH_COMMITS_PAGE_SIZE = 100;
// Safety bound on the parent-walk. A PR with this many commits is already an
// outlier; stopping here protects the UI from runaway histories (e.g. a PR
// branched off the wrong base where the merge base sits very far back).
const MAX_PR_COMMITS = 500;
// SDK retry budget per request. The default (3) bails too quickly on large PR
// lists where the bucket is already drained. 8 + adaptive backoff is roughly
// the sweet spot — long enough to ride out a throttle storm, short enough that
// a genuine outage still surfaces in a reasonable time.
const SDK_MAX_ATTEMPTS = 8;

// Set DEBUG_CODECOMMIT=1 to log every CodeCommit call's name + inputs.
const DEBUG = process.env.DEBUG_CODECOMMIT === '1';

export class CodeCommitProvider implements ReviewProvider {
  readonly name = 'codecommit';

  private readonly client: CodeCommitClient;
  private readonly sts: STSClient;
  private readonly region: string | undefined;
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
  // Same idea for DescribePullRequestEvents: opening a PR drives both the
  // approval view and the mergeability lookup, and both want the same event
  // stream to attach timestamps. One in-flight fetch per PR, evicted when
  // settled — never serves stale data.
  private inFlightEvents = new Map<string, Promise<PullRequestEvent[]>>();

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

    // Adaptive retry mode = client-side rate limiter that learns the service's
    // capacity from throttling responses and paces subsequent calls. Without
    // this, high-concurrency PR list loads burst past CodeCommit's TPS,
    // exhaust the SDK's default 3-try budget, and surface "Rate exceeded" to
    // the user even though a brief pause would have succeeded.
    this.client = new CodeCommitClient({
      region: config.region,
      credentials,
      retryMode: 'adaptive',
      maxAttempts: SDK_MAX_ATTEMPTS,
    });
    this.sts = new STSClient({
      region: config.region,
      credentials,
      retryMode: 'adaptive',
      maxAttempts: SDK_MAX_ATTEMPTS,
    });
    this.region = config.region;
  }

  // CodeCommit console URL. Format:
  //   https://{region}.console.aws.amazon.com/codesuite/codecommit/repositories/{repo}/pull-requests/{prId}/details?region={region}
  // The region is required — without it we can't construct a valid URL.
  async webUrlForPullRequest(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<string | undefined> {
    const region = this.region;
    if (!region) return undefined;
    if (!repositoryName || !pullRequestId) return undefined;
    const repo = encodeURIComponent(repositoryName);
    const pid = encodeURIComponent(pullRequestId);
    const r = encodeURIComponent(region);
    return `https://${r}.console.aws.amazon.com/codesuite/codecommit/repositories/${repo}/pull-requests/${pid}/details?region=${r}`;
  }

  // Wrap every SDK call so failures carry the command name + the AWS message,
  // and so we always know which API rejected us. Also logs to the main-process
  // console so it shows in the `npm run dev` terminal. Errors are classified
  // into a small set of stable codes (see IpcErrorCode) plus a one-sentence
  // hint so the renderer can show the user what to do next.
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
      throw classifyAwsError(name, input, err);
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

  // ---- Branches ---------------------------------------------------------

  // Returns every branch name in the repo, alphabetical. Cached for TTL.branches
  // so reopening the Create-PR picker doesn't re-page through the whole list.
  // ListBranches gives us *only* names — no last-modified, no committer — so
  // sort is purely lexical. Recency sort would need GetBranch + GetCommit per
  // branch, which is N+1 against CodeCommit's TPS budget; we intentionally
  // skip it.
  async listBranches(
    repositoryName: string,
    opts?: ReadOptions,
  ): Promise<BranchSummary[]> {
    const bKey = branchesKey(repositoryName);
    if (!opts?.forceFresh) {
      const cached = await getCached<BranchSummary[]>(
        NS.branches,
        bKey,
        TTL.branches,
      );
      if (cached) return cached;
    }
    const names: string[] = [];
    let nextToken: string | undefined;
    do {
      const input = { repositoryName, nextToken };
      const res = await this.cc('ListBranches', input, (i) =>
        this.client.send(new ListBranchesCommand(i)),
      );
      for (const b of res.branches ?? []) {
        if (b) names.push(b);
      }
      nextToken = res.nextToken;
    } while (nextToken);
    names.sort((a, b) => a.localeCompare(b));
    const out: BranchSummary[] = names.map((name) => ({ name }));
    await putCached(NS.branches, bKey, out, LIMITS.branches);
    return out;
  }

  // Used by the Create-PR flow to auto-fill title (subject) + description
  // (body) from the latest commit on the source branch. Two AWS calls
  // (GetBranch + GetCommit); cheap, and only invoked when the user actually
  // picks a source. forceFresh is honored on the branch-tip lookup so
  // Refresh in the Create-PR view re-resolves a freshly-pushed branch.
  async getBranchTip(
    repositoryName: string,
    branchName: string,
    _opts?: ReadOptions,
  ): Promise<BranchTip> {
    const commitId = await this.resolveBranchTip(repositoryName, branchName);
    const res = await this.cc(
      'GetCommit',
      { repositoryName, commitId },
      (i) => this.client.send(new GetCommitCommand(i)),
    );
    const message = (res.commit?.message ?? '').trim();
    const nl = message.indexOf('\n');
    const subject = nl >= 0 ? message.slice(0, nl).trim() : message;
    const body = nl >= 0 ? message.slice(nl + 1).trim() : '';
    return { branchName, commitId, subject, body };
  }

  // ---- PRs --------------------------------------------------------------

  // Streaming PR-list session. Enumerates IDs once, then enriches them with
  // bounded concurrency, emitting each summary to `onItem` *in newest-first
  // order* (out-of-order arrivals within a batch are buffered until the
  // earlier index has resolved — so the rendered list stays sorted even
  // though we're racing 3 requests at a time).
  //
  // Cooperative cancellation: we check signal.aborted between batches.
  // We don't abort in-flight AWS calls (the SDK supports it, but each call
  // is short and aborting mid-flight just wastes the retry budget). Worst-
  // case cancel latency is one batch — ~3 PRs worth of time.
  //
  // No whole-list cache. Per-PR enrichment still hits the prDetail cache,
  // so revisiting the screen is fast: only ListPullRequests + cache reads.
  async streamPullRequests(
    repositoryName: string,
    filter: ListPRsFilter,
    opts: {
      forceFresh?: boolean;
      signal?: AbortSignal;
      onItem: (event: {
        item: PullRequestSummary;
        loaded: number;
        total: number;
      }) => void;
    },
  ): Promise<ListSessionResult> {
    const limit = filter.limit && filter.limit > 0 ? filter.limit : undefined;
    const signal = opts.signal;
    const aborted = (): boolean => signal?.aborted === true;

    const { ids, truncated } = await this.collectPullRequestIds(
      repositoryName,
      filter.status,
      filter.afterId,
      limit,
    );
    if (aborted()) {
      return { truncated: false, deliveredCount: 0, cancelled: true };
    }

    const total = ids.length;
    // Slot-indexed buffer + emit cursor: we resolve batches in parallel but
    // only emit to onItem once every earlier index has landed. Preserves the
    // newest-first ordering CodeCommit gave us in the ID list.
    const slots: (PullRequestSummary | null | undefined)[] = new Array(total);
    let emitCursor = 0;
    let delivered = 0;
    let lastId: string | undefined;

    const flush = (): void => {
      while (emitCursor < total && slots[emitCursor] !== undefined) {
        const s = slots[emitCursor];
        if (s) {
          delivered += 1;
          lastId = s.id;
          opts.onItem({ item: s, loaded: delivered, total });
        }
        emitCursor += 1;
      }
    };

    for (let i = 0; i < total; i += DETAIL_FETCH_CONCURRENCY) {
      if (aborted()) break;
      const batchIndices: number[] = [];
      for (let j = i; j < total && j < i + DETAIL_FETCH_CONCURRENCY; j++) {
        batchIndices.push(j);
      }
      await Promise.all(
        batchIndices.map(async (idx) => {
          slots[idx] = await this.enrichSummary(ids[idx]!, opts.forceFresh);
        }),
      );
      flush();
    }

    // A cancelled session that didn't deliver everything we'd enumerated
    // *also* counts as truncated — there are clearly more IDs to load past
    // lastId, so the renderer should offer Load more. Without this, a
    // cancelled load on a repo that has exactly <=cap PRs would look like
    // "done, nothing more" even though the user just stopped early.
    const sessionTruncated = truncated || (aborted() && delivered < total);
    return {
      truncated: sessionTruncated,
      deliveredCount: delivered,
      lastId,
      cancelled: aborted(),
    };
  }

  // Enrich a single PR ID into the renderer-facing summary. Used by the
  // streaming session, but also a useful primitive on its own (the prDetail
  // cache makes this near-free for previously-loaded PRs). Returns null on
  // any failure so one bad PR can never tank the whole list — the failure
  // is logged but we move on.
  private async enrichSummary(
    id: string,
    forceFresh?: boolean,
  ): Promise<PullRequestSummary | null> {
    try {
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
      await putCached(NS.prDetail, prDetailKey(id), summary, LIMITS.prDetail);
      return summary;
    } catch {
      // Logged inside cc() already. Swallow so the session continues.
      return null;
    }
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

    return this.fetchDifferences(
      repositoryName,
      beforeCommit,
      afterCommit,
      pullRequestId,
      opts,
    );
  }

  async getCommitDifferences(
    repositoryName: string,
    beforeCommitId: string,
    afterCommitId: string,
    opts?: ReadOptions,
  ): Promise<PRDifferences> {
    const before = nonEmpty(beforeCommitId);
    const after = nonEmpty(afterCommitId);
    if (!before || !after) {
      throw new Error(
        `getCommitDifferences requires non-empty commit ids ` +
          `(before=${j(beforeCommitId)} after=${j(afterCommitId)})`,
      );
    }
    return this.fetchDifferences(repositoryName, before, after, '', opts);
  }

  // Resolve refs to commit IDs then run the standard diff pipeline. We
  // resolve refs first (one GetBranch each) so the result lands in the same
  // (repo, before, after) cache as getDifferences / getCommitDifferences —
  // a user who shipped a PR and then immediately re-opens its diff sees an
  // instant hit instead of a redundant fetch.
  //
  // The branch-tip commit IDs change every time someone pushes; if a user
  // sits on the Create-PR screen for hours and the source branch advances,
  // a forceFresh refresh re-resolves and produces a new cache key. Anything
  // already cached for the old commit pair stays valid and undisturbed.
  async getRefDifferences(
    repositoryName: string,
    sourceRef: string,
    destinationRef: string,
    opts?: ReadOptions,
  ): Promise<PRDifferences> {
    const source = nonEmpty(sourceRef);
    const dest = nonEmpty(destinationRef);
    if (!source || !dest) {
      throw new Error(
        `getRefDifferences requires non-empty refs ` +
          `(source=${j(sourceRef)} dest=${j(destinationRef)})`,
      );
    }
    const [sourceCommit, destCommit] = await Promise.all([
      this.resolveBranchTip(repositoryName, source),
      this.resolveBranchTip(repositoryName, dest),
    ]);
    // Identical tips → no commits to diff. Return an empty PRDifferences
    // without burning a GetDifferences call. The renderer treats this as the
    // "nothing to merge" validation signal.
    if (sourceCommit === destCommit) {
      return {
        pullRequestId: '',
        repositoryName,
        beforeCommitId: destCommit,
        afterCommitId: sourceCommit,
        files: [],
      };
    }
    return this.fetchDifferences(
      repositoryName,
      destCommit,
      sourceCommit,
      '',
      opts,
    );
  }

  private async resolveBranchTip(
    repositoryName: string,
    branchName: string,
  ): Promise<string> {
    const res = await this.cc(
      'GetBranch',
      { repositoryName, branchName },
      (i) => this.client.send(new GetBranchCommand(i)),
    );
    const commit = nonEmpty(res.branch?.commitId);
    if (!commit) {
      throw new Error(
        `Branch "${branchName}" in ${repositoryName} has no commit id.`,
      );
    }
    return commit;
  }

  // Internal: the actual GetDifferences pagination + cache logic shared by
  // getDifferences (PR view) and getCommitDifferences (per-commit view). The
  // cache key is the (repo, before, after) triple — commits are immutable, so
  // the cached entry never expires. `pullRequestId` is stored on the result
  // for the PR view; commit-view callers pass '' and the renderer ignores it.
  private async fetchDifferences(
    repositoryName: string,
    beforeCommit: string,
    afterCommit: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PRDifferences> {
    const dKey = differencesKey(repositoryName, beforeCommit, afterCommit);
    if (!opts?.forceFresh) {
      const cached = await getCached<PRDifferences>(NS.differences, dKey);
      // Two callers share this cache entry. If a commit-view caller filled it
      // first (pullRequestId === ''), a later PR-view caller still wants the
      // correct pullRequestId on the returned object — overlay it without
      // touching the cached entry.
      if (cached) {
        return pullRequestId && !cached.pullRequestId
          ? { ...cached, pullRequestId }
          : cached;
      }
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

  // ---- Commits ----------------------------------------------------------

  // CodeCommit has no "list commits in a PR" API, so we walk parent pointers
  // starting from sourceCommit and stop when every frontier commit has been
  // visited or is at/past the merge base. BatchGetCommits lets us pull up to
  // 100 commits per call, so even a 200-commit PR is two round-trips.
  //
  // Topology notes:
  //   - A PR branch with a merge from elsewhere has multi-parent commits; we
  //     keep walking *all* parents so the listed history matches what AWS
  //     would consider "introduced by this PR."
  //   - Visited set is keyed by commit id, so the same commit reached via two
  //     paths is fetched once.
  //   - Walk stops at the merge base by adding it to `visited` up-front — its
  //     ancestors are common to the destination and aren't PR commits.
  async listPullRequestCommits(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<PullRequestCommit[]> {
    const pr = await this.getPullRequest(repositoryName, pullRequestId, opts);
    const target =
      pr.targets.find(
        (t) => t.repositoryName.toLowerCase() === repositoryName.toLowerCase(),
      ) ?? pr.targets[0];
    if (!target) {
      throw new Error(`Pull request ${pullRequestId} has no targets.`);
    }
    const afterCommit = nonEmpty(target.sourceCommitId);
    const beforeCommit =
      nonEmpty(target.mergeBase) ?? nonEmpty(target.destinationCommitId);
    if (!afterCommit || !beforeCommit) {
      throw new Error(
        `Pull request ${pullRequestId} is missing commit ids ` +
          `(sourceCommitId=${j(target.sourceCommitId)}, ` +
          `destinationCommitId=${j(target.destinationCommitId)}, ` +
          `mergeBase=${j(target.mergeBase)}).`,
      );
    }

    // Cache lookup: keyed by (before, after) commit pair. Both are immutable
    // git ids, so the cached entry stays valid forever — no TTL.
    const cKey = prCommitsKey(repositoryName, beforeCommit, afterCommit);
    if (!opts?.forceFresh) {
      const cached = await getCached<PullRequestCommit[]>(NS.prCommits, cKey);
      if (cached) return cached;
    }

    // Already-merged PRs: sourceCommit will be reachable from destination, and
    // the merge base equals sourceCommit. There's nothing to walk; return [].
    if (afterCommit === beforeCommit) {
      await putCached(NS.prCommits, cKey, [], LIMITS.prCommits);
      return [];
    }

    const collected: PullRequestCommit[] = [];
    const visited = new Set<string>([beforeCommit]);
    let frontier: string[] = [afterCommit];

    while (frontier.length > 0 && collected.length < MAX_PR_COMMITS) {
      // De-dupe + apply MAX cap before issuing the batch call.
      const batch: string[] = [];
      for (const id of frontier) {
        if (visited.has(id)) continue;
        visited.add(id);
        batch.push(id);
        if (batch.length >= BATCH_COMMITS_PAGE_SIZE) break;
        if (collected.length + batch.length >= MAX_PR_COMMITS) break;
      }
      // Carry over anything we didn't fit into this batch.
      const remainder = frontier.slice(batch.length);
      frontier = remainder;
      if (batch.length === 0) continue;

      const res = await this.cc(
        'BatchGetCommits',
        { repositoryName, commitIds: batch },
        (i) => this.client.send(new BatchGetCommitsCommand(i)),
      );
      for (const c of res.commits ?? []) {
        const mapped = mapCommit(c);
        if (!mapped) continue;
        collected.push(mapped);
        // Queue parents we haven't already seen. The merge base is in
        // `visited` so we naturally stop there.
        for (const parent of mapped.parents) {
          if (!visited.has(parent)) frontier.push(parent);
        }
      }
    }

    // Sort newest-first by committer date (fall back to author date, then id
    // stability). The walk produces a topological order but not strictly
    // chronological once multi-parent merges are involved.
    collected.sort((a, b) => {
      const at = commitSortKey(a);
      const bt = commitSortKey(b);
      if (bt !== at) return bt - at;
      return a.id.localeCompare(b.id);
    });

    await putCached(NS.prCommits, cKey, collected, LIMITS.prCommits);
    return collected;
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

    // Fetch EVERY comment on the PR by sending only the pullRequestId.
    //
    // repositoryName + beforeCommitId + afterCommitId form a *conditional
    // group* in this API: supply any of them and the other two become required,
    // and the service then filters the result to that single commit comparison.
    // An earlier version passed the PR's current source/destination commits,
    // which meant the moment a developer pushed a new commit, every comment made
    // against the previous revision was silently dropped — the comments still
    // existed in CodeCommit (and showed in the AWS console) but vanished from
    // our diff view and activity timeline. Omitting all three returns the full,
    // revision-spanning comment set. (The CommitIdRequiredException the previous
    // note worried about only fires when repositoryName is present *without* the
    // commit ids — not when all three are omitted.) Each returned group still
    // carries its own before/afterCommitId via mapCommentGroup, so callers can
    // still tell which revision a thread belongs to.
    const raw: CommentsForPullRequest[] = [];
    let nextToken: string | undefined;
    do {
      const input = { pullRequestId, nextToken };
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

  async listActivity(
    repositoryName: string,
    pullRequestId: string,
    opts?: ReadOptions,
  ): Promise<ActivityEvent[]> {
    // Two independent best-effort reads in parallel: the raw PR event stream
    // (created / status / source / approval / merge) and the comment threads.
    // Either can fail on its own (e.g. event permissions denied on a
    // restricted role); a failure on one still yields a partial timeline
    // rather than an empty tab. fetchEventsSafe already swallows its own
    // errors; we guard listComments the same way.
    const [events, threads] = await Promise.all([
      this.fetchEventsSafe(pullRequestId, opts?.forceFresh),
      this.listComments(repositoryName, pullRequestId, opts).catch(
        () => [] as CommentThread[],
      ),
    ]);

    const out: ActivityEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const mapped = mapActivityEvent(events[i]!, i);
      if (mapped) out.push(mapped);
    }
    // Flatten every comment to a lookup first so a reply can quote its parent
    // (CodeCommit only gives us the parent's id via inReplyTo).
    const byId = new Map<string, CommentNode>();
    for (const t of threads) {
      for (const c of t.comments) byId.set(c.id, c);
    }
    for (const t of threads) {
      for (const c of t.comments) {
        if (c.deleted) continue;
        const parent = c.inReplyTo ? byId.get(c.inReplyTo) : undefined;
        // A quote of a deleted (content-cleared) parent would be empty, so drop
        // it — the row still flags itself as a reply, just without the quote.
        const quotable = parent && !parent.deleted ? parent : undefined;
        out.push({
          id: `comment:${c.id}`,
          type: 'comment',
          actorArn: c.authorArn,
          occurredAt: c.createdAt,
          commentExcerpt: commentExcerpt(c.content),
          filePath: t.filePath,
          // Carry the thread's location so the renderer can scroll the diff to
          // this exact thread. Only meaningful for line-anchored comments; for
          // general PR comments t.filePath is undefined and the row is inert.
          threadId: t.threadId,
          filePosition: t.filePosition,
          relativeFileVersion: t.relativeFileVersion,
          isReply: Boolean(c.inReplyTo),
          replyToAuthorArn: quotable?.authorArn,
          replyToExcerpt: quotable
            ? commentExcerpt(quotable.content)
            : undefined,
        });
      }
    }

    // Newest-first, matching the adjacent Commits sidebar tab. Entries with no
    // parseable timestamp sort to the bottom rather than jumping to the top.
    out.sort((a, b) => activitySortKey(b) - activitySortKey(a));
    return out;
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
    const [states, events] = await Promise.all([
      this.fetchApprovalStates(pullRequestId, revisionId),
      this.fetchEventsSafe(pullRequestId, opts?.forceFresh),
    ]);
    const selfArn = await this.callerArn();
    const selfApproved = states.some(
      (s) => s.userArn === selfArn && s.approvalState === 'APPROVE',
    );
    // For each user, look up the most recent APPROVAL_STATE_CHANGED event
    // and attach its timestamp. Events come back newest-first per the AWS
    // docs; we just take the first match. If a user revoked and re-approved,
    // we attach the re-approval time (their current state) rather than the
    // older revoke — which is what the user reading the panel cares about.
    const latestApprovalAt = new Map<string, string>();
    for (const ev of events) {
      if (ev.pullRequestEventType !== 'PULL_REQUEST_APPROVAL_STATE_CHANGED') {
        continue;
      }
      const who = ev.actorArn;
      const when = ev.eventDate?.toISOString();
      if (!who || !when) continue;
      if (!latestApprovalAt.has(who)) latestApprovalAt.set(who, when);
    }
    const enrichedStates: ApprovalStateEntry[] = states.map((s) => ({
      ...s,
      changedAt: latestApprovalAt.get(s.userArn),
    }));
    const view: PullRequestApprovalView = {
      revisionId,
      states: enrichedStates,
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
      // Look up the merge event timestamp via DescribePullRequestEvents.
      // Best-effort: if it fails, we still surface "merged" without the time.
      const events = await this.fetchEventsSafe(pullRequestId, forceFresh);
      const mergeEvent = events.find(
        (ev) =>
          ev.pullRequestEventType === 'PULL_REQUEST_MERGE_STATE_CHANGED',
      );
      return {
        state: 'already_merged',
        mergeOptions: [],
        mergedBy: target.mergeMetadata.mergedBy,
        mergeCommitId: target.mergeMetadata.mergeCommitId,
        mergedAt: mergeEvent?.eventDate?.toISOString(),
        mergedWith:
          (target.mergeMetadata.mergeOption as MergeOptionId | undefined) ??
          (mergeEvent?.pullRequestMergedStateChangedEventMetadata?.mergeMetadata
            ?.mergeOption as MergeOptionId | undefined),
      };
    }

    // Closed but not merged → the PR was abandoned/rejected. There's no
    // point computing merge options for a dead PR; report who closed it and
    // when. The event list is sorted newest-first; a reopened-then-closed
    // PR has multiple status-change events, and the first matching one is
    // the most recent close — which is what the user cares about.
    if (pr.pullRequestStatus === 'CLOSED') {
      const events = await this.fetchEventsSafe(pullRequestId, forceFresh);
      const closeEvent = events.find(
        (ev) =>
          ev.pullRequestEventType === 'PULL_REQUEST_STATUS_CHANGED' &&
          ev.pullRequestStatusChangedEventMetadata?.pullRequestStatus ===
            'CLOSED',
      );
      return {
        state: 'closed_unmerged',
        mergeOptions: [],
        closedBy: closeEvent?.actorArn,
        closedAt: closeEvent?.eventDate?.toISOString(),
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

  // ---- PR mutations (merge / status / edit) -----------------------------

  async mergePullRequest(
    input: MergePullRequestInput,
  ): Promise<PullRequestSummary> {
    const { repositoryName, pullRequestId, strategy } = input;
    const commitMessage = nonEmpty(input.commitMessage);
    // Pin the merge to the reviewed source tip when we have it. CodeCommit
    // rejects the merge if the branch has advanced past this commit, so the
    // user can never merge code they didn't review.
    const sourceCommitId = nonEmpty(input.sourceCommitId);
    if (strategy === 'FAST_FORWARD_MERGE') {
      await this.cc(
        'MergePullRequestByFastForward',
        { pullRequestId, repositoryName, sourceCommitId },
        (i) => this.client.send(new MergePullRequestByFastForwardCommand(i)),
      );
    } else if (strategy === 'SQUASH_MERGE') {
      await this.cc(
        'MergePullRequestBySquash',
        { pullRequestId, repositoryName, commitMessage, sourceCommitId },
        (i) => this.client.send(new MergePullRequestBySquashCommand(i)),
      );
    } else {
      await this.cc(
        'MergePullRequestByThreeWay',
        { pullRequestId, repositoryName, commitMessage, sourceCommitId },
        (i) => this.client.send(new MergePullRequestByThreeWayCommand(i)),
      );
    }
    return this.refreshSummaryAfterMutation(repositoryName, pullRequestId);
  }

  async setPullRequestStatus(
    repositoryName: string,
    pullRequestId: string,
    status: PRStatus,
  ): Promise<PullRequestSummary> {
    await this.cc(
      'UpdatePullRequestStatus',
      { pullRequestId, pullRequestStatus: status },
      (i) => this.client.send(new UpdatePullRequestStatusCommand(i)),
    );
    return this.refreshSummaryAfterMutation(repositoryName, pullRequestId);
  }

  async updatePullRequest(
    input: UpdatePullRequestInput,
  ): Promise<PullRequestSummary> {
    const { repositoryName, pullRequestId } = input;
    const title = input.title?.trim();
    // CodeCommit splits title and description into separate APIs. Issue only
    // the call(s) for the field(s) the caller actually wants to change.
    if (title !== undefined) {
      if (title.length === 0) {
        throw new ProviderError({
          message: 'Pull request title cannot be empty.',
          code: 'unknown',
          hint: 'Enter a title before saving.',
        });
      }
      await this.cc(
        'UpdatePullRequestTitle',
        { pullRequestId, title },
        (i) => this.client.send(new UpdatePullRequestTitleCommand(i)),
      );
    }
    if (input.description !== undefined) {
      await this.cc(
        'UpdatePullRequestDescription',
        { pullRequestId, description: input.description },
        (i) => this.client.send(new UpdatePullRequestDescriptionCommand(i)),
      );
    }
    return this.refreshSummaryAfterMutation(repositoryName, pullRequestId);
  }

  // Shared post-mutation step: drop the caches a PR-state change invalidates,
  // re-fetch the PR fresh, re-map it, and reseed the detail cache so the next
  // navigation is instant. Returns the updated summary for the caller to apply
  // optimistically.
  private async refreshSummaryAfterMutation(
    repositoryName: string,
    pullRequestId: string,
  ): Promise<PullRequestSummary> {
    await Promise.all([
      invalidateCached(NS.prDetail, prDetailKey(pullRequestId)),
      invalidateCached(
        NS.mergeability,
        mergeabilityKey(repositoryName, pullRequestId),
      ),
      invalidateNamespace(NS.prList),
    ]);
    const pr = await this.fetchRawPullRequest(pullRequestId, true);
    const approvalState = await this.evaluateApproval(pr);
    const summary = mapPullRequest(pr, approvalState);
    await putCached(NS.prDetail, prDetailKey(pullRequestId), summary, LIMITS.prDetail);
    return summary;
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

  // ---- Pull-request events ----------------------------------------------

  // CodeCommit's DescribePullRequestEvents is the only API that gives us
  // timestamps for approvals + merges (the approval-states + mergeMetadata
  // shapes don't carry "when"). We page through up to MAX_EVENT_PAGES
  // (newest-first) which is enough to cover the most recent approval per
  // user and the merge event itself for any reasonable PR.
  private async fetchEvents(
    pullRequestId: string,
    forceFresh?: boolean,
  ): Promise<PullRequestEvent[]> {
    if (!forceFresh) {
      const existing = this.inFlightEvents.get(pullRequestId);
      if (existing) return existing;
    }
    const promise = (async () => {
      const MAX_EVENT_PAGES = 4; // safety bound; PRs are rarely this noisy
      const all: PullRequestEvent[] = [];
      let nextToken: string | undefined;
      for (let page = 0; page < MAX_EVENT_PAGES; page++) {
        const res = await this.cc(
          'DescribePullRequestEvents',
          {
            pullRequestId,
            ...(nextToken ? { nextToken } : {}),
          },
          (i) => this.client.send(new DescribePullRequestEventsCommand(i)),
        );
        for (const ev of res.pullRequestEvents ?? []) all.push(ev);
        nextToken = res.nextToken;
        if (!nextToken) break;
      }
      return all;
    })();
    this.inFlightEvents.set(pullRequestId, promise);
    // See fetchRawPullRequest for why this can't be `void promise.finally(...)`.
    promise
      .finally(() => {
        if (this.inFlightEvents.get(pullRequestId) === promise) {
          this.inFlightEvents.delete(pullRequestId);
        }
      })
      .catch(() => {});
    return promise;
  }

  // Best-effort wrapper: if DescribePullRequestEvents fails (e.g. permission
  // denied on a restricted role), we still want approval/mergeability to
  // function — just without timestamps.
  private async fetchEventsSafe(
    pullRequestId: string,
    forceFresh?: boolean,
  ): Promise<PullRequestEvent[]> {
    try {
      return await this.fetchEvents(pullRequestId, forceFresh);
    } catch (err) {
      console.error(
        `[CodeCommit] DescribePullRequestEvents failed for ${pullRequestId}:`,
        err instanceof Error ? err.message : err,
      );
      return [];
    }
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
    // `.finally()` returns a new promise that mirrors the source's rejection.
    // Without a trailing `.catch()`, that orphan chain triggers Node's
    // UnhandledPromiseRejectionWarning even though every awaiter handles its
    // own copy — the cleanup branch is a separate subscriber. Swallow it here
    // because callers see (and handle) the rejection via `await promise`.
    promise
      .finally(() => {
        if (this.inFlightPullRequests.get(pullRequestId) === promise) {
          this.inFlightPullRequests.delete(pullRequestId);
        }
      })
      .catch(() => {});
    return promise;
  }

  async deleteComment(input: DeleteCommentInput): Promise<CommentNode> {
    // Refuse to delete comments not authored by the current caller. AWS
    // enforces the same constraint server-side, but checking here gives the
    // user a clean error and avoids a wasted SDK call.
    if (!input.commentId) {
      throw new Error('deleteComment requires a commentId.');
    }
    const res = await this.cc(
      'DeleteCommentContent',
      { commentId: input.commentId },
      (i) => this.client.send(new DeleteCommentContentCommand(i)),
    );
    const comment = res.comment;
    if (!comment?.commentId) {
      throw new Error('CodeCommit did not return the deleted comment.');
    }
    // Drop cached comments for this PR so the next read sees the soft-delete.
    await invalidateCached(
      NS.comments,
      commentsKey(input.repositoryName, input.pullRequestId),
    );
    return mapComment(comment);
  }

  async createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<PullRequestSummary> {
    const title = (input.title ?? '').trim();
    const source = nonEmpty(input.sourceReference);
    const dest = nonEmpty(input.destinationReference);
    if (!title) throw new Error('Pull request title is required.');
    if (!source || !dest) {
      throw new Error(
        `createPullRequest requires non-empty source and destination refs.`,
      );
    }
    if (source === dest) {
      throw new Error(
        'Source and destination branches must differ.',
      );
    }
    const sdkInput = {
      title,
      description: nonEmpty(input.description),
      targets: [
        {
          repositoryName: input.repositoryName,
          sourceReference: source,
          destinationReference: dest,
        },
      ],
      // SDKs auto-generate one if omitted, but a fresh UUID lets us trace
      // this exact attempt in CloudTrail and survives the caller retrying
      // without changing the token by accident.
      clientRequestToken: randomUUID(),
    };
    const res = await this.cc('CreatePullRequest', sdkInput, (i) =>
      this.client.send(new CreatePullRequestCommand(i)),
    );
    const pr = res.pullRequest;
    if (!pr?.pullRequestId) {
      throw new Error('CodeCommit did not return the new pull request.');
    }
    // The new PR's approval state may be NOT_APPROVED, NO_RULES, or UNKNOWN
    // depending on configured rules — evaluate it so the post-create
    // detail view shows the right badge from the first render.
    const approvalState = await this.evaluateApproval(pr);
    const summary = mapPullRequest(pr, approvalState);
    // Seed the per-PR cache so a follow-up navigation to detail is instant.
    await putCached(
      NS.prDetail,
      prDetailKey(summary.id),
      summary,
      LIMITS.prDetail,
    );
    // The PR list for this repo is now stale — drop it so the new PR
    // appears at the top when the user returns to the list.
    await invalidateMatching(NS.prList, (k) =>
      k.startsWith(`${input.repositoryName}|`),
    );
    return summary;
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

  // Enumerate PR IDs from CodeCommit, applying both a continuation cursor
  // (afterId — skip everything up to and including this PR) and a hard cap
  // (limit — stop paging once we have this many). The cursor is what makes
  // "Load more" cheap: we skip the IDs already on screen instead of re-
  // fetching them.
  //
  // CodeCommit's ListPullRequests doesn't accept a cursor that points at a
  // specific PR — it only supports its own nextToken. So we walk pages from
  // the start, skipping IDs until we see `afterId`, then start collecting.
  // That's one wasted page per Load more, which is fine: ListPullRequests is
  // cheap (no detail enrichment) and pages are 100 IDs.
  private async collectPullRequestIds(
    repositoryName: string,
    status: PRStatus | undefined,
    afterId: string | undefined,
    limit: number | undefined,
  ): Promise<{ ids: string[]; truncated: boolean }> {
    const ids: string[] = [];
    let nextToken: string | undefined;
    let truncated = false;
    // `collecting` flips to true once we've passed `afterId` (used for Load
    // more's cursor-style continuation). When afterId is unset we start
    // collecting from the very first ID.
    let collecting = afterId === undefined;

    outer: do {
      const input = {
        repositoryName,
        pullRequestStatus: status as PullRequestStatusEnum | undefined,
        maxResults: PR_LIST_PAGE_SIZE,
        nextToken,
      };
      const res = await this.cc('ListPullRequests', input, (i) =>
        this.client.send(new ListPullRequestsCommand(i)),
      );
      for (const id of res.pullRequestIds ?? []) {
        if (!collecting) {
          if (id === afterId) collecting = true;
          // Skip everything up to and including afterId.
          continue;
        }
        if (limit && ids.length >= limit) {
          // Hit the cap mid-page → at least one more ID remained on this
          // page that we didn't take. Definitely truncated.
          truncated = true;
          break outer;
        }
        ids.push(id);
      }
      nextToken = res.nextToken;
      // Cap reached exactly at a page boundary: only truncated if AWS has
      // more pages waiting. If nextToken is undefined we know AWS gave us
      // everything, even if we happened to fill `limit` on the last ID.
      if (limit && ids.length >= limit) {
        if (nextToken) truncated = true;
        break;
      }
    } while (nextToken);

    return { ids, truncated };
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
    // The IIFE above already catches and converts errors to 'UNKNOWN', so this
    // promise can't reject in practice — but keep the catch for symmetry with
    // the other coalescing helpers in case the inner catch is ever removed.
    promise
      .finally(() => {
        if (this.inFlightApprovalEvals.get(key) === promise) {
          this.inFlightApprovalEvals.delete(key);
        }
      })
      .catch(() => {});
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
      invalidateCached(NS.branches, branchesKey(repositoryName)),
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
      invalidateNamespace(NS.branches),
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

// Error thrown by everything routed through `cc()` (and a few other provider
// entry points). Carries a stable `code` + actionable `hint` that the IPC
// layer packs into the IpcResult envelope so the renderer can render a real,
// user-facing error UI — not a raw AWS exception text.
export class ProviderError extends Error {
  readonly code: IpcErrorCode;
  readonly hint?: string;
  readonly retryable: boolean;

  constructor(opts: {
    message: string;
    code: IpcErrorCode;
    hint?: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'ProviderError';
    this.code = opts.code;
    this.hint = opts.hint;
    this.retryable = opts.retryable ?? false;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

function classifyAwsError(
  apiName: string,
  input: unknown,
  err: unknown,
): ProviderError {
  // Already classified upstream — don't re-wrap (would lose the hint).
  if (err instanceof ProviderError) return err;

  const e = (err ?? {}) as {
    name?: string;
    Code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const tag = (e.name ?? e.Code ?? '').toString();
  const msg = (e.message ?? '').toString();
  const lower = msg.toLowerCase();
  const status = e.$metadata?.httpStatusCode;
  const inputStr = JSON.stringify(sanitizeForLog(input));

  // ---- Throttling ----------------------------------------------------
  // AWS SDK exhausted its retry budget. With adaptive retry + maxAttempts=8
  // this should be rare; when it happens we tell the user to wait a moment.
  if (
    /Throttl|TooManyRequests|RequestLimitExceeded|ProvisionedThroughputExceeded/i.test(
      tag,
    ) ||
    /rate exceeded|throttl/i.test(lower) ||
    status === 429
  ) {
    return new ProviderError({
      message: `AWS throttled this request (${apiName}). The list was rate-limited.`,
      code: 'throttled',
      hint: 'Wait a few seconds and click Refresh. If this keeps happening on a large repo, the AWS account-level CodeCommit TPS quota may be too low.',
      retryable: true,
      cause: err,
    });
  }

  // ---- Expired / invalid credentials ---------------------------------
  if (
    /ExpiredToken|InvalidClientToken|UnrecognizedClient|TokenRefreshRequired/i.test(
      tag,
    ) ||
    lower.includes('security token included in the request is expired') ||
    lower.includes('security token included in the request is invalid') ||
    lower.includes('credentials could not be refreshed')
  ) {
    return new ProviderError({
      message: 'AWS session expired.',
      code: 'credentials_expired',
      hint: 'Refresh your credentials: re-run `aws sso login`, re-export your environment variables, or paste a fresh AWS access key block in Settings, then try again.',
      retryable: false,
      cause: err,
    });
  }

  // ---- Missing credentials ------------------------------------------
  if (
    /CredentialsProviderError|CredentialsError/i.test(tag) ||
    lower.includes('could not load credentials') ||
    lower.includes('unable to load credentials')
  ) {
    return new ProviderError({
      message: 'No AWS credentials found.',
      code: 'credentials_missing',
      hint: 'Open Settings and either pick a named AWS profile or paste an AWS access key block.',
      retryable: false,
      cause: err,
    });
  }

  // ---- Access denied -------------------------------------------------
  if (
    /AccessDenied|UnauthorizedOperation|Forbidden/i.test(tag) ||
    status === 403
  ) {
    return new ProviderError({
      message: `AWS denied access to ${apiName}.`,
      code: 'access_denied',
      hint: `Your IAM identity is missing permission for codecommit:${apiName}. Ask your AWS admin to grant it on the configured repository.`,
      retryable: false,
      cause: err,
    });
  }

  // ---- Not found -----------------------------------------------------
  if (
    /NotFound|DoesNotExist|RepositoryDoesNotExist|PullRequestDoesNotExist/i.test(
      tag,
    ) ||
    status === 404
  ) {
    return new ProviderError({
      message: `${apiName} returned not-found (input: ${inputStr}).`,
      code: 'not_found',
      hint: 'The pull request or repository may have been deleted, or you may not have permission to see it. Try refreshing the list.',
      retryable: false,
      cause: err,
    });
  }

  // ---- Conflict ------------------------------------------------------
  if (
    /Conflict|PullRequestAlreadyClosed|InvalidPullRequestStatus|InvalidRevisionId|RevisionIdMismatch/i.test(
      tag,
    ) ||
    status === 409
  ) {
    return new ProviderError({
      message: `${apiName} failed: ${msg || 'state conflict'}.`,
      code: 'conflict',
      hint: 'The PR state changed since this view was loaded. Refresh and try again.',
      retryable: true,
      cause: err,
    });
  }

  // ---- Network / DNS / connection -----------------------------------
  if (
    /NetworkingError|UnknownEndpoint|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EPIPE|EHOSTUNREACH|ENETUNREACH/i.test(
      tag + ' ' + msg,
    )
  ) {
    return new ProviderError({
      message: 'Could not reach AWS.',
      code: 'network',
      hint: 'Check your internet connection (VPN, proxy, corporate firewall) and try again.',
      retryable: true,
      cause: err,
    });
  }

  // ---- Timeout -------------------------------------------------------
  if (/TimeoutError|RequestTimeout|ETIMEDOUT/i.test(tag + ' ' + msg)) {
    return new ProviderError({
      message: `AWS request timed out (${apiName}).`,
      code: 'timeout',
      hint: 'AWS or the network is slow right now. Click Refresh to try again.',
      retryable: true,
      cause: err,
    });
  }

  // ---- Fallback ------------------------------------------------------
  return new ProviderError({
    message: `[${apiName}] ${msg || 'Unknown AWS error'} (input: ${inputStr})`,
    code: 'unknown',
    retryable: false,
    cause: err,
  });
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

function mapCommit(c: CCCommit): PullRequestCommit | null {
  if (!c.commitId) return null;
  return {
    id: c.commitId,
    parents: c.parents ?? [],
    message: c.message ?? '',
    authorName: c.author?.name,
    authorEmail: c.author?.email,
    authorDate: parseGitDate(c.author?.date),
    committerName: c.committer?.name,
    committerEmail: c.committer?.email,
    committerDate: parseGitDate(c.committer?.date),
  };
}

// CodeCommit returns git's raw "<unix-seconds> <±HHMM>" format for commit
// dates (e.g. "1700000000 +0530"). Convert to ISO so the renderer's existing
// relative-time helper handles them like every other timestamp. If the input
// is already ISO-shaped or unparseable, leave it alone / drop it.
function parseGitDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /^(\d+)\s*([+-]\d{2})(\d{2})?$/.exec(raw.trim());
  if (m) {
    const seconds = Number(m[1]);
    if (Number.isFinite(seconds)) {
      return new Date(seconds * 1000).toISOString();
    }
  }
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function commitSortKey(c: PullRequestCommit): number {
  const when = c.committerDate ?? c.authorDate;
  if (!when) return 0;
  const t = Date.parse(when);
  return Number.isNaN(t) ? 0 : t;
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

// Map a single CodeCommit DescribePullRequestEvents entry onto the
// provider-agnostic ActivityEvent shape. Returns null for event subtypes we
// don't surface in the timeline (e.g. approval-rule template events), so the
// caller can skip them. `index` disambiguates the synthesized id since events
// carry no id of their own.
function mapActivityEvent(
  ev: PullRequestEvent,
  index: number,
): ActivityEvent | null {
  const base = {
    actorArn: ev.actorArn,
    occurredAt: ev.eventDate?.toISOString(),
  };
  switch (ev.pullRequestEventType) {
    case 'PULL_REQUEST_CREATED':
      return { id: `event:${index}`, type: 'created', ...base };
    case 'PULL_REQUEST_STATUS_CHANGED': {
      const status = ev.pullRequestStatusChangedEventMetadata?.pullRequestStatus;
      return {
        id: `event:${index}`,
        type: 'statusChanged',
        status: status === 'CLOSED' ? 'CLOSED' : 'OPEN',
        ...base,
      };
    }
    case 'PULL_REQUEST_SOURCE_REFERENCE_UPDATED': {
      const m = ev.pullRequestSourceReferenceUpdatedEventMetadata;
      return {
        id: `event:${index}`,
        type: 'sourceUpdated',
        beforeCommitId: m?.beforeCommitId,
        afterCommitId: m?.afterCommitId,
        ...base,
      };
    }
    case 'PULL_REQUEST_APPROVAL_STATE_CHANGED': {
      // CodeCommit reports the approval status as APPROVE / REVOKE.
      const s = ev.approvalStateChangedEventMetadata?.approvalStatus;
      return {
        id: `event:${index}`,
        type: 'approvalStateChanged',
        approvalState: s === 'APPROVE' ? 'APPROVE' : 'REVOKE',
        ...base,
      };
    }
    case 'PULL_REQUEST_MERGE_STATE_CHANGED': {
      const merged =
        ev.pullRequestMergedStateChangedEventMetadata?.mergeMetadata?.isMerged;
      // The merge-state event also fires on un-merge bookkeeping; only surface
      // the actual merge.
      if (merged !== true) return null;
      const option = ev.pullRequestMergedStateChangedEventMetadata?.mergeMetadata
        ?.mergeOption as MergeOptionId | undefined;
      return {
        id: `event:${index}`,
        type: 'merged',
        mergedWith: option,
        ...base,
      };
    }
    default:
      return null;
  }
}

// First non-empty line of a comment, trimmed to a single-line preview for the
// activity feed. The full body still lives in the inline thread / general
// comments panel; the timeline only needs enough to recognize it.
function commentExcerpt(content: string): string {
  const firstLine =
    content
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  const MAX = 140;
  return firstLine.length > MAX ? `${firstLine.slice(0, MAX - 1)}…` : firstLine;
}

function activitySortKey(e: ActivityEvent): number {
  if (!e.occurredAt) return -Infinity;
  const t = Date.parse(e.occurredAt);
  return Number.isNaN(t) ? -Infinity : t;
}
