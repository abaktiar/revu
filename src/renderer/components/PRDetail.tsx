import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApprovalAction,
  CommentDraft,
  CommentThread,
  FileDiffEntry,
  MergeabilityState,
  PostCommentInput,
  PRDifferences,
  PullRequestApprovalView,
  PullRequestDetail,
  PullRequestMergeability,
  PullRequestSummary,
  RelativeFileVersion,
  ReviewedFile,
} from '@shared/types';
import { api, unwrap } from '../api';
import { FileSidebar } from './FileSidebar';
import {
  ContinuousDiff,
  type ContinuousDiffHandle,
} from './ContinuousDiff/ContinuousDiff';
import type {
  DiffCallbacks,
  DiffContext,
} from './ContinuousDiff/types';
import { PRMetadata } from './PRMetadata';
import { Markdown } from './Markdown';
import { ErrorBanner } from './ErrorBanner';

interface Props {
  repositoryName: string;
  pullRequest: PullRequestSummary;
  onBack: () => void;
}

export function PRDetail({
  repositoryName,
  pullRequest,
  onBack,
}: Props): JSX.Element {
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [differences, setDifferences] = useState<PRDifferences | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [drafts, setDrafts] = useState<CommentDraft[]>([]);
  const [reviewed, setReviewed] = useState<ReviewedFile[]>([]);
  const [approval, setApproval] = useState<PullRequestApprovalView | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [mergeability, setMergeability] =
    useState<PullRequestMergeability | null>(null);
  const [metaOpen, setMetaOpen] = useState(true);
  const [webUrl, setWebUrl] = useState<string | undefined>(undefined);
  const [postingThreadId, setPostingThreadId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [showGeneral, setShowGeneral] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const diffRef = useRef<ContinuousDiffHandle | null>(null);

  // ---- Load PR data ---------------------------------------------------
  // `refreshToken` bumps when the user hits the Refresh button; the
  // pre-effect side-effect (cache invalidate) runs in onRefresh below, so by
  // the time this effect re-runs every read goes straight to AWS.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setDifferences(null);
    setActiveFile(null);

    const forceFresh = refreshToken > 0;
    const opts = forceFresh ? { forceFresh: true } : undefined;

    Promise.all([
      unwrap(api.prs.get(repositoryName, pullRequest.id, opts)),
      unwrap(api.prs.differences(repositoryName, pullRequest.id, opts)),
      unwrap(api.comments.list(repositoryName, pullRequest.id, opts)),
      unwrap(api.drafts.list(pullRequest.id)),
      unwrap(api.reviewed.list(pullRequest.id)),
      unwrap(api.approval.get(repositoryName, pullRequest.id, opts)).catch(
        () => null,
      ),
      unwrap(api.mergeability.get(repositoryName, pullRequest.id, opts)).catch(
        () => null,
      ),
    ])
      .then(([d, diff, th, dr, rv, app, merge]) => {
        if (cancelled) return;
        setDetail(d);
        setDifferences(diff);
        setThreads(th);
        setDrafts(dr);
        setReviewed(rv);
        setApproval(app);
        setMergeability(merge);
        setRefreshing(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repositoryName, pullRequest.id, refreshToken]);

  // Resolve the provider's deep-link to the PR's web UI (AWS Console for the
  // CodeCommit provider). Region is held by the provider, so we just ask. If
  // it returns undefined (no region configured), we just won't render the link.
  useEffect(() => {
    let cancelled = false;
    unwrap(api.prs.webUrl(repositoryName, pullRequest.id))
      .then((u) => {
        if (!cancelled) setWebUrl(u);
      })
      .catch(() => {
        if (!cancelled) setWebUrl(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryName, pullRequest.id]);

  // Hard refresh: drop every cached entry tied to this PR (and the in-memory
  // blob cache, since file diffs are keyed by blob IDs and we want truly
  // everything re-read on a user-driven refresh) and re-run the load effect.
  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await unwrap(api.cache.invalidatePr(repositoryName, pullRequest.id));
    } catch (err) {
      // Cache invalidate is best-effort. If it fails (extremely unlikely), we
      // still bump the refresh token below so reads pass forceFresh=true.
      console.error('[refresh] cache invalidate failed:', err);
    }
    setRefreshToken((n) => n + 1);
  }, [repositoryName, pullRequest.id]);

  // ---- Derived state --------------------------------------------------
  const commentCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of threads) {
      if (!t.filePath) continue;
      out[t.filePath] = (out[t.filePath] ?? 0) + t.comments.length;
    }
    return out;
  }, [threads]);

  const reviewedPaths = useMemo(() => {
    if (!differences) return new Set<string>();
    const current = differences.afterCommitId;
    return new Set(
      reviewed
        .filter((r) => r.reviewedAtAfterCommit === current)
        .map((r) => r.filePath),
    );
  }, [reviewed, differences]);

  const generalComments = useMemo(
    () => threads.filter((t) => !t.filePath),
    [threads],
  );

  // ---- Mutation handlers ---------------------------------------------
  const refreshThreads = useCallback(async (): Promise<void> => {
    try {
      const fresh = await unwrap(
        api.comments.list(repositoryName, pullRequest.id),
      );
      setThreads(fresh);
    } catch (err) {
      setLoadError(err);
    }
  }, [repositoryName, pullRequest.id]);

  const postComment = useCallback(
    async (input: PostCommentInput): Promise<void> => {
      setPostingThreadId('__composer__');
      try {
        await unwrap(api.comments.post(input));
        await refreshThreads();
      } finally {
        setPostingThreadId(null);
      }
    },
    [refreshThreads],
  );

  const postReply = useCallback(
    async (threadId: string, content: string): Promise<void> => {
      setPostingThreadId(threadId);
      try {
        await unwrap(api.comments.reply({ inReplyTo: threadId, content }));
        await refreshThreads();
      } finally {
        setPostingThreadId(null);
      }
    },
    [refreshThreads],
  );

  const saveDraft = useCallback(
    async (input: {
      id?: string;
      filePath: string;
      filePosition: number;
      relativeFileVersion: RelativeFileVersion;
      content: string;
    }): Promise<void> => {
      const saved = await unwrap(
        api.drafts.save({
          ...input,
          pullRequestId: pullRequest.id,
          repositoryName,
        }),
      );
      setDrafts((cur) => {
        const idx = cur.findIndex((d) => d.id === saved.id);
        if (idx >= 0) {
          const next = [...cur];
          next[idx] = saved;
          return next;
        }
        return [...cur, saved];
      });
    },
    [pullRequest.id, repositoryName],
  );

  const deleteDraft = useCallback(async (id: string): Promise<void> => {
    await unwrap(api.drafts.delete(id));
    setDrafts((cur) => cur.filter((d) => d.id !== id));
  }, []);

  // Soft-delete a posted CodeCommit comment. Done via the provider — AWS
  // requires the caller be the author. We optimistically update the local
  // thread list so the UI reflects the soft-delete immediately, then refresh
  // from the server to pick up any contention with concurrent edits.
  const deleteComment = useCallback(
    async (commentId: string): Promise<void> => {
      const confirmed = window.confirm(
        'Delete this comment? This clears the content on AWS but keeps the comment in the thread.',
      );
      if (!confirmed) return;
      setThreads((cur) =>
        cur.map((t) => ({
          ...t,
          comments: t.comments.map((c) =>
            c.id === commentId ? { ...c, deleted: true, content: '' } : c,
          ),
        })),
      );
      try {
        await unwrap(
          api.comments.delete({
            commentId,
            pullRequestId: pullRequest.id,
            repositoryName,
          }),
        );
      } catch (err) {
        // Roll back the optimistic update by re-fetching the truth.
        setLoadError(err);
      } finally {
        await refreshThreads();
      }
    },
    [pullRequest.id, repositoryName, refreshThreads],
  );

  const toggleReviewed = useCallback(
    async (file: FileDiffEntry, next: boolean): Promise<void> => {
      if (!differences) return;
      try {
        const entry = await unwrap(
          api.reviewed.toggle(
            pullRequest.id,
            file.path,
            differences.afterCommitId,
            next,
          ),
        );
        setReviewed((cur) => {
          const filtered = cur.filter((r) => r.filePath !== file.path);
          return entry ? [...filtered, entry] : filtered;
        });
      } catch (err) {
        setLoadError(err);
      }
    },
    [differences, pullRequest.id],
  );

  // Fire-and-forget wrapper used in `callbacks` below so we have a stable
  // reference (the inline `(f, next) => void toggleReviewed(...)` we used to
  // build inside the JSX was a new function every render — which busted any
  // attempt to memoize FileDiffSection).
  const toggleReviewedSync = useCallback(
    (file: FileDiffEntry, next: boolean): void => {
      void toggleReviewed(file, next);
    },
    [toggleReviewed],
  );

  // ---- Stable props for ContinuousDiff -------------------------------
  // These objects used to be built inline in the JSX, so every PRDetail render
  // (including every scroll-driven setActiveFile) produced new `ctx` /
  // `callbacks` references. With FileDiffSection now memoized, prop identity
  // matters — recomputing these only when their inputs actually change is what
  // lets the file sections skip re-rendering during scroll.
  const ctx: DiffContext | null = useMemo(() => {
    if (!differences) return null;
    return {
      pullRequestId: pullRequest.id,
      repositoryName,
      beforeCommitId: differences.beforeCommitId,
      afterCommitId: differences.afterCommitId,
      postingThreadId,
      selfArn: approval?.selfArn,
    };
  }, [
    differences,
    pullRequest.id,
    repositoryName,
    postingThreadId,
    approval?.selfArn,
  ]);

  const callbacks: DiffCallbacks = useMemo(
    () => ({
      onPostComment: postComment,
      onPostReply: postReply,
      onSaveDraft: saveDraft,
      onDeleteDraft: deleteDraft,
      onDeleteComment: deleteComment,
      onToggleReviewed: toggleReviewedSync,
    }),
    [
      postComment,
      postReply,
      saveDraft,
      deleteDraft,
      deleteComment,
      toggleReviewedSync,
    ],
  );

  const onActiveFileChange = useCallback((path: string | null): void => {
    setActiveFile(path);
  }, []);

  const onSidebarSelect = useCallback((file: FileDiffEntry): void => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    diffRef.current?.scrollToFile(file.path, {
      behavior: reduced ? 'auto' : 'smooth',
      block: 'start',
    });
  }, []);

  const applyApproval = useCallback(
    async (action: ApprovalAction): Promise<void> => {
      setApprovalBusy(true);
      try {
        const next = await unwrap(
          api.approval.update(repositoryName, pullRequest.id, action),
        );
        setApproval(next);
        const fresh = await unwrap(api.prs.get(repositoryName, pullRequest.id));
        setDetail(fresh);
      } catch (err) {
        setLoadError(err);
      } finally {
        setApprovalBusy(false);
      }
    },
    [repositoryName, pullRequest.id],
  );

  // ---- Keyboard navigation -------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'j') {
        e.preventDefault();
        diffRef.current?.scrollToFileBy(1);
      } else if (e.key === 'k') {
        e.preventDefault();
        diffRef.current?.scrollToFileBy(-1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toolbarProps = {
    pr: pullRequest,
    detail,
    approval,
    mergeability,
    approvalBusy,
    onApprove: () => void applyApproval('APPROVE'),
    onRevoke: () => void applyApproval('REVOKE'),
    onBack,
    generalCount: generalComments.length,
    showGeneral,
    onToggleGeneral: () => setShowGeneral((v) => !v),
    metaOpen,
    onToggleMeta: () => setMetaOpen((v) => !v),
    refreshing,
    onRefresh: () => void onRefresh(),
  };

  if (loadError) {
    return (
      <div className="pr-detail">
        <Toolbar {...toolbarProps} />
        <ErrorBanner
          title="Could not load PR data."
          error={loadError}
          onRetry={() => void onRefresh()}
          retryLabel="Retry"
          retrying={refreshing}
        />
      </div>
    );
  }

  if (!differences || !detail) {
    return (
      <div className="pr-detail">
        <Toolbar {...toolbarProps} />
        <div className="loading">Loading PR…</div>
      </div>
    );
  }

  return (
    <div className="pr-detail">
      <Toolbar {...toolbarProps} />
      {metaOpen && (
        <PRMetadata
          detail={detail}
          differences={differences}
          mergeability={mergeability}
          approval={approval}
          approvalCount={
            approval?.states.filter((s) => s.approvalState === 'APPROVE').length ?? 0
          }
          fileCount={differences.files.length}
          selfApproved={approval?.selfApproved ?? false}
          webUrl={webUrl}
        />
      )}
      <div className="pr-body">
        <FileSidebar
          files={differences.files}
          selectedPath={activeFile ?? undefined}
          commentCounts={commentCounts}
          reviewedPaths={reviewedPaths}
          onSelect={onSidebarSelect}
          onToggleReviewed={toggleReviewedSync}
        />
        <div className="diff-area">
          {differences.files.length === 0 || !ctx ? (
            <div className="empty">No files changed.</div>
          ) : (
            <ContinuousDiff
              ref={diffRef}
              files={differences.files}
              threads={threads}
              drafts={drafts}
              reviewedPaths={reviewedPaths}
              ctx={ctx}
              callbacks={callbacks}
              onActiveFileChange={onActiveFileChange}
            />
          )}
        </div>
        {showGeneral && generalComments.length > 0 && (
          <aside className="general-comments">
            <div className="general-head">
              <h3>General comments ({generalComments.length})</h3>
              <button onClick={() => setShowGeneral(false)}>×</button>
            </div>
            {generalComments.map((t) => (
              <div key={t.threadId} className="thread thread-flat">
                {t.comments.map((c) => {
                  const canDelete =
                    !!approval?.selfArn &&
                    !c.deleted &&
                    c.authorArn === approval.selfArn;
                  return (
                    <div
                      key={c.id}
                      className={`comment${c.deleted ? ' deleted' : ''}`}
                    >
                      <div className="comment-head">
                        <span className="author">{shortArn(c.authorArn)}</span>
                        <span className="when">{fmt(c.createdAt)}</span>
                        {canDelete && (
                          <>
                            <span className="grow" />
                            <button
                              type="button"
                              className="comment-delete"
                              onClick={() => void deleteComment(c.id)}
                              aria-label="Delete this comment"
                              title="Delete this comment"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                      <div className="comment-body">
                        {c.deleted ? (
                          <i>(deleted)</i>
                        ) : (
                          <Markdown source={c.content} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

function Toolbar({
  pr,
  detail,
  approval,
  mergeability,
  approvalBusy,
  onApprove,
  onRevoke,
  onBack,
  generalCount,
  showGeneral,
  onToggleGeneral,
  metaOpen,
  onToggleMeta,
  refreshing,
  onRefresh,
}: {
  pr: PullRequestSummary;
  detail: PullRequestDetail | null;
  approval: PullRequestApprovalView | null;
  mergeability: PullRequestMergeability | null;
  approvalBusy: boolean;
  onApprove: () => void;
  onRevoke: () => void;
  onBack: () => void;
  generalCount: number;
  showGeneral: boolean;
  onToggleGeneral: () => void;
  metaOpen: boolean;
  onToggleMeta: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}): JSX.Element {
  const approvedCount =
    approval?.states.filter((s) => s.approvalState === 'APPROVE').length ?? 0;

  // When the details panel is open it already shows status / approval /
  // mergeability badges and approval count. Showing the same chips in the
  // toolbar is just duplication. Collapse those into the toolbar ONLY when
  // the details panel is hidden, so the user still has the essentials.
  const showInlineBadges = !metaOpen;

  return (
    <div className="pr-toolbar">
      <button onClick={onBack}>← Back</button>
      <span className="pr-title">
        <span className="id">#{pr.id}</span> {pr.title}
      </span>
      {showInlineBadges && detail && (
        <>
          <span className={`badge ${detail.status}`}>{detail.status}</span>
          {mergeability && <ToolbarMergeBadge m={mergeability} />}
          <span className={`badge ${detail.approvalState}`}>
            {detail.approvalState.replace('_', ' ')}
          </span>
          {approval && (
            <span className="hint">
              {approvedCount} approval{approvedCount === 1 ? '' : 's'}
            </span>
          )}
        </>
      )}
      <span className="grow" />
      <button
        onClick={onRefresh}
        disabled={refreshing}
        title="Bypass local cache and re-fetch this PR from AWS"
      >
        {refreshing ? 'Refreshing…' : '↻ Refresh'}
      </button>
      <button onClick={onToggleMeta}>
        {metaOpen ? 'Hide details' : 'Show details'}
      </button>
      {generalCount > 0 && (
        <button onClick={onToggleGeneral}>
          {showGeneral ? 'Hide' : 'Show'} general comments ({generalCount})
        </button>
      )}
      {approval &&
        (approval.selfApproved ? (
          <button onClick={onRevoke} disabled={approvalBusy}>
            {approvalBusy ? 'Revoking…' : 'Revoke approval'}
          </button>
        ) : (
          <button className="primary" onClick={onApprove} disabled={approvalBusy}>
            {approvalBusy ? 'Approving…' : 'Approve'}
          </button>
        ))}
    </div>
  );
}

// Compact mergeability badge for the toolbar. Mirrors PRMetadata's badge but
// without the long tooltip strings — the details panel owns the rich version.
function ToolbarMergeBadge({
  m,
}: {
  m: PullRequestMergeability;
}): JSX.Element | null {
  // Closed-without-merge: the parent already renders the "CLOSED" status
  // badge. A second badge here would just repeat the information.
  if (m.state === 'closed_unmerged') return null;
  const cls: Record<Exclude<MergeabilityState, 'closed_unmerged'>, string> = {
    already_merged: 'MERGED',
    mergeable: 'APPROVED',
    has_conflicts: 'NOT_APPROVED',
    unknown: 'UNKNOWN',
  };
  const label: Record<Exclude<MergeabilityState, 'closed_unmerged'>, string> = {
    already_merged: 'MERGED',
    mergeable: 'MERGEABLE',
    has_conflicts: 'CONFLICTS',
    unknown: 'UNKNOWN',
  };
  return (
    <span className={`badge ${cls[m.state]}`} title={mergeTooltip(m)}>
      {label[m.state]}
      {m.state === 'has_conflicts' && m.conflictCount
        ? ` (${m.conflictCount})`
        : ''}
    </span>
  );
}

function mergeTooltip(m: PullRequestMergeability): string {
  switch (m.state) {
    case 'already_merged':
      return m.mergedBy ? `Merged by ${shortArn(m.mergedBy)}` : 'Merged';
    case 'mergeable':
      return `Mergeable via: ${m.mergeOptions.join(', ') || '?'}`;
    case 'has_conflicts':
      return m.reason ?? 'Manual merge required';
    case 'unknown':
    default:
      return m.reason ?? "Mergeability couldn't be determined";
  }
}

function shortArn(arn: string | undefined): string {
  if (!arn) return 'unknown';
  const i = arn.lastIndexOf('/');
  return i >= 0 ? arn.slice(i + 1) : arn;
}

function fmt(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}
