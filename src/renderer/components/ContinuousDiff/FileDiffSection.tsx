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
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Triangle,
} from '../../icons';
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

// Matches HunkView's ROW_HEIGHT_PX / HUNK_HEADER_PX. Used to estimate a loaded
// file's body height so content-visibility's offscreen size guess is honest
// (accurate scrollbar, no layout jump when scrolling past an unrendered file).
const ROW_HEIGHT_PX = 18;
const HUNK_HEADER_PX = 24;

// Height reserved for a file whose diff hasn't loaded yet. Without this, an
// unloaded `.file-section-body` under `content-visibility: auto` collapses to
// ~0px while offscreen, so the whole document is artificially short until every
// file has loaded. Navigating to a file low in the list then "barely moves"
// (you scroll to near the top of a tiny document) and only lands once the files
// above have streamed in — the root of the "had to click the file several
// times" bug. A fixed, generous estimate keeps the document honestly tall from
// the first paint so navigation lands right away; the real height replaces it
// the moment the diff loads.
const ESTIMATED_UNLOADED_BODY_PX = 480;

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
  // Reports this file's loaded diff up to ContinuousDiff so the in-diff find
  // can search content that isn't currently painted.
  registerDiff: (path: string, diff: FileDiff | null) => void;
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
  registerDiff,
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

  // One stable IntersectionObserver per section, reporting visibility to the
  // parent (which drives active-file tracking in the sidebar). The diff is no
  // longer loaded on dwell — every file is background-loaded on mount (see the
  // eager-load effect below) so navigation always lands on a real body — so
  // visibility is this observer's only job now. The 200px buffer matches the
  // prior active-file feel (a file counts as active just before it enters).
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        onVisibilityChange(entry.path, entries.some((e) => e.isIntersecting));
      },
      { rootMargin: '200px 0px 200px 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [entry.path, onVisibilityChange]);

  // Background-load this file's diff shortly after mount. Every section mounts
  // up front (ContinuousDiff renders one per file), so this loads the whole PR
  // diff without a scroll: sidebar/finder/j-k navigation always lands on a real
  // file body, and there's no per-file "scroll to load" wait. Paced by
  // fileDiffSemaphore; an offscreen loaded file only builds cheap hunk
  // placeholders (HunkView defers real rows + highlighting until a hunk nears
  // the viewport), so DOM/CPU cost stays bounded even on big PRs. Large files
  // still auto-collapse after load (see the fetch effect), keeping a single
  // huge file opt-in.
  useEffect(() => {
    if (hasLoaded) return;
    setHasLoaded(true);
  }, [hasLoaded]);

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
      .acquire(
        () =>
          loadFileDiff(ctx.repositoryName, entry, {
            ignoreWhitespace: ctx.ignoreWhitespace,
          }),
        // Tag with the path so navigating to this file can hoist its still-
        // queued fetch to the front (see ContinuousDiff.pinToTarget).
        entry.path,
      )
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
  }, [hasLoaded, diff, error, ctx.repositoryName, ctx.ignoreWhitespace, entry]);

  // Toggling "hide whitespace" changes the computed hunks, so drop the loaded
  // diff (and any expanded context) and let the fetch effect above re-run with
  // the new setting. No-op on first mount (diff is already null).
  const firstWsRef = useRef(true);
  useEffect(() => {
    if (firstWsRef.current) {
      firstWsRef.current = false;
      return;
    }
    setDiff(null);
    setError(null);
    setExtraHunks([]);
    setCollapsed(false);
    setAutoCollapsed(false);
  }, [ctx.ignoreWhitespace]);

  // Report this file's loaded diff (or null) up to ContinuousDiff for the
  // in-diff find index; clear it on unmount.
  useEffect(() => {
    registerDiff(entry.path, diff);
    return () => registerDiff(entry.path, null);
  }, [entry.path, diff, registerDiff]);

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
  // Estimated rendered height of this file's body, used as the
  // content-visibility intrinsic size so the browser's offscreen size guess
  // matches reality (honest scrollbar; no jump when scrolling past a file whose
  // rows haven't painted yet). Mirrors HunkView's placeholder math.
  const bodyIntrinsicHeight = useMemo(() => {
    if (!renderDiff) return null;
    let h = 0;
    for (const hk of renderDiff.hunks) {
      h += HUNK_HEADER_PX + hk.lines.length * ROW_HEIGHT_PX;
    }
    return h;
  }, [renderDiff]);
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
  // comment" click, force it loaded + expanded, then flash the thread row. The
  // scrolling itself is owned by ContinuousDiff's pin loop (which keeps the row
  // anchored as the file loads); this effect only does the state changes the pin
  // loop can't — force-load, expand, and the flash. It re-runs as the file loads
  // (renderDiff / allHunks change) and as it expands (collapsed flips) —
  // including when the post-load auto-collapse fires — so it keeps retrying
  // until the row exists. A hunk containing a thread always force-mounts (see
  // HunkView), so once the file is loaded and open the row is in the DOM.
  useEffect(() => {
    if (!reveal || reveal.threadId === null) return;
    setHasLoaded(true); // no-op once already loaded

    // Force-expand so the row can render; wait for that render before flashing.
    if (collapsed) {
      setCollapsed(false);
      setAutoCollapsed(false);
      return;
    }
    const root = sectionRef.current;
    if (!root) return;
    const node = root.querySelector<HTMLElement>(
      `[data-thread-id="${CSS.escape(reveal.threadId)}"]`,
    );
    if (!node) return; // not in the DOM yet; a later state change re-runs this
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
          aria-label={collapsed ? 'Expand file' : 'Collapse file'}
        >
          {collapsed ? (
            <Triangle size={10} className="file-collapse-icon" />
          ) : (
            <ChevronDown size={12} className="file-collapse-icon" />
          )}
        </button>
        <span className={`ct ct-${entry.changeType}`}>{entry.changeType}</span>
        <span className="path">{entry.path}</span>
        {entry.beforePath &&
          entry.afterPath &&
          entry.beforePath !== entry.afterPath && (
            <span className="hint">
              <ArrowRight size={11} />
              {entry.beforePath}
            </span>
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
          <span
            className="hint"
            title="Large diff. Collapsed by default; click to render."
          >
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
        <div
          className="file-section-body"
          style={{
            // Loaded: the exact measured height, with `auto` so the browser
            // remembers the real rendered size once painted. Unloaded: a fixed
            // estimate (NO `auto` — `auto` would latch onto the tiny "Loading
            // diff…" placeholder once it rendered and re-collapse the section).
            // This keeps offscreen files from collapsing to ~0px, so scroll
            // offsets are honest before the diff streams in.
            containIntrinsicSize:
              bodyIntrinsicHeight != null
                ? `auto ${bodyIntrinsicHeight}px`
                : `${ESTIMATED_UNLOADED_BODY_PX}px`,
          }}
        >
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
