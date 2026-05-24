import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommentDraft,
  CommentThread,
  FileDiffEntry,
  FilePair,
  PostCommentInput,
  PRDifferences,
  PullRequestDetail,
  PullRequestSummary,
  RelativeFileVersion,
} from '@shared/types';
import { api, unwrap } from '../api';
import { FileSidebar } from './FileSidebar';
import { DiffViewer } from './DiffViewer';
import {
  isSyntheticBlob,
  syntheticDifferences,
  syntheticFilePair,
} from '../syntheticDiff';

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
  const [selected, setSelected] = useState<FileDiffEntry | null>(null);
  const [filePair, setFilePair] = useState<FilePair | null>(null);
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [threadsVersion, setThreadsVersion] = useState(0);
  const [drafts, setDrafts] = useState<CommentDraft[]>([]);
  const [postingThreadId, setPostingThreadId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [synthetic, setSynthetic] = useState(false);
  // Cache of file pairs keyed by `${beforeBlobId}|${afterBlobId}` so switching
  // files we've already viewed doesn't refetch.
  const pairCache = useRef<Map<string, FilePair>>(new Map());

  // ---- Load PR detail + differences + comments + drafts ---------------
  useEffect(() => {
    if (synthetic) {
      const diff = syntheticDifferences();
      setDifferences(diff);
      setDetail({
        ...pullRequest,
        description: 'Synthetic 50k-line diff fixture (Monaco perf check).',
      });
      const f = diff.files[0];
      if (f) setSelected(f);
      setThreads([]);
      setDrafts([]);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoadError(null);
    setDifferences(null);
    setSelected(null);
    setFilePair(null);
    pairCache.current.clear();

    Promise.all([
      unwrap(api.prs.get(repositoryName, pullRequest.id)),
      unwrap(api.prs.differences(repositoryName, pullRequest.id)),
      unwrap(api.comments.list(repositoryName, pullRequest.id)),
      unwrap(api.drafts.list(pullRequest.id)),
    ])
      .then(([d, diff, th, dr]) => {
        if (cancelled) return;
        setDetail(d);
        setDifferences(diff);
        setThreads(th);
        setThreadsVersion((v) => v + 1);
        setDrafts(dr);
        // Auto-select first file (or first file that has comments).
        const firstWithComments = diff.files.find((f) =>
          th.some((t) => t.filePath === f.path),
        );
        setSelected(firstWithComments ?? diff.files[0] ?? null);
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));

    return () => {
      cancelled = true;
    };
  }, [repositoryName, pullRequest.id, synthetic]);

  // ---- Lazy-load the selected file's content --------------------------
  useEffect(() => {
    if (!selected) {
      setFilePair(null);
      return;
    }
    const cacheKey = `${selected.beforeBlobId ?? ''}|${selected.afterBlobId ?? ''}`;
    const cached = pairCache.current.get(cacheKey);
    if (cached) {
      setFilePair(cached);
      setPairError(null);
      return;
    }
    setPairLoading(true);
    setPairError(null);
    let cancelled = false;

    const fetcher = synthetic || isSyntheticBlob(selected.afterBlobId)
      ? Promise.resolve(syntheticFilePair())
      : unwrap(
          api.prs.filePair(
            repositoryName,
            selected.beforeBlobId,
            selected.afterBlobId,
          ),
        );

    fetcher
      .then((pair) => {
        if (cancelled) return;
        pairCache.current.set(cacheKey, pair);
        setFilePair(pair);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPairError(err.message);
        setFilePair(null);
      })
      .finally(() => !cancelled && setPairLoading(false));

    return () => {
      cancelled = true;
    };
  }, [selected, repositoryName, synthetic]);

  // ---- Comment counts per file (for sidebar badge) --------------------
  const commentCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of threads) {
      if (!t.filePath) continue;
      out[t.filePath] = (out[t.filePath] ?? 0) + t.comments.length;
    }
    return out;
  }, [threads]);

  const threadsForFile = useMemo(() => {
    if (!selected) return [];
    return threads.filter((t) => t.filePath === selected.path);
  }, [threads, selected]);

  const draftsForFile = useMemo(() => {
    if (!selected) return [];
    return drafts.filter((d) => d.filePath === selected.path);
  }, [drafts, selected]);

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
      setThreadsVersion((v) => v + 1);
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

  if (loadError) {
    return (
      <div className="pr-detail">
        <Toolbar
          pr={pullRequest}
          detail={detail}
          onBack={onBack}
          synthetic={synthetic}
          onToggleSynthetic={() => setSynthetic((v) => !v)}
        />
        <div className="error">
          <div>Could not load PR data.</div>
          <pre>{loadError}</pre>
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
          onBack={onBack}
          synthetic={synthetic}
          onToggleSynthetic={() => setSynthetic((v) => !v)}
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
        onBack={onBack}
        synthetic={synthetic}
        onToggleSynthetic={() => setSynthetic((v) => !v)}
      />
      <div className="pr-body">
        <FileSidebar
          files={differences.files}
          selectedPath={selected?.path}
          commentCounts={commentCounts}
          onSelect={(f) => setSelected(f)}
        />
        <div className="diff-area">
          {selected ? (
            <>
              <div className="file-bar">
                <span className={`ct ct-${selected.changeType}`}>
                  {selected.changeType}
                </span>
                <span className="path">{selected.path}</span>
                {selected.beforePath &&
                  selected.afterPath &&
                  selected.beforePath !== selected.afterPath && (
                    <span className="hint">
                      ← {selected.beforePath}
                    </span>
                  )}
                <span className="grow" />
                {draftsForFile.length > 0 && (
                  <span className="hint">
                    {draftsForFile.length} draft
                    {draftsForFile.length === 1 ? '' : 's'} in file
                  </span>
                )}
              </div>
              {pairError ? (
                <div className="error">
                  <pre>{pairError}</pre>
                </div>
              ) : pairLoading || !filePair ? (
                <div className="loading">Loading file…</div>
              ) : filePair.before?.binary || filePair.after?.binary ? (
                <div className="empty">Binary file — diff not rendered.</div>
              ) : (
                <DiffViewer
                  filePath={selected.path}
                  originalText={filePair.before?.text ?? ''}
                  modifiedText={filePair.after?.text ?? ''}
                  beforeCommitId={differences.beforeCommitId}
                  afterCommitId={differences.afterCommitId}
                  pullRequestId={pullRequest.id}
                  repositoryName={repositoryName}
                  threads={threadsForFile}
                  drafts={draftsForFile}
                  threadsVersion={threadsVersion}
                  postingThreadId={postingThreadId}
                  onPostComment={postComment}
                  onPostReply={postReply}
                  onSaveDraft={saveDraft}
                  onDeleteDraft={deleteDraft}
                />
              )}
            </>
          ) : (
            <div className="empty">No files changed.</div>
          )}
        </div>
        {generalComments.length > 0 && (
          <aside className="general-comments">
            <h3>General comments</h3>
            {generalComments.map((t) => (
              <div key={t.threadId} className="thread thread-flat">
                {t.comments.map((c) => (
                  <div key={c.id} className="comment">
                    <div className="comment-head">
                      <span className="author">{shortArn(c.authorArn)}</span>
                      <span className="when">{fmt(c.createdAt)}</span>
                    </div>
                    <div className="comment-body">{c.content}</div>
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
  onBack,
  synthetic,
  onToggleSynthetic,
}: {
  pr: PullRequestSummary;
  detail: PullRequestDetail | null;
  onBack: () => void;
  synthetic: boolean;
  onToggleSynthetic: () => void;
}): JSX.Element {
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
      <span className="grow" />
      <button onClick={onToggleSynthetic} title="Load a synthetic 50k-line diff to verify Monaco scroll performance">
        {synthetic ? 'Exit synthetic' : 'Load synthetic 50k diff'}
      </button>
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
