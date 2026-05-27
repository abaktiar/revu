import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApprovalAction,
  CommentDraft,
  CommentThread,
  FileDiffEntry,
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
  const [postingThreadId, setPostingThreadId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      .catch((err: Error) => {
        if (cancelled) return;
        setLoadError(err.message);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repositoryName, pullRequest.id, refreshToken]);

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
      setLoadError(err instanceof Error ? err.message : String(err));
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
        setLoadError(err instanceof Error ? err.message : String(err));
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
    };
  }, [
    differences,
    pullRequest.id,
    repositoryName,
    postingThreadId,
  ]);

  const callbacks: DiffCallbacks = useMemo(
    () => ({
      onPostComment: postComment,
      onPostReply: postReply,
      onSaveDraft: saveDraft,
      onDeleteDraft: deleteDraft,
      onToggleReviewed: toggleReviewedSync,
    }),
    [postComment, postReply, saveDraft, deleteDraft, toggleReviewedSync],
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
        setLoadError(err instanceof Error ? err.message : String(err));
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

  if (loadError) {
    return (
      <div className="pr-detail">
        <Toolbar
          pr={pullRequest}
          detail={detail}
          approval={approval}
          approvalBusy={approvalBusy}
          onApprove={() => void applyApproval('APPROVE')}
          onRevoke={() => void applyApproval('REVOKE')}
          onBack={onBack}
          generalCount={generalComments.length}
          showGeneral={showGeneral}
          onToggleGeneral={() => setShowGeneral((v) => !v)}
          metaOpen={metaOpen}
          onToggleMeta={() => setMetaOpen((v) => !v)}
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
        />
        <div className="error">
          <div>Could not load PR data.</div>
          <pre>{loadError}</pre>
          <div className="error-actions">
            <button
              className="primary"
              onClick={() => void onRefresh()}
              disabled={refreshing}
            >
              {refreshing ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!differences || !detail) {
    return (
      <div className="pr-detail">
        <Toolbar
          pr={pullRequest}
          detail={detail}
          approval={approval}
          approvalBusy={approvalBusy}
          onApprove={() => void applyApproval('APPROVE')}
          onRevoke={() => void applyApproval('REVOKE')}
          onBack={onBack}
          generalCount={generalComments.length}
          showGeneral={showGeneral}
          onToggleGeneral={() => setShowGeneral((v) => !v)}
          metaOpen={metaOpen}
          onToggleMeta={() => setMetaOpen((v) => !v)}
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
        />
        <div className="loading">Loading PR…</div>
      </div>
    );
  }

  return (
    <div className="pr-detail">
      <Toolbar
        pr={pullRequest}
        detail={detail}
        approval={approval}
        approvalBusy={approvalBusy}
        onApprove={() => void applyApproval('APPROVE')}
        onRevoke={() => void applyApproval('REVOKE')}
        onBack={onBack}
        generalCount={generalComments.length}
        showGeneral={showGeneral}
        onToggleGeneral={() => setShowGeneral((v) => !v)}
        metaOpen={metaOpen}
        onToggleMeta={() => setMetaOpen((v) => !v)}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
      />
      {metaOpen && (
        <PRMetadata
          detail={detail}
          differences={differences}
          mergeability={mergeability}
          approvalCount={
            approval?.states.filter((s) => s.approvalState === 'APPROVE').length ?? 0
          }
          fileCount={differences.files.length}
          selfApproved={approval?.selfApproved ?? false}
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
                {t.comments.map((c) => (
                  <div key={c.id} className="comment">
                    <div className="comment-head">
                      <span className="author">{shortArn(c.authorArn)}</span>
                      <span className="when">{fmt(c.createdAt)}</span>
                    </div>
                    <div className="comment-body">
                      <Markdown source={c.content} />
                    </div>
                  </div>
                ))}
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
  return (
    <div className="pr-toolbar">
      <button onClick={onBack}>← Back</button>
      <span className="pr-title">
        <span className="id">#{pr.id}</span> {pr.title}
      </span>
      {detail && (
        <>
          <span className={`badge ${detail.status}`}>{detail.status}</span>
          <span className={`badge ${detail.approvalState}`}>
            {detail.approvalState.replace('_', ' ')}
          </span>
        </>
      )}
      {approval && (
        <span className="hint">
          {approvedCount} approval{approvedCount === 1 ? '' : 's'}
        </span>
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
