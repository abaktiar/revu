import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityEvent,
  ApprovalAction,
  ChecklistItem,
  CommentDraft,
  CommentNode,
  CommentThread,
  FileDiffEntry,
  MergeabilityState,
  MergeOptionId,
  PostCommentInput,
  PRDifferences,
  PRStatus,
  PullRequestApprovalView,
  PullRequestCommit,
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
  DiffSearchMatch,
} from './ContinuousDiff/types';
import { PRMetadata } from './PRMetadata';
import { Markdown } from './Markdown';
import { CommentReactions, normalizeReaction } from './CommentReactions';
import {
  RESOLVE_MARKER,
  REOPEN_MARKER,
  isResolutionMarkerEvent,
} from './threadResolution';
import { ErrorBanner } from './ErrorBanner';
import { MergeDialog, EditPRDialog, ChecklistApproveModal } from './PRDialogs';
import { FileFinder } from './FileFinder';
import type { SidebarTab } from './FileSidebar';
import {
  ArrowLeft,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  GitMerge,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  RefreshCw,
  X,
  XCircle,
} from '../icons';

// Stable empty refs used when switching to commit view so memoized children
// don't see fresh `[]` / `new Set()` references on every render.
const EMPTY_THREADS: CommentThread[] = [];
const EMPTY_DRAFTS: CommentDraft[] = [];
const EMPTY_PATHS: Set<string> = new Set();
const EMPTY_COUNTS: Record<string, number> = {};

// Optimistically apply a reaction toggle to a comment so the pill updates
// instantly; refreshThreads then reconciles with the server. CodeCommit keeps
// a single reaction per caller per comment, so setting a new one replaces the
// previous, and 'none' clears it.
function applyOptimisticReaction(c: CommentNode, value: string): CommentNode {
  const v = normalizeReaction(value);
  const counts: Record<string, number> = { ...(c.reactionCounts ?? {}) };
  const prev = normalizeReaction((c.callerReactions ?? [])[0] ?? '');
  if (prev && counts[prev]) {
    const n = counts[prev] - 1;
    if (n > 0) counts[prev] = n;
    else delete counts[prev];
  }
  if (!v || v === 'none') {
    return { ...c, reactionCounts: counts, callerReactions: [] };
  }
  counts[v] = (counts[v] ?? 0) + 1;
  return { ...c, reactionCounts: counts, callerReactions: [v] };
}

interface Props {
  repositoryName: string;
  pullRequest: PullRequestSummary;
  onBack: () => void;
  // Notifies the parent that this PR changed (approve/revoke, merge,
  // close/reopen, edit, comment) so the list can refresh itself on return.
  // Optional so PRDetail stays usable without a list behind it.
  onMutated?: () => void;
}

export function PRDetail({ repositoryName, pullRequest, onBack, onMutated }: Props): JSX.Element {
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [differences, setDifferences] = useState<PRDifferences | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [drafts, setDrafts] = useState<CommentDraft[]>([]);
  const [reviewed, setReviewed] = useState<ReviewedFile[]>([]);
  const [approval, setApproval] = useState<PullRequestApprovalView | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [mergeability, setMergeability] = useState<PullRequestMergeability | null>(null);
  const [commits, setCommits] = useState<PullRequestCommit[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [metaOpen, setMetaOpen] = useState(true);
  const [webUrl, setWebUrl] = useState<string | undefined>(undefined);
  const [postingThreadId, setPostingThreadId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [showGeneral, setShowGeneral] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  // PR-mutation UI state: which action (if any) is in flight, and whether the
  // merge / edit dialogs are open.
  const [actionBusy, setActionBusy] = useState<null | 'merge' | 'status' | 'edit'>(null);
  // Errors from PR mutations (merge/close/reopen/edit). Kept separate from
  // `loadError` on purpose: a failed action must NOT replace the whole page
  // with the load-failure view (which would also unmount the open dialog).
  const [actionError, setActionError] = useState<unknown>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);
  // The repo's approval checklist (empty when none configured) and whether the
  // approve-checklist modal is open.
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [checklistApproveOpen, setChecklistApproveOpen] = useState(false);
  // In-diff find (Cmd/Ctrl+F): query, matching files, and the current index.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState<DiffSearchMatch[]>([]);
  const [findIdx, setFindIdx] = useState(0);
  // ---- View mode -----------------------------------------------------
  // Default view is the PR's full diff. Selecting a commit in the sidebar
  // switches to viewing that single commit's diff (parent → commit). The
  // selected commit is the one currently being viewed; commitDiff is the
  // PRDifferences-shaped payload for the per-commit diff and is loaded
  // lazily on selection (cached forever, keyed by commit pair).
  const [selectedCommit, setSelectedCommit] = useState<PullRequestCommit | null>(null);
  const [commitDiff, setCommitDiff] = useState<PRDifferences | null>(null);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [commitDiffError, setCommitDiffError] = useState<unknown>(null);
  // Diff topbar: "hide whitespace" recomputes diffs ignoring whitespace-only
  // changes (threaded into DiffContext → FileDiffSection → loadFileDiff).
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  // Sidebar visibility is per-session only (not persisted) — it always opens
  // showing the file list, and the toggle lives in the diff topbar.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('revu:sidebarWidth');
      if (saved != null) return parseInt(saved, 10);
    } catch {
      /* ignore */
    }
    return 320;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const diffRef = useRef<ContinuousDiffHandle | null>(null);

  // Keep the latest onMutated in a ref so mutation handlers can notify the
  // parent without taking onMutated as a dependency — its identity changes
  // every parent render, and threading it through useCallback deps would bust
  // the carefully-tuned memoization chain feeding ContinuousDiff.
  const onMutatedRef = useRef(onMutated);
  useEffect(() => {
    onMutatedRef.current = onMutated;
  }, [onMutated]);

  // Monotonic token so out-of-order reaction refetches (rapid 👍→👎) don't let
  // an earlier, stale comment list overwrite the latest one.
  const reactionNonceRef = useRef(0);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const next = Math.max(180, Math.min(startWidth + (moveEvent.clientX - startX), window.innerWidth * 0.5));
      setSidebarWidth(next);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const handle = document.querySelector('.sidebar-resize-handle');
      if (handle) handle.classList.remove('is-dragging');
      localStorage.setItem('revu:sidebarWidth', String(sidebarWidthRef.current));
    };

    const handle = document.querySelector('.sidebar-resize-handle');
    if (handle) handle.classList.add('is-dragging');

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

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

    // Progressive streaming: fire every read independently and paint each
    // region the moment its data lands, rather than blocking the whole view on
    // the slowest call (almost always `differences` — the diff computation).
    // The PR detail (title/status/branches) and the differences (sidebar +
    // diff) are the two structural loads; a hard failure on either surfaces
    // the load-error view. Everything else is best-effort and folds in late:
    // its failure degrades a region (no comments, no approval badge) instead
    // of replacing a half-streamed page with an error.
    const detailReq = unwrap(api.prs.get(repositoryName, pullRequest.id, opts));
    detailReq
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err);
      });

    const diffReq = unwrap(api.prs.differences(repositoryName, pullRequest.id, opts));
    diffReq
      .then((diff) => {
        if (!cancelled) setDifferences(diff);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err);
      });

    unwrap(api.comments.list(repositoryName, pullRequest.id, opts))
      .then((th) => {
        if (!cancelled) setThreads(th);
      })
      .catch((err: unknown) => {
        // Comments are secondary to the diff. A failure here leaves the
        // threads empty rather than blanking the page the reviewer came for.
        console.error('[pr-detail] comments load failed:', err);
      });

    unwrap(api.drafts.list(pullRequest.id))
      .then((dr) => {
        if (!cancelled) setDrafts(dr);
      })
      .catch((err: unknown) => {
        console.error('[pr-detail] drafts load failed:', err);
      });

    unwrap(api.reviewed.list(pullRequest.id))
      .then((rv) => {
        if (!cancelled) setReviewed(rv);
      })
      .catch((err: unknown) => {
        console.error('[pr-detail] reviewed-state load failed:', err);
      });

    unwrap(api.approval.get(repositoryName, pullRequest.id, opts))
      .then((app) => {
        if (!cancelled) setApproval(app);
      })
      .catch(() => {
        if (!cancelled) setApproval(null);
      });

    unwrap(api.mergeability.get(repositoryName, pullRequest.id, opts))
      .then((merge) => {
        if (!cancelled) setMergeability(merge);
      })
      .catch(() => {
        if (!cancelled) setMergeability(null);
      });

    // Commit list is informational — never block the diff view if the
    // walk fails (e.g. permission denied on BatchGetCommits).
    unwrap(api.prs.commits(repositoryName, pullRequest.id, opts))
      .then((cmts) => {
        if (!cancelled) setCommits(cmts);
      })
      .catch(() => {
        if (!cancelled) setCommits([] as PullRequestCommit[]);
      });

    // Activity timeline — lifecycle events + comments, best-effort. Folds in
    // late behind the diff; a failure just leaves the Activity tab empty.
    setActivityLoading(true);
    unwrap(api.prs.activity(repositoryName, pullRequest.id, opts))
      .then((ev) => {
        if (!cancelled) setActivity(ev);
      })
      .catch(() => {
        if (!cancelled) setActivity([] as ActivityEvent[]);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });

    // The Refresh spinner clears once the two structural loads settle; the
    // late-arriving secondaries keep streaming in behind it.
    void Promise.allSettled([detailReq, diffReq]).then(() => {
      if (!cancelled) setRefreshing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [repositoryName, pullRequest.id, refreshToken]);

  // Load this repo's approval checklist template once. Best-effort: a failure
  // just means no checklist gate on approve.
  useEffect(() => {
    let cancelled = false;
    unwrap(api.checklistTemplate.get(repositoryName))
      .then((tpl) => {
        if (!cancelled) setChecklistItems(tpl.items);
      })
      .catch(() => {
        if (!cancelled) setChecklistItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryName]);

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

  // Load the per-commit diff (parent → commit) when the user selects a commit
  // in the sidebar. Cleared whenever selectedCommit returns to null. The
  // active file is reset so the sidebar's previously-active file doesn't try
  // to map onto the new (possibly disjoint) file list.
  useEffect(() => {
    if (!selectedCommit) {
      setCommitDiff(null);
      setCommitDiffError(null);
      return;
    }
    // Walk to the first parent. For a root commit on the PR branch (no
    // parent), fall back to the PR's merge base — the closest "before" we have.
    const parent = selectedCommit.parents[0] ?? differences?.beforeCommitId ?? null;
    if (!parent) {
      setCommitDiffError(new Error('This commit has no parent and the PR has no merge base to fall back to.'));
      return;
    }
    let cancelled = false;
    setCommitDiffLoading(true);
    setCommitDiffError(null);
    setActiveFile(null);
    unwrap(api.prs.commitDifferences(repositoryName, parent, selectedCommit.id))
      .then((d) => {
        if (cancelled) return;
        setCommitDiff(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCommitDiffError(err);
      })
      .finally(() => {
        if (cancelled) return;
        setCommitDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCommit, repositoryName, differences?.beforeCommitId]);

  // Esc returns to the full PR diff when viewing a commit. Bound here (not in
  // a child) so it also fires when focus is in the sidebar or banner.
  useEffect(() => {
    if (!selectedCommit) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      setSelectedCommit(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedCommit]);

  // Esc returns to the PR list from the full diff view — the affordance the
  // Back button's "(Esc)" label promises. Deliberately layered *below* the
  // escape ladder's other rungs: when a commit is selected the effect above
  // owns Esc (returns to the PR diff first); the dialogs (merge/edit/finder)
  // and the help overlay own it while open (the overlay listens in the capture
  // phase, so it pre-empts this); an open overflow menu consumes it via the
  // DOM check below. Only when none of those apply does Esc go back.
  useEffect(() => {
    if (
      selectedCommit ||
      mergeOpen ||
      editOpen ||
      finderOpen ||
      findOpen ||
      checklistApproveOpen
    )
      return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Let an open popup (e.g. the overflow menu) consume Esc to close itself
      // before we navigate away.
      if (document.querySelector('.overflow-menu-popup')) return;
      e.preventDefault();
      onBack();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedCommit,
    mergeOpen,
    editOpen,
    finderOpen,
    findOpen,
    checklistApproveOpen,
    onBack,
  ]);

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
    return new Set(reviewed.filter((r) => r.reviewedAtAfterCommit === current).map((r) => r.filePath));
  }, [reviewed, differences]);

  // Files the user had marked reviewed against an older revision and that
  // aren't re-reviewed at the current one — surfaced as a banner instead of
  // silently dropping their checkmarks when a new commit lands.
  const staleReviewedCount = useMemo(() => {
    if (!differences) return 0;
    const current = differences.afterCommitId;
    const currentSet = new Set(
      reviewed
        .filter((r) => r.reviewedAtAfterCommit === current)
        .map((r) => r.filePath),
    );
    const stale = new Set(
      reviewed
        .filter(
          (r) =>
            r.reviewedAtAfterCommit !== current && !currentSet.has(r.filePath),
        )
        .map((r) => r.filePath),
    );
    return stale.size;
  }, [reviewed, differences]);
  const [staleDismissedFor, setStaleDismissedFor] = useState<string | null>(null);
  const showStaleBanner =
    staleReviewedCount > 0 &&
    !!differences &&
    staleDismissedFor !== differences.afterCommitId;

  const generalComments = useMemo(() => threads.filter((t) => !t.filePath), [threads]);

  // The resolve feature posts [revu:resolved]/[revu:reopened] marker replies;
  // keep those implementation-detail comments out of the activity timeline.
  const visibleActivity = useMemo(
    () => activity.filter((ev) => !isResolutionMarkerEvent(ev)),
    [activity],
  );

  // ---- Mutation handlers ---------------------------------------------
  const refreshThreads = useCallback(async (): Promise<void> => {
    try {
      const fresh = await unwrap(api.comments.list(repositoryName, pullRequest.id));
      setThreads(fresh);
      // A posted/replied/deleted comment changes the PR's last-activity time,
      // so flag the list for refresh on return.
      onMutatedRef.current?.();
      // Comments are part of the activity feed, so keep the timeline in sync
      // after a post/reply/delete. Best-effort: a failure here just leaves a
      // slightly stale Activity tab, not a broken comment flow.
      unwrap(api.prs.activity(repositoryName, pullRequest.id))
        .then((ev) => setActivity(ev))
        .catch(() => {});
    } catch (err) {
      // A failed comment refetch is an action-level error: surface it in the
      // dismissible banner, never blank the whole page (which would unmount
      // the diff the reviewer is mid-review on).
      setActionError(err);
    }
  }, [repositoryName, pullRequest.id]);

  const postComment = useCallback(
    async (input: PostCommentInput): Promise<void> => {
      setPostingThreadId('__composer__');
      // Optimistically insert a synthetic thread on the line so the comment
      // appears instantly; refreshThreads replaces it with the server truth,
      // and a failure rolls it back (then rethrows so the composer shows the
      // error and stays open).
      const tempId = `temp-${crypto.randomUUID()}`;
      setThreads((cur) => [
        ...cur,
        {
          threadId: tempId,
          pullRequestId: input.pullRequestId,
          repositoryName: input.repositoryName,
          beforeCommitId: input.beforeCommitId,
          afterCommitId: input.afterCommitId,
          filePath: input.filePath,
          filePosition: input.filePosition,
          relativeFileVersion: input.relativeFileVersion,
          comments: [
            {
              id: `${tempId}-c`,
              content: input.content,
              authorArn: approval?.selfArn,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ]);
      try {
        await unwrap(api.comments.post(input));
        await refreshThreads();
      } catch (err) {
        setThreads((cur) => cur.filter((t) => t.threadId !== tempId));
        throw err;
      } finally {
        setPostingThreadId(null);
      }
    },
    [refreshThreads, approval?.selfArn],
  );

  const postReply = useCallback(
    async (threadId: string, content: string): Promise<void> => {
      setPostingThreadId(threadId);
      const tempId = `temp-${crypto.randomUUID()}`;
      setThreads((cur) =>
        cur.map((t) =>
          t.threadId === threadId
            ? {
                ...t,
                comments: [
                  ...t.comments,
                  {
                    id: tempId,
                    content,
                    inReplyTo: threadId,
                    authorArn: approval?.selfArn,
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : t,
        ),
      );
      try {
        await unwrap(api.comments.reply({ inReplyTo: threadId, content }));
        await refreshThreads();
      } catch (err) {
        setThreads((cur) =>
          cur.map((t) =>
            t.threadId === threadId
              ? { ...t, comments: t.comments.filter((c) => c.id !== tempId) }
              : t,
          ),
        );
        throw err;
      } finally {
        setPostingThreadId(null);
      }
    },
    [refreshThreads, approval?.selfArn],
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
          comments: t.comments.map((c) => (c.id === commentId ? { ...c, deleted: true, content: '' } : c)),
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
        // Surface as a dismissible action error (not a page-blanking load
        // error); the finally below re-fetches the truth, rolling back the
        // optimistic soft-delete if the server rejected it.
        setActionError(err);
      } finally {
        await refreshThreads();
      }
    },
    [pullRequest.id, repositoryName, refreshThreads],
  );

  // Set/replace/remove the caller's emoji reaction on a comment. Optimistic so
  // the pill flips immediately; refreshThreads reconciles with the server.
  const reactToComment = useCallback(
    (commentId: string, value: string): void => {
      setThreads((cur) =>
        cur.map((t) => ({
          ...t,
          comments: t.comments.map((c) =>
            c.id === commentId ? applyOptimisticReaction(c, value) : c,
          ),
        })),
      );
      const myNonce = ++reactionNonceRef.current;
      void (async () => {
        try {
          await unwrap(
            api.comments.react({
              commentId,
              reactionValue: value,
              pullRequestId: pullRequest.id,
              repositoryName,
            }),
          );
          const fresh = await unwrap(
            api.comments.list(repositoryName, pullRequest.id),
          );
          // Only the most recent reaction's result is allowed to land, so a
          // slower earlier request can't clobber it.
          if (reactionNonceRef.current !== myNonce) return;
          setThreads(fresh);
          onMutatedRef.current?.();
          unwrap(api.prs.activity(repositoryName, pullRequest.id))
            .then((ev) => setActivity(ev))
            .catch(() => {});
        } catch (err) {
          if (reactionNonceRef.current !== myNonce) return;
          setActionError(err);
          // Reconcile the optimistic pill back to the server truth.
          await refreshThreads();
        }
      })();
    },
    [pullRequest.id, repositoryName, refreshThreads],
  );

  // Resolve / reopen a line-anchored thread. CodeCommit has no native resolve,
  // so we post a marker reply ([revu:resolved] / [revu:reopened]) — the latest
  // marker decides the state, which makes it shared with the whole team.
  const resolveThread = useCallback(
    async (threadId: string, resolved: boolean): Promise<void> => {
      try {
        await unwrap(
          api.comments.reply({
            inReplyTo: threadId,
            content: resolved ? RESOLVE_MARKER : REOPEN_MARKER,
          }),
        );
      } catch (err) {
        setActionError(err);
      } finally {
        await refreshThreads();
      }
    },
    [refreshThreads],
  );

  const toggleReviewed = useCallback(
    async (file: FileDiffEntry, next: boolean): Promise<void> => {
      if (!differences) return;
      try {
        const entry = await unwrap(api.reviewed.toggle(pullRequest.id, file.path, differences.afterCommitId, next));
        setReviewed((cur) => {
          const filtered = cur.filter((r) => r.filePath !== file.path);
          return entry ? [...filtered, entry] : filtered;
        });
      } catch (err) {
        setActionError(err);
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

  // ---- View-mode derivation ------------------------------------------
  // viewMode flips to 'commit' when the user picks a commit in the sidebar.
  // The diff area, file list, threads, and reviewed-state all swap based on
  // mode. Commit view is read-only: comments are anchored to the PR's commit
  // pair, so posting from the per-commit diff would land on the wrong
  // beforeCommitId / afterCommitId.
  const viewMode: 'pr' | 'commit' = selectedCommit ? 'commit' : 'pr';
  const currentDiff = viewMode === 'commit' ? commitDiff : differences;

  // ---- Stable props for ContinuousDiff -------------------------------
  // These objects used to be built inline in the JSX, so every PRDetail render
  // (including every scroll-driven setActiveFile) produced new `ctx` /
  // `callbacks` references. With FileDiffSection now memoized, prop identity
  // matters — recomputing these only when their inputs actually change is what
  // lets the file sections skip re-rendering during scroll.
  const ctx: DiffContext | null = useMemo(() => {
    if (!currentDiff) return null;
    return {
      pullRequestId: pullRequest.id,
      repositoryName,
      beforeCommitId: currentDiff.beforeCommitId,
      afterCommitId: currentDiff.afterCommitId,
      postingThreadId,
      selfArn: approval?.selfArn,
      readOnly: viewMode === 'commit',
      ignoreWhitespace,
    };
  }, [currentDiff, pullRequest.id, repositoryName, postingThreadId, approval?.selfArn, viewMode, ignoreWhitespace]);

  const callbacks: DiffCallbacks = useMemo(
    () => ({
      onPostComment: postComment,
      onPostReply: postReply,
      onSaveDraft: saveDraft,
      onDeleteDraft: deleteDraft,
      onDeleteComment: deleteComment,
      onReactToComment: reactToComment,
      onResolveThread: resolveThread,
      onToggleReviewed: toggleReviewedSync,
    }),
    [
      postComment,
      postReply,
      saveDraft,
      deleteDraft,
      deleteComment,
      reactToComment,
      resolveThread,
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

  const onChangeSidebarTab = useCallback((next: SidebarTab): void => {
    setSidebarTab(next);
  }, []);

  const onBackToPrDiff = useCallback((): void => {
    setSelectedCommit(null);
  }, []);

  // Clicking a row in the Activity timeline dispatches on event type:
  //   - line-anchored comment → scroll the diff to the thread
  //   - commit → jump to the per-commit diff for that SHA
  // Comment threads only render in the PR diff (the per-commit view is
  // read-only and shows none), so a comment click drops back to it first;
  // the diff keeps the pending reveal and acts on it once the PR sections
  // render. A commit click does the opposite — it sets `selectedCommit`
  // which switches to the per-commit diff (no scroll needed; the diff
  // loads fresh against that commit pair).
  const onActivitySelect = useCallback(
    (event: ActivityEvent): void => {
      if (event.type === 'commit') {
        if (!event.commitId) return;
        const commit = commits.find((c) => c.id === event.commitId);
        if (commit) setSelectedCommit(commit);
        return;
      }
      if (!event.filePath || !event.threadId) return;
      setSelectedCommit(null);
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      diffRef.current?.scrollToComment(event.threadId, event.filePath, {
        behavior: reduced ? 'auto' : 'smooth',
        block: 'start',
      });
    },
    [commits],
  );

  const applyApproval = useCallback(
    async (action: ApprovalAction): Promise<boolean> => {
      setApprovalBusy(true);
      try {
        const next = await unwrap(api.approval.update(repositoryName, pullRequest.id, action));
        setApproval(next);
        const fresh = await unwrap(api.prs.get(repositoryName, pullRequest.id));
        setDetail(fresh);
        onMutatedRef.current?.();
        return true;
      } catch (err) {
        setActionError(err);
        return false;
      } finally {
        setApprovalBusy(false);
      }
    },
    [repositoryName, pullRequest.id],
  );

  // Approve entry point used by the toolbar + menu. If the repo has a checklist,
  // open the (advisory) checklist modal first; otherwise approve directly.
  const requestApprove = useCallback((): void => {
    if (checklistItems.length > 0) {
      setActionError(null);
      setChecklistApproveOpen(true);
    } else {
      void applyApproval('APPROVE');
    }
  }, [checklistItems.length, applyApproval]);

  // Approve first, then record the checklist acknowledgement in the PR
  // description. Ordering matters: the description is shared remote state, so we
  // only mutate it once the approval has actually succeeded — otherwise a failed
  // approval would leave an "approved-looking" checklist block with no approval
  // behind it.
  const submitApproveWithChecklist = useCallback(
    async (checked: Record<string, boolean>): Promise<void> => {
      const ok = await applyApproval('APPROVE');
      // Keep the modal open on failure so its inline error shows and the user's
      // checked state isn't lost. No remote description write happens.
      if (!ok) return;

      if (checklistItems.length > 0) {
        try {
          // Re-read the description fresh immediately before writing so the
          // per-approver block is merged into the *latest* server state, not the
          // copy loaded when this view opened. CodeCommit's
          // UpdatePullRequestDescription is a full overwrite with no
          // conditional/etag option, so without this a concurrent description
          // edit by another reviewer would be silently clobbered. This shrinks
          // that window to a single round-trip (the irreducible floor for this
          // API); the upsert only touches our own marker, so other approvers'
          // blocks are preserved either way.
          const fresh = await unwrap(api.prs.get(repositoryName, pullRequest.id));
          const approver = shortArn(approval?.selfArn);
          const block = buildChecklistBlock(approver, checklistItems, checked);
          const baseDesc = fresh.description ?? '';
          const nextDesc = upsertChecklistBlock(baseDesc, markerKey(approver), block);
          if (nextDesc !== baseDesc) {
            const updated = await unwrap(
              api.prs.update({
                repositoryName,
                pullRequestId: pullRequest.id,
                description: nextDesc,
              }),
            );
            setDetail(updated);
          }
        } catch (err) {
          // Non-fatal: the approval already succeeded; the description record is
          // an advisory audit aid.
          console.error('[approve] checklist description update failed:', err);
        }
      }
      setChecklistApproveOpen(false);
    },
    [checklistItems, approval?.selfArn, repositoryName, pullRequest.id, applyApproval],
  );

  // Re-read mergeability from AWS after a state-changing action. Best-effort:
  // a merge/close flips the badge, but the detail refetch already carries the
  // authoritative status, so a failure here just leaves a slightly stale badge.
  const reloadMergeability = useCallback(async (): Promise<void> => {
    try {
      const m = await unwrap(
        api.mergeability.get(repositoryName, pullRequest.id, {
          forceFresh: true,
        }),
      );
      setMergeability(m);
    } catch {
      // best-effort
    }
  }, [repositoryName, pullRequest.id]);

  const doMerge = useCallback(
    async (strategy: MergeOptionId, commitMessage: string): Promise<void> => {
      setActionBusy('merge');
      setActionError(null);
      try {
        const updated = await unwrap(
          api.prs.merge({
            repositoryName,
            pullRequestId: pullRequest.id,
            strategy,
            commitMessage,
            // Pin to the source tip the user reviewed so a branch move can't
            // silently merge unreviewed code.
            sourceCommitId: differences?.afterCommitId,
          }),
        );
        setDetail(updated);
        setMergeOpen(false);
        onMutatedRef.current?.();
        await reloadMergeability();
      } catch (err) {
        setActionError(err);
      } finally {
        setActionBusy(null);
      }
    },
    [repositoryName, pullRequest.id, reloadMergeability, differences?.afterCommitId],
  );

  const doSetStatus = useCallback(
    async (status: PRStatus): Promise<void> => {
      setActionBusy('status');
      setActionError(null);
      try {
        const updated = await unwrap(api.prs.setStatus(repositoryName, pullRequest.id, status));
        setDetail(updated);
        onMutatedRef.current?.();
        await reloadMergeability();
      } catch (err) {
        setActionError(err);
      } finally {
        setActionBusy(null);
      }
    },
    [repositoryName, pullRequest.id, reloadMergeability],
  );

  const doUpdate = useCallback(
    async (title: string, description: string): Promise<void> => {
      setActionBusy('edit');
      setActionError(null);
      try {
        const updated = await unwrap(
          api.prs.update({
            repositoryName,
            pullRequestId: pullRequest.id,
            title,
            description,
          }),
        );
        setDetail(updated);
        setEditOpen(false);
        onMutatedRef.current?.();
      } catch (err) {
        setActionError(err);
      } finally {
        setActionBusy(null);
      }
    },
    [repositoryName, pullRequest.id],
  );

  // Run the in-diff find for a query, navigating to the first matching file.
  const runFind = useCallback((query: string): void => {
    setFindQuery(query);
    const m = diffRef.current?.searchFiles(query) ?? [];
    setFindMatches(m);
    setFindIdx(0);
    const first = m[0];
    if (first) {
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      diffRef.current?.scrollToFile(first.path, {
        behavior: reduced ? 'auto' : 'smooth',
        block: 'start',
      });
    }
  }, []);

  const stepFind = useCallback(
    (dir: number): void => {
      setFindIdx((prev) => {
        if (findMatches.length === 0) return prev;
        const next = (prev + dir + findMatches.length) % findMatches.length;
        const target = findMatches[next];
        if (target) diffRef.current?.scrollToFile(target.path, { block: 'start' });
        return next;
      });
    },
    [findMatches],
  );

  const closeFind = useCallback((): void => {
    setFindOpen(false);
    setFindQuery('');
    setFindMatches([]);
    setFindIdx(0);
  }, []);

  // Reconcile the find results as files stream in: a query typed before all
  // diffs loaded would otherwise show a stale count. Reads find state via refs
  // so the callback stays stable, and debounces the background-load wave.
  const findOpenRef = useRef(findOpen);
  findOpenRef.current = findOpen;
  const findQueryRef = useRef(findQuery);
  findQueryRef.current = findQuery;
  const findReconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDiffsChanged = useCallback((): void => {
    if (!findOpenRef.current || !findQueryRef.current.trim()) return;
    if (findReconcileTimer.current) return;
    findReconcileTimer.current = setTimeout(() => {
      findReconcileTimer.current = null;
      const q = findQueryRef.current;
      if (!findOpenRef.current || !q.trim()) return;
      const m = diffRef.current?.searchFiles(q) ?? [];
      setFindMatches(m);
      setFindIdx((prev) => (m.length === 0 ? 0 : Math.min(prev, m.length - 1)));
    }, 250);
  }, []);
  useEffect(
    () => () => {
      if (findReconcileTimer.current) clearTimeout(findReconcileTimer.current);
    },
    [],
  );

  // ---- Keyboard navigation -------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      // Cmd/Ctrl+F → in-diff find. Handled before the typing guard so it works
      // even when focus is in the diff; intercept before the browser's find.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === 'f' || e.key === 'F')
      ) {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      // Never hijack keys while the user is typing in a field — this guard sits
      // above the Cmd/Ctrl+P handler so the finder won't pop while editing a
      // comment, title, or filter.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
        // Cmd/Ctrl+P → fuzzy file finder. Intercept before the browser's print.
        e.preventDefault();
        setFinderOpen(true);
        return;
      }
      if (e.key === 'j') {
        e.preventDefault();
        diffRef.current?.scrollToFileBy(1);
      } else if (e.key === 'k') {
        e.preventDefault();
        diffRef.current?.scrollToFileBy(-1);
      } else if (e.key === 'n') {
        // Next / previous comment thread (Shift+N goes back).
        e.preventDefault();
        diffRef.current?.scrollToAdjacentComment(1);
      } else if (e.key === 'N') {
        e.preventDefault();
        diffRef.current?.scrollToAdjacentComment(-1);
      } else if (e.key === ']') {
        // Next / previous changed hunk.
        e.preventDefault();
        diffRef.current?.scrollToAdjacentChange(1);
      } else if (e.key === '[') {
        e.preventDefault();
        diffRef.current?.scrollToAdjacentChange(-1);
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
    onApprove: requestApprove,
    onRevoke: () => void applyApproval('REVOKE'),
    onBack,
    generalCount: generalComments.length,
    showGeneral,
    onToggleGeneral: () => setShowGeneral((v) => !v),
    metaOpen,
    onToggleMeta: () => setMetaOpen((v) => !v),
    refreshing,
    onRefresh: () => void onRefresh(),
    actionBusy,
    onMerge: () => setMergeOpen(true),
    onEdit: () => setEditOpen(true),
    onClose: () => void doSetStatus('CLOSED'),
    onReopen: () => void doSetStatus('OPEN'),
    onOpenInAws: () => {
      if (webUrl) window.open(webUrl, '_blank', 'noopener,noreferrer');
    },
    hasWebUrl: !!webUrl,
  };

  if (loadError) {
    return (
      <div className='pr-detail'>
        <Toolbar {...toolbarProps} />
        <ErrorBanner
          title='Could not load PR data.'
          error={loadError}
          onRetry={() => void onRefresh()}
          retryLabel='Retry'
          retrying={refreshing}
        />
      </div>
    );
  }

  // Structural loads still in flight (the two regions the diff + meta hang
  // off). Drives the indeterminate sweep at the top of the detail so the
  // streaming reveal reads as "still arriving," not "finished and empty."
  const structuralLoading = !detail || !differences;

  return (
    <div className='pr-detail'>
      <Toolbar {...toolbarProps} />
      {structuralLoading && <div className='pr-load-bar' role='presentation' aria-hidden />}
      {actionError != null && !mergeOpen && !editOpen && (
        <ErrorBanner
          title='Action failed.'
          error={actionError}
          onRetry={() => setActionError(null)}
          retryLabel='Dismiss'
        />
      )}
      {metaOpen && detail && (
        <PRMetadata
          detail={detail}
          differences={differences}
          mergeability={mergeability}
          approval={approval}
          approvalCount={approval?.states.filter((s) => s.approvalState === 'APPROVE').length ?? 0}
          fileCount={differences ? differences.files.length : null}
          selfApproved={approval?.selfApproved ?? false}
          webUrl={webUrl}
        />
      )}
      {showStaleBanner && (
        <div className='stale-reviewed-banner' role='status'>
          <span>
            The source branch has new commits since you last reviewed.{' '}
            <strong>{staleReviewedCount}</strong> file
            {staleReviewedCount === 1 ? '' : 's'} you&rsquo;d marked reviewed are
            shown unreviewed against the latest revision.
          </span>
          <button
            type='button'
            onClick={() =>
              setStaleDismissedFor(differences?.afterCommitId ?? null)
            }
          >
            Dismiss
          </button>
        </div>
      )}
      <div className='pr-body'>
        <FileSidebar
          sidebarOpen={sidebarOpen}
          sidebarWidth={sidebarWidth}
          tab={sidebarTab}
          onChangeTab={onChangeSidebarTab}
          files={currentDiff?.files ?? differences?.files ?? []}
          selectedPath={activeFile ?? undefined}
          commentCounts={viewMode === 'pr' ? commentCounts : EMPTY_COUNTS}
          reviewedPaths={viewMode === 'pr' ? reviewedPaths : EMPTY_PATHS}
          onSelect={onSidebarSelect}
          onToggleReviewed={toggleReviewedSync}
          filesReadOnly={viewMode === 'commit'}
          selectedCommitId={selectedCommit?.id}
          activity={visibleActivity}
          activityLoading={activityLoading}
          onActivitySelect={onActivitySelect}
        />
        {sidebarOpen && (
          <div className='sidebar-edge'>
            <div className='sidebar-resize-handle' onMouseDown={onResizeMouseDown} />
          </div>
        )}
        <div className='diff-area'>
          <div className='diff-topbar'>
            <button
              type='button'
              className='diff-sidebar-toggle'
              aria-pressed={sidebarOpen}
              onClick={toggleSidebar}
              title={sidebarOpen ? 'Hide file list' : 'Show file list'}
              aria-label={sidebarOpen ? 'Hide file list' : 'Show file list'}>
              <PanelLeft size={15} filled={sidebarOpen} />
            </button>
            <span className='grow' />
            <button
              type='button'
              className={`diff-ws-toggle${ignoreWhitespace ? ' is-active' : ''}`}
              aria-pressed={ignoreWhitespace}
              onClick={() => setIgnoreWhitespace((v) => !v)}
              title='Ignore whitespace-only changes in the diff'>
              <span aria-hidden>¶</span>
              <span>Whitespace</span>
            </button>
          </div>
          {findOpen && (
            <DiffFindBar
              query={findQuery}
              matches={findMatches}
              idx={findIdx}
              onQuery={runFind}
              onStep={stepFind}
              onClose={closeFind}
            />
          )}
          {viewMode === 'commit' && selectedCommit && (
            <CommitBanner commit={selectedCommit} onBack={onBackToPrDiff} loading={commitDiffLoading} />
          )}
          {viewMode === 'commit' && commitDiffError ? (
            <ErrorBanner
              title="Could not load this commit's diff."
              error={commitDiffError}
              onRetry={() => {
                setCommitDiffError(null);
                setSelectedCommit((c) => (c ? { ...c } : c));
              }}
              retryLabel='Retry'
              retrying={commitDiffLoading}
            />
          ) : viewMode === 'commit' && !commitDiff ? (
            <DiffLoading label='Loading commit diff' />
          ) : viewMode === 'pr' && !differences ? (
            <DiffLoading label='Loading diff' />
          ) : !currentDiff || currentDiff.files.length === 0 || !ctx ? (
            <div className='empty'>No files changed.</div>
          ) : (
            <div className='diff-stream'>
              <ContinuousDiff
                ref={diffRef}
                files={currentDiff.files}
                threads={viewMode === 'pr' ? threads : EMPTY_THREADS}
                drafts={viewMode === 'pr' ? drafts : EMPTY_DRAFTS}
                reviewedPaths={viewMode === 'pr' ? reviewedPaths : EMPTY_PATHS}
                ctx={ctx}
                callbacks={callbacks}
                onActiveFileChange={onActiveFileChange}
                onDiffsChanged={onDiffsChanged}
              />
            </div>
          )}
        </div>
        {showGeneral && generalComments.length > 0 && (
          <aside className='general-comments'>
            <div className='general-head'>
              <h3>General comments ({generalComments.length})</h3>
              <button onClick={() => setShowGeneral(false)} aria-label='Hide general comments'>
                <X size={14} />
              </button>
            </div>
            {generalComments.map((t) => (
              <div key={t.threadId} className='thread thread-flat'>
                {t.comments.map((c) => {
                  const canDelete = !!approval?.selfArn && !c.deleted && c.authorArn === approval.selfArn;
                  return (
                    <div key={c.id} className={`comment${c.deleted ? ' deleted' : ''}`}>
                      <div className='comment-head'>
                        <span className='author'>{shortArn(c.authorArn)}</span>
                        <span className='when'>{fmt(c.createdAt)}</span>
                        {canDelete && (
                          <>
                            <span className='grow' />
                            <button
                              type='button'
                              className='comment-delete'
                              onClick={() => void deleteComment(c.id)}
                              aria-label='Delete this comment'
                              title='Delete this comment'>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                      <div className='comment-body'>
                        {c.deleted ? <i>(deleted)</i> : <Markdown source={c.content} />}
                      </div>
                      {!c.deleted && (
                        <CommentReactions comment={c} onReact={reactToComment} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </aside>
        )}
      </div>
      {mergeOpen && mergeability && (
        <MergeDialog
          mergeability={mergeability}
          busy={actionBusy === 'merge'}
          error={actionError}
          onCancel={() => {
            setActionError(null);
            setMergeOpen(false);
          }}
          onMerge={(strategy, commitMessage) => void doMerge(strategy, commitMessage)}
        />
      )}
      {editOpen && detail && (
        <EditPRDialog
          initialTitle={detail.title}
          initialDescription={detail.description ?? ''}
          busy={actionBusy === 'edit'}
          error={actionError}
          onCancel={() => {
            setActionError(null);
            setEditOpen(false);
          }}
          onSave={(title, description) => void doUpdate(title, description)}
        />
      )}
      {finderOpen && (
        <FileFinder
          files={currentDiff?.files ?? differences?.files ?? []}
          onSelect={onSidebarSelect}
          onClose={() => setFinderOpen(false)}
        />
      )}
      {checklistApproveOpen && (
        <ChecklistApproveModal
          items={checklistItems}
          busy={approvalBusy}
          error={actionError}
          onCancel={() => {
            setActionError(null);
            setChecklistApproveOpen(false);
          }}
          onApprove={(checked) => void submitApproveWithChecklist(checked)}
        />
      )}
    </div>
  );
}

// ---- Approval-checklist description helpers ----------------------------

// Build the markdown block recorded in the PR description on approve. Lists
// every checklist item with its checked state so the description is a complete
// record of what the approver acknowledged.
function buildChecklistBlock(
  approver: string,
  items: ChecklistItem[],
  checked: Record<string, boolean>,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = items.map(
    (it) =>
      `- [${checked[it.id] ? 'x' : ' '}] ${it.text}${it.required ? '' : ' _(optional)_'}`,
  );
  return `### ✅ Approval checklist — ${approver} · ${date}\n${lines.join('\n')}`;
}

// A safe per-approver marker key for the HTML-comment delimiters.
function markerKey(approver: string): string {
  return approver.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'reviewer';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Insert (or replace) this approver's checklist block in the description,
// delimited by HTML-comment markers so re-approving updates the same block
// instead of stacking duplicates. New blocks append after the existing
// description.
function upsertChecklistBlock(
  description: string,
  key: string,
  block: string,
): string {
  const start = `<!-- revu:checklist:${key} -->`;
  const end = `<!-- /revu:checklist:${key} -->`;
  const wrapped = `${start}\n${block}\n${end}`;
  const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  // Function replacement so `$`-sequences in the user's checklist text (e.g.
  // "$&", "$1") aren't interpreted as substitution patterns.
  if (re.test(description)) return description.replace(re, () => wrapped);
  const sep = description.trim().length > 0 ? '\n\n' : '';
  return `${description}${sep}${wrapped}`;
}

// In-diff find bar (Cmd/Ctrl+F). Searches every loaded file diff and steps
// between matching files. Note: navigation is file-level — it brings the next
// matching file to the top rather than scrolling to each individual line.
function DiffFindBar({
  query,
  matches,
  idx,
  onQuery,
  onStep,
  onClose,
}: {
  query: string;
  matches: DiffSearchMatch[];
  idx: number;
  onQuery: (q: string) => void;
  onStep: (dir: number) => void;
  onClose: () => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const totalMatches = matches.reduce((a, m) => a + m.count, 0);
  const hasQuery = query.trim().length > 0;
  return (
    <div className="diff-find">
      <input
        ref={inputRef}
        type="text"
        className="diff-find-input"
        value={query}
        placeholder="Find in diff…"
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="diff-find-count">
        {hasQuery
          ? matches.length > 0
            ? `${idx + 1}/${matches.length} file${matches.length === 1 ? '' : 's'} · ${totalMatches} match${totalMatches === 1 ? '' : 'es'}`
            : 'No matches'
          : ''}
      </span>
      <button
        type="button"
        className="ghost icon"
        onClick={() => onStep(-1)}
        disabled={matches.length === 0}
        aria-label="Previous matching file"
        title="Previous file (Shift+Enter)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="ghost icon"
        onClick={() => onStep(1)}
        disabled={matches.length === 0}
        aria-label="Next matching file"
        title="Next file (Enter)"
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className="ghost icon"
        onClick={onClose}
        aria-label="Close find"
        title="Close (Esc)"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// Quiet, centered placeholder shown in the diff area while the diff (or a
// per-commit diff) is still being computed in the main process. Three accent
// dots pulse in sequence — enough motion to read as "working" without the
// SaaS spinner the brand explicitly rejects. Flattens under
// prefers-reduced-motion via the global reset in index.css.
function DiffLoading({ label }: { label: string }): JSX.Element {
  return (
    <div className="diff-loading" role="status" aria-live="polite">
      <span className="diff-loading-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="diff-loading-text">{label}</span>
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
  actionBusy,
  onMerge,
  onEdit,
  onClose,
  onReopen,
  onOpenInAws,
  hasWebUrl,
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
  actionBusy: null | 'merge' | 'status' | 'edit';
  onMerge: () => void;
  onEdit: () => void;
  onClose: () => void;
  onReopen: () => void;
  onOpenInAws: () => void;
  hasWebUrl: boolean;
}): JSX.Element {
  const isOpen = detail?.status === 'OPEN';
  const isMerged = detail?.mergeState === 'MERGED';
  const busyAny = actionBusy !== null;
  const approvedCount =
    approval?.states.filter((s) => s.approvalState === 'APPROVE').length ?? 0;
  const requiredApprovals =
    detail?.requiredApprovalCount ?? pr.requiredApprovalCount ?? 0;

  // Approval gating for the smart primary action. We trust the rollup
  // approvalState (NOT_APPROVED is the only state that should surface Approve).
  // CodeCommit rejects an author approving their own PR, and a user can't
  // approve twice — so neither the author nor someone who already approved is
  // offered Approve; for them an unsatisfied PR shows a disabled Merge that
  // explains it's awaiting others.
  const isAuthor =
    !!approval?.selfArn &&
    !!detail?.authorArn &&
    approval.selfArn === detail.authorArn;
  const selfApproved = !!approval?.selfApproved;
  // Only an explicit APPROVED / NO_RULES counts as satisfied. UNKNOWN (a failed
  // or throttled approval evaluation) must NOT green-light Merge — CodeCommit
  // would reject it server-side, and dangling a confident Merge on a PR whose
  // approval state we couldn't read is misleading.
  const approvalUnknown = detail?.approvalState === 'UNKNOWN';
  const rulesSatisfied = detail
    ? detail.approvalState === 'APPROVED' || detail.approvalState === 'NO_RULES'
    : false;
  const mergeable = mergeability?.state === 'mergeable';
  const mergeEnabled = !!isOpen && !isMerged && rulesSatisfied && mergeable;
  const mergeDisabledReason =
    !isOpen || isMerged
      ? undefined
      : approvalUnknown
        ? 'Approval status unavailable'
        : !rulesSatisfied
          ? 'Awaiting required approvals'
          : !mergeable
            ? mergeability?.state === 'has_conflicts'
              ? 'Resolve merge conflicts first'
              : (mergeability?.reason ?? 'Not mergeable yet')
            : undefined;

  const canApprove = !!isOpen && !isMerged && !isAuthor && !selfApproved;
  const canRevoke = !!isOpen && selfApproved;
  const canMergeAction = !!isOpen && !isMerged;
  const canEdit = !!isOpen;
  const canClose = !!isOpen && !isMerged;
  const canReopen = detail?.status === 'CLOSED' && !isMerged;

  // The single highlighted action: Approve when the PR still needs this user's
  // approval, otherwise Merge (enabled only when satisfied + mergeable; shown
  // disabled-with-reason while it isn't, so the button always communicates the
  // next step instead of dangling a green Merge on an unapproved PR).
  const primaryAction: 'approve' | 'merge' | null =
    detail && isOpen && !isMerged
      ? !rulesSatisfied && canApprove
        ? 'approve'
        : 'merge'
      : null;

  // Status: a single inline pill summarizing the PR's lifecycle state. The
  // detailed view lives in PRMetadata; the toolbar pill is for at-a-glance
  // scanning when the meta panel is collapsed.
  const statusKind: StatusKind | null = detail
    ? isMerged
      ? 'merged'
      : detail.status === 'OPEN'
        ? 'open'
        : 'closed'
    : null;
  const approvalKind: StatusKind | null = detail
    ? (detail.approvalState.toLowerCase() as StatusKind)
    : null;

  return (
    <div className="pr-toolbar">
      <button className="ghost" onClick={onBack} title="Back to PR list (Esc)">
        <ArrowLeft size={14} />
        <span>Back</span>
      </button>
      <span className="pr-toolbar-title">
        <span className="id">#{pr.id}</span>
        <span className="pr-toolbar-title-text">
          {detail?.title ?? pr.title}
        </span>
      </span>
      {statusKind && <Pill kind={statusKind} />}
      {approvalKind && <Pill kind={approvalKind} />}
      {(approvedCount > 0 || requiredApprovals > 0) && (
        <span
          className="pr-toolbar-count"
          title={
            requiredApprovals > 0
              ? `${approvedCount} of ${requiredApprovals} required approval${requiredApprovals === 1 ? '' : 's'}`
              : `${approvedCount} approval${approvedCount === 1 ? '' : 's'}`
          }
        >
          <Check size={12} />
          <span>
            {approvedCount}
            {requiredApprovals > 0 ? `/${requiredApprovals}` : ''}
          </span>
        </span>
      )}
      <span className="grow" />
      <button
        className="ghost icon"
        onClick={onRefresh}
        disabled={refreshing}
        title="Bypass local cache and re-fetch this PR from AWS"
        aria-label="Refresh"
      >
        <RefreshCw size={14} />
      </button>
      <button
        className="ghost icon"
        onClick={onToggleMeta}
        title={metaOpen ? 'Hide details panel' : 'Show details panel'}
        aria-label={metaOpen ? 'Hide details' : 'Show details'}
      >
        {metaOpen ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      {generalCount > 0 && (
        <button
          className={showGeneral ? 'ghost' : 'ghost icon'}
          onClick={onToggleGeneral}
          title={showGeneral ? 'Hide general comments' : 'Show general comments'}
          aria-label="Toggle general comments"
        >
          <MessageSquare size={14} />
          <span>{generalCount}</span>
        </button>
      )}
      <OverflowMenu
        canApprove={canApprove}
        canRevoke={canRevoke}
        canMerge={canMergeAction}
        mergeEnabled={mergeEnabled}
        mergeDisabledReason={mergeDisabledReason}
        canEdit={canEdit}
        canClose={canClose}
        canReopen={canReopen}
        busyAny={busyAny}
        actionBusy={actionBusy}
        approvalBusy={approvalBusy}
        onApprove={onApprove}
        onRevoke={onRevoke}
        onMerge={onMerge}
        onEdit={onEdit}
        onClose={onClose}
        onReopen={onReopen}
        onOpenInAws={onOpenInAws}
        hasWebUrl={hasWebUrl}
      />
      {primaryAction === 'approve' && (
        <button
          className="primary"
          onClick={onApprove}
          disabled={approvalBusy}
          title="Approve this pull request"
        >
          <CheckCircle size={14} />
          <span>{approvalBusy ? 'Approving…' : 'Approve'}</span>
        </button>
      )}
      {primaryAction === 'merge' && (
        <button
          className="primary"
          onClick={onMerge}
          disabled={busyAny || !mergeEnabled}
          title={mergeDisabledReason ?? 'Merge this pull request'}
        >
          <GitMerge size={14} />
          <span>{actionBusy === 'merge' ? 'Merging…' : 'Merge'}</span>
        </button>
      )}
    </div>
  );
}

type StatusKind =
  | 'open'
  | 'closed'
  | 'merged'
  | 'approved'
  | 'not_approved'
  | 'no_rules'
  | 'unknown';

function Pill({ kind }: { kind: StatusKind }): JSX.Element {
  const label =
    kind === 'open'
      ? 'Open'
      : kind === 'closed'
        ? 'Closed'
        : kind === 'merged'
          ? 'Merged'
          : kind === 'approved'
            ? 'Approved'
            : kind === 'not_approved'
              ? 'Not approved'
              : kind === 'no_rules'
                ? 'No rules'
                : 'Unknown';
  return <span className={`pill pill-${kind}`}>{label}</span>;
}

/* Overflow menu — lists every action (Approve/Revoke, Merge, Edit,
 * Close/Reopen, Open in AWS) behind a single ⋯ button, so the full action set
 * is always reachable regardless of which one the toolbar surfaces as the
 * highlighted primary. The toolbar itself stays at ~5 visible buttons. */
function OverflowMenu({
  canApprove,
  canRevoke,
  canMerge,
  mergeEnabled,
  mergeDisabledReason,
  canEdit,
  canClose,
  canReopen,
  busyAny,
  actionBusy,
  approvalBusy,
  onApprove,
  onRevoke,
  onMerge,
  onEdit,
  onClose,
  onReopen,
  onOpenInAws,
  hasWebUrl,
}: {
  canApprove: boolean;
  canRevoke: boolean;
  canMerge: boolean;
  mergeEnabled: boolean;
  mergeDisabledReason?: string;
  canEdit: boolean;
  canClose: boolean;
  canReopen: boolean;
  busyAny: boolean;
  actionBusy: null | 'merge' | 'status' | 'edit';
  approvalBusy: boolean;
  onApprove: () => void;
  onRevoke: () => void;
  onMerge: () => void;
  onEdit: () => void;
  onClose: () => void;
  onReopen: () => void;
  onOpenInAws: () => void;
  hasWebUrl: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click + Esc. Same pattern as the other popups.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Don't render the trigger if every item would be hidden — keep the
  // toolbar clean when the PR is in a state with no overflow actions.
  if (
    !canApprove &&
    !canRevoke &&
    !canMerge &&
    !canEdit &&
    !canClose &&
    !canReopen &&
    !hasWebUrl
  ) {
    return <></>;
  }

  return (
    <div className="overflow-menu" ref={ref}>
      <button
        className="ghost icon"
        onClick={() => setOpen((v) => !v)}
        title="More actions"
        aria-label="More actions"
        aria-expanded={open}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="overflow-menu-popup" role="menu">
          {canRevoke && (
            <button
              className="overflow-item"
              role="menuitem"
              disabled={approvalBusy}
              onClick={() => {
                setOpen(false);
                onRevoke();
              }}
            >
              <XCircle size={14} />
              <span>{approvalBusy ? 'Revoking…' : 'Revoke approval'}</span>
            </button>
          )}
          {canApprove && (
            <button
              className="overflow-item"
              role="menuitem"
              disabled={approvalBusy}
              onClick={() => {
                setOpen(false);
                onApprove();
              }}
            >
              <CheckCircle size={14} />
              <span>{approvalBusy ? 'Approving…' : 'Approve'}</span>
            </button>
          )}
          {canMerge && (
            <button
              className="overflow-item"
              role="menuitem"
              disabled={busyAny || !mergeEnabled}
              title={mergeDisabledReason}
              onClick={() => {
                setOpen(false);
                onMerge();
              }}
            >
              <GitMerge size={14} />
              <span>{actionBusy === 'merge' ? 'Merging…' : 'Merge…'}</span>
            </button>
          )}
          {canEdit && (
            <button
              className="overflow-item"
              role="menuitem"
              disabled={busyAny}
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              <Edit3 size={14} />
              <span>Edit title & description</span>
            </button>
          )}
          {canClose && (
            <button
              className="overflow-item overflow-item-danger"
              role="menuitem"
              disabled={busyAny}
              onClick={() => {
                setOpen(false);
                onClose();
              }}
            >
              <X size={14} />
              <span>{actionBusy === 'status' ? 'Working…' : 'Close PR'}</span>
            </button>
          )}
          {canReopen && (
            <button
              className="overflow-item"
              role="menuitem"
              disabled={busyAny}
              onClick={() => {
                setOpen(false);
                onReopen();
              }}
            >
              <RefreshCw size={14} />
              <span>{actionBusy === 'status' ? 'Working…' : 'Reopen PR'}</span>
            </button>
          )}
          {hasWebUrl && (
            <>
              <div className="overflow-sep" />
              <button
                className="overflow-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenInAws();
                }}
              >
                <ExternalLink size={14} />
                <span>Open in AWS Console</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function shortArn(arn: string | undefined): string {
  if (!arn) return 'unknown';
  const i = arn.lastIndexOf('/');
  return i >= 0 ? arn.slice(i + 1) : arn;
}

// Sticky banner above the diff area while viewing a single commit. Carries
// the SHA, subject, author/time, and the Back-to-PR action. Esc also returns
// to the PR diff (bound at the PRDetail level).
function CommitBanner({
  commit,
  onBack,
  loading,
}: {
  commit: PullRequestCommit;
  onBack: () => void;
  loading: boolean;
}): JSX.Element {
  const subject = (() => {
    const i = commit.message.indexOf('\n');
    return (i >= 0 ? commit.message.slice(0, i) : commit.message).trim();
  })();
  const who = commit.authorName ?? commit.committerName;
  const when = commit.committerDate ?? commit.authorDate;
  return (
    <div className="commit-banner" role="status">
      <button
        type="button"
        className="commit-banner-back"
        onClick={onBack}
        title="Return to the full PR diff (Esc)"
      >
        <ArrowLeft size={12} />
        Back to PR diff
      </button>
      <code className="commit-banner-sha" title={commit.id}>
        {commit.id.slice(0, 7)}
      </code>
      <span className="commit-banner-subject">
        {subject || '(empty message)'}
      </span>
      <span className="grow" />
      {who && <span className="hint">{who}</span>}
      {when && (
        <>
          <span className="hint">·</span>
          <span className="hint" title={when}>
            {fmtRelTime(when)}
          </span>
        </>
      )}
      {loading && <span className="hint">· loading…</span>}
    </div>
  );
}

function fmtRelTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  if (abs < minute) return diff >= 0 ? 'just now' : 'soon';
  if (abs < hour) return `${Math.round(abs / minute)}m ago`;
  if (abs < day) return `${Math.round(abs / hour)}h ago`;
  if (abs < week) return `${Math.round(abs / day)}d ago`;
  if (abs < month) return `${Math.round(abs / week)}w ago`;
  return new Date(t).toLocaleDateString();
}

function fmt(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}
