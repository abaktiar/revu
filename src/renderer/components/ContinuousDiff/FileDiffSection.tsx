import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type {
  CommentDraft,
  CommentThread,
  DiffHunk,
  FileDiff,
  FileDiffEntry,
} from '@shared/types';
import { api, unwrap } from '../../api';
import {
  buildDraftIndex,
  buildThreadIndex,
  type ComposerLocation,
  type DiffCallbacks,
  type DiffContext,
} from './types';
import { HunkView } from './HunkView';
import { ExpandGap } from './ExpandGap';

interface Props {
  entry: FileDiffEntry;
  threads: CommentThread[];
  drafts: CommentDraft[];
  reviewed: boolean;
  composerAt: ComposerLocation | null;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
  onOpenComposer: (loc: ComposerLocation) => void;
  onCloseComposer: () => void;
  onVisibilityChange: (path: string, visible: boolean) => void;
  registerNode: (path: string, el: HTMLDivElement | null) => void;
}

export function FileDiffSection({
  entry,
  threads,
  drafts,
  reviewed,
  composerAt,
  ctx,
  callbacks,
  onOpenComposer,
  onCloseComposer,
  onVisibilityChange,
  registerNode,
}: Props): JSX.Element {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [extraHunks, setExtraHunks] = useState<DiffHunk[]>([]);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  const onSectionRef = useCallback(
    (el: HTMLDivElement | null) => {
      sectionRef.current = el;
      registerNode(entry.path, el);
    },
    [entry.path, registerNode],
  );

  // Lazy-load this file's diff the first time the section is near the viewport.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || hasLoaded) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && !hasLoaded) {
          setHasLoaded(true);
        }
        onVisibilityChange(entry.path, visible);
      },
      // Pre-fetch when within one viewport of being scrolled into view.
      { rootMargin: '600px 0px 600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasLoaded, entry.path, onVisibilityChange]);

  // Fetch the file diff once we decide to load it.
  useEffect(() => {
    if (!hasLoaded || diff || error) return;
    let cancelled = false;
    unwrap(api.prs.fileDiff(ctx.repositoryName, entry))
      .then((d) => {
        if (cancelled) return;
        setDiff(d);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [hasLoaded, diff, error, ctx.repositoryName, entry]);

  const threadIndex = buildThreadIndex(threads);
  const draftIndex = buildDraftIndex(drafts);

  const allHunks = mergeHunks(diff?.hunks ?? [], extraHunks);

  function onInsertExpansion(synthetic: DiffHunk): void {
    setExtraHunks((cur) => [...cur, synthetic]);
  }

  return (
    <section
      ref={onSectionRef}
      className={`file-section${reviewed ? ' is-reviewed' : ''}`}
      data-path={entry.path}
    >
      <header className="file-section-head">
        <button
          className="file-collapse"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand file' : 'Collapse file'}
        >
          {collapsed ? '▶' : '▼'}
        </button>
        <span className={`ct ct-${entry.changeType}`}>{entry.changeType}</span>
        <span className="path">{entry.path}</span>
        {entry.beforePath &&
          entry.afterPath &&
          entry.beforePath !== entry.afterPath && (
            <span className="hint">← {entry.beforePath}</span>
          )}
        <span className="grow" />
        {threads.length > 0 && (
          <span className="hint">
            {threads.length} thread{threads.length === 1 ? '' : 's'}
          </span>
        )}
        <label className="reviewed-toggle inline">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => callbacks.onToggleReviewed(entry, e.target.checked)}
          />
          Viewed
        </label>
      </header>
      {!collapsed && (
        <div className="file-section-body">
          {error ? (
            <div className="error">
              <pre>{error}</pre>
            </div>
          ) : !hasLoaded ? (
            <div className="hint" style={{ padding: 16 }}>
              Scroll to load…
            </div>
          ) : !diff ? (
            <div className="hint" style={{ padding: 16 }}>
              Loading diff…
            </div>
          ) : diff.binary ? (
            <div className="empty">Binary file — diff not rendered.</div>
          ) : diff.hunks.length === 0 ? (
            <div className="empty">
              {entry.changeType === 'A'
                ? 'Empty file added.'
                : entry.changeType === 'D'
                  ? 'File deleted (was empty).'
                  : 'No textual changes.'}
            </div>
          ) : (
            <DiffGrid>
              {allHunks.map((hunk, idx) => {
                const prev = allHunks[idx - 1];
                const next = allHunks[idx + 1];
                return (
                  <Fragment key={`${hunk.oldStart}-${hunk.newStart}-${idx}`}>
                    {prev && (
                      <ExpandGap
                        repositoryName={ctx.repositoryName}
                        beforeBlobId={entry.beforeBlobId}
                        afterBlobId={entry.afterBlobId}
                        prevOldEnd={prev.oldStart + prev.oldLines - 1}
                        prevNewEnd={prev.newStart + prev.newLines - 1}
                        nextOldStart={hunk.oldStart}
                        nextNewStart={hunk.newStart}
                        onInsert={onInsertExpansion}
                      />
                    )}
                    <HunkView
                      filePath={entry.path}
                      hunk={hunk}
                      threads={threadIndex}
                      drafts={draftIndex}
                      composerAt={composerAt}
                      ctx={ctx}
                      callbacks={callbacks}
                      onOpenComposer={onOpenComposer}
                      onCloseComposer={onCloseComposer}
                    />
                    {idx === allHunks.length - 1 && next === undefined && (
                      <TrailingExpand
                        repositoryName={ctx.repositoryName}
                        beforeBlobId={entry.beforeBlobId}
                        afterBlobId={entry.afterBlobId}
                        lastOldEnd={hunk.oldStart + hunk.oldLines - 1}
                        lastNewEnd={hunk.newStart + hunk.newLines - 1}
                        oldTotal={diff.oldTotalLines}
                        newTotal={diff.newTotalLines}
                        onInsert={onInsertExpansion}
                      />
                    )}
                  </Fragment>
                );
              })}
              {allHunks.length > 0 && (
                <LeadingExpand
                  repositoryName={ctx.repositoryName}
                  beforeBlobId={entry.beforeBlobId}
                  afterBlobId={entry.afterBlobId}
                  firstOldStart={allHunks[0]!.oldStart}
                  firstNewStart={allHunks[0]!.newStart}
                  onInsert={onInsertExpansion}
                />
              )}
            </DiffGrid>
          )}
        </div>
      )}
    </section>
  );
}

function DiffGrid({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="diff-grid">{children}</div>;
}

function LeadingExpand({
  repositoryName,
  beforeBlobId,
  afterBlobId,
  firstOldStart,
  firstNewStart,
  onInsert,
}: {
  repositoryName: string;
  beforeBlobId?: string;
  afterBlobId?: string;
  firstOldStart: number;
  firstNewStart: number;
  onInsert: (h: DiffHunk) => void;
}): JSX.Element | null {
  if (firstOldStart <= 1 && firstNewStart <= 1) return null;
  return (
    <ExpandGap
      repositoryName={repositoryName}
      beforeBlobId={beforeBlobId}
      afterBlobId={afterBlobId}
      prevOldEnd={0}
      prevNewEnd={0}
      nextOldStart={firstOldStart}
      nextNewStart={firstNewStart}
      onInsert={onInsert}
    />
  );
}

function TrailingExpand({
  repositoryName,
  beforeBlobId,
  afterBlobId,
  lastOldEnd,
  lastNewEnd,
  oldTotal,
  newTotal,
  onInsert,
}: {
  repositoryName: string;
  beforeBlobId?: string;
  afterBlobId?: string;
  lastOldEnd: number;
  lastNewEnd: number;
  oldTotal: number;
  newTotal: number;
  onInsert: (h: DiffHunk) => void;
}): JSX.Element | null {
  if (lastOldEnd >= oldTotal && lastNewEnd >= newTotal) return null;
  return (
    <ExpandGap
      repositoryName={repositoryName}
      beforeBlobId={beforeBlobId}
      afterBlobId={afterBlobId}
      prevOldEnd={lastOldEnd}
      prevNewEnd={lastNewEnd}
      nextOldStart={oldTotal + 1}
      nextNewStart={newTotal + 1}
      onInsert={onInsert}
    />
  );
}

// Inserts expansion hunks between the right real hunks based on the line range
// they cover, so the rendered list stays in line-number order.
function mergeHunks(real: DiffHunk[], extras: DiffHunk[]): DiffHunk[] {
  if (extras.length === 0) return real;
  const all = [...real, ...extras];
  all.sort((a, b) => {
    const ao = a.oldStart || a.newStart;
    const bo = b.oldStart || b.newStart;
    return ao - bo;
  });
  return all;
}
