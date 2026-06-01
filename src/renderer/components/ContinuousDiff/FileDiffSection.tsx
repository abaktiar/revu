import {
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CommentDraft,
  CommentThread,
  DiffHunk,
  FileDiff,
  FileDiffEntry,
} from '@shared/types';
import { loadFileDiff } from '../../syntheticDiff';
import { fileDiffSemaphore } from '../../concurrency';
import {
  buildDraftIndex,
  buildThreadIndex,
  type ComposerLocation,
  type DiffCallbacks,
  type DiffContext,
  type RevealTarget,
} from './types';
import { HunkView } from './HunkView';
import { ExpandGap } from './ExpandGap';

// Files at or above this many total rendered lines (across all hunks) are
// collapsed by default and need a click to render. Mirrors GitHub's "Large
// diffs are not rendered by default" behavior — the dominant cost on big PRs
// is the synchronous render+highlight, so the safest valve is to not render.
const AUTO_COLLAPSE_LINES = 500;

// Above this, even after the user expands we skip syntax highlighting and
// just render escaped text. hljs is per-line and gets prohibitively slow
// once you cross a few thousand rows.
const SKIP_HIGHLIGHT_LINES = 1000;

// Wait this long after a section becomes visible before deciding to load it.
// Without a dwell time, a smooth scrollIntoView triggered by a sidebar click
// briefly intersects every file in between, queueing fetches we don't want.
const LOAD_DWELL_MS = 200;

interface Props {
  entry: FileDiffEntry;
  threads: CommentThread[];
  drafts: CommentDraft[];
  reviewed: boolean;
  // Already sliced by ContinuousDiff: null when the composer is closed OR
  // open on a different file. We never receive another file's composer.
  composerAt: ComposerLocation | null;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
  // Non-null only for the file a timeline "scroll to comment" click targeted.
  // ContinuousDiff passes `null` to every other section so their memo holds.
  reveal: RevealTarget | null;
  onRevealComplete: () => void;
  onOpenComposer: (loc: ComposerLocation) => void;
  onCloseComposer: () => void;
  onVisibilityChange: (path: string, visible: boolean) => void;
  registerNode: (path: string, el: HTMLDivElement | null) => void;
}

function FileDiffSectionImpl({
  entry,
  threads,
  drafts,
  reviewed,
  composerAt,
  ctx,
  callbacks,
  reveal,
  onRevealComplete,
  onOpenComposer,
  onCloseComposer,
  onVisibilityChange,
  registerNode,
}: Props): JSX.Element {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [extraHunks, setExtraHunks] = useState<DiffHunk[]>([]);
  const [pinned, setPinned] = useState(false);
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const pinSentinelRef = useRef<HTMLDivElement | null>(null);

  // Deferring the diff lets React commit the big subtree at a lower priority,
  // so scroll/key input stays responsive while a large file is rendering.
  const deferredDiff = useDeferredValue(diff);

  const onSectionRef = useCallback(
    (el: HTMLDivElement | null) => {
      sectionRef.current = el;
      registerNode(entry.path, el);
    },
    [entry.path, registerNode],
  );

  // Keep a ref-mirror of hasLoaded so the observer callback can read the
  // current value without re-running the effect (which would tear down and
  // rebuild the IntersectionObserver on every load).
  const hasLoadedRef = useRef(hasLoaded);
  useEffect(() => {
    hasLoadedRef.current = hasLoaded;
  }, [hasLoaded]);

  // One stable IntersectionObserver per section. Two jobs:
  //   1. Report visibility to the parent (drives active-file tracking).
  //   2. Trigger a load when the section dwells in view long enough — a brief
  //      scroll-through (e.g. a smooth scrollIntoView passing dozens of files
  //      on the way to a sidebar-clicked target) must NOT queue fetches we
  //      don't actually want, or we drown the renderer in pointless work.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    let pendingLoad: ReturnType<typeof setTimeout> | null = null;
    const cancelPending = (): void => {
      if (pendingLoad !== null) {
        clearTimeout(pendingLoad);
        pendingLoad = null;
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        onVisibilityChange(entry.path, visible);
        if (visible) {
          if (!hasLoadedRef.current && pendingLoad === null) {
            pendingLoad = setTimeout(() => {
              pendingLoad = null;
              if (!hasLoadedRef.current) setHasLoaded(true);
            }, LOAD_DWELL_MS);
          }
        } else {
          cancelPending();
        }
      },
      // Smaller pre-fetch buffer — combined with the dwell timer, this means
      // we only load files the user is actually looking at or stopping near.
      { rootMargin: '200px 0px 200px 0px' },
    );
    io.observe(el);
    return () => {
      cancelPending();
      io.disconnect();
    };
  }, [entry.path, onVisibilityChange]);

  // Pin sentinel: a 1px element placed just above the section. While the
  // sentinel is visible, the header is resting at the top of its section.
  // The moment the sentinel scrolls out (above the scroll container's top
  // edge), the header is pinned. We use IntersectionObserver with the
  // sentinel's parent's scroll container as the implicit root — that's
  // .continuous-diff in this layout.
  useEffect(() => {
    const el = pinSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // boundingClientRect.top < rootBounds.top means the sentinel is
          // above the viewport — i.e. the section has scrolled up past the
          // pin point. !isIntersecting alone would also fire when the section
          // scrolls below the viewport (a different state we don't want
          // marked as "pinned").
          const above =
            e.boundingClientRect.top < (e.rootBounds?.top ?? 0) &&
            !e.isIntersecting;
          setPinned(above);
        }
      },
      { threshold: [0, 1] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, []);

  // Fetch the file diff once we decide to load it. Runs through a renderer-
  // wide semaphore so that scrolling fast into a large PR doesn't fire dozens
  // of concurrent prs:file-diff IPCs (which each issue two GetBlob calls in
  // main, saturating the event loop and AWS).
  useEffect(() => {
    if (!hasLoaded || diff || error) return;
    let cancelled = false;
    fileDiffSemaphore
      .acquire(() => loadFileDiff(ctx.repositoryName, entry))
      .then((d) => {
        if (cancelled) return;
        setDiff(d);
        if (totalDiffLines(d) >= AUTO_COLLAPSE_LINES) {
          setCollapsed(true);
          setAutoCollapsed(true);
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [hasLoaded, diff, error, ctx.repositoryName, entry]);

  const threadIndex = useMemo(() => buildThreadIndex(threads), [threads]);
  const draftIndex = useMemo(() => buildDraftIndex(drafts), [drafts]);

  const renderDiff = deferredDiff ?? diff;
  const allHunks = useMemo(
    () => mergeHunks(renderDiff?.hunks ?? [], extraHunks),
    [renderDiff, extraHunks],
  );
  const disableHighlight = useMemo(
    () => (renderDiff ? totalDiffLines(renderDiff) >= SKIP_HIGHLIGHT_LINES : false),
    [renderDiff],
  );
  const totalLines = renderDiff ? totalDiffLines(renderDiff) : 0;
  // Warp-style per-file stats. Only computed once the diff has loaded (the
  // FileDiffEntry alone doesn't carry line counts). Until then the chip is
  // omitted from the header so we don't render a placeholder.
  const diffStats = useMemo(() => {
    if (!renderDiff) return null;
    let added = 0;
    let deleted = 0;
    for (const h of renderDiff.hunks) {
      for (const l of h.lines) {
        if (l.type === 'add') added++;
        else if (l.type === 'del') deleted++;
      }
    }
    return { added, deleted };
  }, [renderDiff]);

  // Which hunk (if any) contains the line the composer is open on. Computed
  // once per render of this section so each HunkView gets a plain
  // `composerAt | null` shallow-compare friendly prop — all hunks that don't
  // own the composer see `null` both before and after a composer state change
  // and the memoized HunkView skips re-rendering them.
  const composerHunkIdx = useMemo(() => {
    if (!composerAt) return -1;
    for (let i = 0; i < allHunks.length; i++) {
      const hunk = allHunks[i]!;
      for (const l of hunk.lines) {
        if (
          composerAt.line === l.newLineNumber ||
          composerAt.line === l.oldLineNumber
        ) {
          return i;
        }
      }
    }
    return -1;
  }, [allHunks, composerAt]);

  function onInsertExpansion(synthetic: DiffHunk): void {
    setExtraHunks((cur) => [...cur, synthetic]);
  }

  // Reveal driver: when this file is the target of a timeline "scroll to
  // comment" click, force it loaded + expanded, then scroll the thread row into
  // view and flash it. The effect re-runs as the file loads (renderDiff /
  // allHunks change) and as it expands (collapsed flips) — including when the
  // post-load auto-collapse fires — so it keeps retrying until the row exists.
  // A hunk containing a thread always force-mounts (see HunkView), so once the
  // file is loaded and open the row is guaranteed to be in the DOM.
  useEffect(() => {
    if (!reveal) return;
    setHasLoaded(true); // no-op once already loaded
    if (collapsed) {
      setCollapsed(false);
      setAutoCollapsed(false);
      return; // wait for the expanded render before searching for the row
    }
    const root = sectionRef.current;
    if (!root) return;
    const node = root.querySelector<HTMLElement>(
      `[data-thread-id="${CSS.escape(reveal.threadId)}"]`,
    );
    if (!node) return; // not in the DOM yet; a later state change re-runs this
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    node.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'center',
    });
    // Restart the flash even if the class is somehow still present.
    node.classList.remove('thread-flash');
    void node.offsetWidth; // force reflow so the animation replays
    node.classList.add('thread-flash');
    onRevealComplete();
  }, [reveal, collapsed, renderDiff, allHunks, onRevealComplete]);

  // Safety valve: always clear the reveal request, even if the thread never
  // renders (e.g. an outdated comment whose line isn't in the current diff —
  // we've already scrolled to the file, which is the best we can do).
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(onRevealComplete, 3000);
    return () => clearTimeout(t);
  }, [reveal, onRevealComplete]);

  return (
    <section
      ref={onSectionRef}
      className={`file-section${reviewed ? ' is-reviewed' : ''}`}
      data-path={entry.path}
    >
      <div ref={pinSentinelRef} className="file-section-pin-sentinel" />
      <header
        className={`file-section-head${pinned ? ' is-pinned' : ''}`}
      >
        <button
          className="file-collapse"
          onClick={() => {
            setCollapsed((c) => !c);
            setAutoCollapsed(false);
          }}
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
        {diffStats && (
          <span
            className="diff-stats"
            title={`${diffStats.added} added, ${diffStats.deleted} deleted`}
          >
            <span className="diff-stats-add">+{diffStats.added}</span>
            <span className="diff-stats-sep">·</span>
            <span className="diff-stats-del">-{diffStats.deleted}</span>
          </span>
        )}
        {autoCollapsed && collapsed && totalLines > 0 && (
          <span className="hint" title="Large diff. Collapsed by default; click ▶ to render.">
            large diff ({totalLines.toLocaleString()} lines)
          </span>
        )}
        <span className="grow" />
        {!ctx.readOnly && threads.length > 0 && (
          <span className="hint">
            {threads.length} thread{threads.length === 1 ? '' : 's'}
          </span>
        )}
        {!ctx.readOnly && (
          <label className="reviewed-toggle inline">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) =>
                callbacks.onToggleReviewed(entry, e.target.checked)
              }
            />
            Reviewed
          </label>
        )}
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
          ) : !renderDiff ? (
            <div className="hint" style={{ padding: 16 }}>
              Loading diff…
            </div>
          ) : renderDiff.binary ? (
            <div className="empty">Binary file. Diff not rendered.</div>
          ) : renderDiff.hunks.length === 0 ? (
            <div className="empty">
              {entry.changeType === 'A'
                ? 'Empty file added.'
                : entry.changeType === 'D'
                  ? 'File deleted (was empty).'
                  : 'No textual changes.'}
            </div>
          ) : (
            <DiffGrid>
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
                      composerAt={composerHunkIdx === idx ? composerAt : null}
                      ctx={ctx}
                      callbacks={callbacks}
                      disableHighlight={disableHighlight}
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
                        oldTotal={renderDiff.oldTotalLines}
                        newTotal={renderDiff.newTotalLines}
                        onInsert={onInsertExpansion}
                      />
                    )}
                  </Fragment>
                );
              })}
            </DiffGrid>
          )}
        </div>
      )}
    </section>
  );
}

// Memoized so unrelated PRDetail state updates (active file change during
// scroll, posting state flips, etc.) don't cause every mounted section to
// re-render. With ContinuousDiff already passing stable `ctx`, `callbacks`,
// `onOpenComposer`, `onCloseComposer`, `onVisibilityChange`, and `registerNode`,
// plus a per-file `composerAt` slice, the default shallow compare is enough.
export const FileDiffSection = memo(FileDiffSectionImpl);

function totalDiffLines(d: FileDiff): number {
  let total = 0;
  for (const h of d.hunks) total += h.lines.length;
  return total;
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
