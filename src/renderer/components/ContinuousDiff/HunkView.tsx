import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommentThread,
  DiffHunk,
  DiffLine,
  RelativeFileVersion,
} from '@shared/types';
import { highlightLine, languageForPath } from '../../highlight';
import { InlineThread } from './InlineThread';
import { InlineComposer } from './InlineComposer';
import {
  type ComposerLocation,
  type DiffCallbacks,
  type DiffContext,
  type DraftsByLine,
  type ThreadsByLine,
  threadsForLineKey,
} from './types';

// Matches `line-height: 18px` on .diff-grid in index.css. Used to reserve
// vertical space for a hunk before it's mounted, so the scrollbar position
// stays accurate and the browser doesn't reflow as hunks fill in.
const ROW_HEIGHT_PX = 18;
const HUNK_HEADER_PX = 24;

interface Props {
  filePath: string;
  hunk: DiffHunk;
  threads: ThreadsByLine;
  drafts: DraftsByLine;
  // Pre-filtered by FileDiffSection: null when the composer is closed OR when
  // the composer is open on a line that is NOT in this hunk. So if this prop
  // is set, this hunk always owns the composer.
  composerAt: ComposerLocation | null;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
  // When true, skip hljs entirely and render escaped text. Caller sets this
  // for very large files where per-line highlighting would freeze the renderer.
  disableHighlight?: boolean;
  onOpenComposer: (loc: ComposerLocation) => void;
  onCloseComposer: () => void;
}

function HunkViewImpl({
  filePath,
  hunk,
  threads,
  drafts,
  composerAt,
  ctx,
  callbacks,
  disableHighlight,
  onOpenComposer,
  onCloseComposer,
}: Props): JSX.Element {
  // Per-hunk lazy mount. While the hunk wrapper is far from the viewport,
  // render only a placeholder div with reserved height. Once it scrolls near,
  // mount the real rows + run hljs. This bounds React/DOM cost to roughly the
  // visible viewport regardless of how many files (or how large) are loaded,
  // which is the only way to get fluid scroll on big PRs without a
  // virtualization library.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  // Threads + composers inside this hunk break the simple "lines × row height"
  // estimate, so we just always mount when one is present. Also always mount
  // the always-tiny expansion hunks. `composerAt` is pre-filtered by the
  // parent — if it's non-null, the composer is in *this* hunk, so we don't
  // re-scan the lines here.
  const hasInlineContent = composerAt !== null;
  const hasThreadsInRange = useMemo(() => {
    for (const l of hunk.lines) {
      if (
        l.newLineNumber !== undefined &&
        threads.byKey.has(threadsForLineKey('AFTER', l.newLineNumber))
      ) {
        return true;
      }
      if (
        l.oldLineNumber !== undefined &&
        threads.byKey.has(threadsForLineKey('BEFORE', l.oldLineNumber))
      ) {
        return true;
      }
    }
    return false;
  }, [hunk, threads]);
  const mustMount =
    mounted || hunk.isExpansion || hasInlineContent || hasThreadsInRange;

  useEffect(() => {
    if (mustMount) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          io.disconnect();
        }
      },
      // Generous buffer so hunks pre-render before they hit the viewport;
      // combined with the row-level content-visibility, this gives smooth
      // scroll without visible "popping in."
      { rootMargin: '600px 0px 600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mustMount]);

  const placeholderHeight = useMemo(
    () =>
      (hunk.isExpansion ? 0 : HUNK_HEADER_PX) +
      hunk.lines.length * ROW_HEIGHT_PX,
    [hunk],
  );

  // Highlight every line in this hunk once; the result is memoized as long as
  // the hunk identity is stable (which it is — hunks are immutable values
  // produced in main). Passing language=null makes highlightLine fall back to
  // plain escapeHtml, which is what we want for very large files.
  //
  // Critically we skip the work entirely while the hunk is unmounted — there's
  // no point highlighting lines that aren't in the DOM, and that work is the
  // single biggest source of file-load freezes.
  const language = useMemo(
    () => (disableHighlight ? null : languageForPath(filePath)),
    [filePath, disableHighlight],
  );
  const highlighted = useMemo(() => {
    if (!mustMount) return [] as string[];
    return hunk.lines.map((l) => highlightLine(l.content, language));
  }, [hunk, language, mustMount]);

  if (!mustMount) {
    return (
      <div
        ref={wrapRef}
        className="hunk-wrap hunk-placeholder"
        style={{ height: placeholderHeight }}
      />
    );
  }

  return (
    <div ref={wrapRef} className="hunk-wrap">
      {!hunk.isExpansion && (
        <div className="hunk-header">
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </div>
      )}
      {hunk.lines.map((line, i) => {
        const sideForClick: RelativeFileVersion =
          line.type === 'del' ? 'BEFORE' : 'AFTER';
        const lineForClick =
          sideForClick === 'AFTER' ? line.newLineNumber : line.oldLineNumber;

        const afterThreads =
          line.newLineNumber !== undefined
            ? (threads.byKey.get(threadsForLineKey('AFTER', line.newLineNumber)) ?? [])
            : [];
        const beforeThreads =
          line.oldLineNumber !== undefined
            ? (threads.byKey.get(threadsForLineKey('BEFORE', line.oldLineNumber)) ?? [])
            : [];

        // composerAt is pre-filtered to this hunk by the parent, so we only
        // need to check whether this is the exact line/side it belongs on.
        const composerOpenHere =
          composerAt !== null &&
          composerAt.line === lineForClick &&
          composerAt.side === sideForClick;

        return (
          <Fragment key={`${hunk.oldStart}:${hunk.newStart}:${i}`}>
            <DiffLineRow
              line={line}
              highlightedHtml={highlighted[i] ?? ''}
              onAdd={
                lineForClick
                  ? () =>
                      onOpenComposer({
                        filePath,
                        line: lineForClick,
                        side: sideForClick,
                      })
                  : undefined
              }
            />
            {beforeThreads.map((t) => (
              <ThreadRow
                key={`bt-${t.threadId}`}
                thread={t}
                ctx={ctx}
                callbacks={callbacks}
              />
            ))}
            {afterThreads.map((t) => (
              <ThreadRow
                key={`at-${t.threadId}`}
                thread={t}
                ctx={ctx}
                callbacks={callbacks}
              />
            ))}
            {composerOpenHere && lineForClick !== undefined && (
              <ComposerRow
                location={{
                  filePath,
                  line: lineForClick,
                  side: sideForClick,
                }}
                drafts={drafts}
                ctx={ctx}
                callbacks={callbacks}
                onClose={onCloseComposer}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// Memoized: a HunkView only re-renders when its own props change. With
// FileDiffSection passing `composerAt === null` for hunks that don't contain
// the composer, and `ctx`/`callbacks` stabilized in PRDetail, the only
// triggers are: hunk content changed (immutable — never), threads/drafts
// index for this file changed (rare), or composerAt opened/closed on this
// hunk. So scrolling and active-file flips cause ZERO HunkView re-renders.
export const HunkView = memo(HunkViewImpl);

function DiffLineRow({
  line,
  highlightedHtml,
  onAdd,
}: {
  line: DiffLine;
  highlightedHtml: string;
  onAdd?: () => void;
}): JSX.Element {
  const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
  // Empty lines should still take a row's worth of vertical space.
  const html = highlightedHtml.length > 0 ? highlightedHtml : '&nbsp;';
  return (
    <div className={`drow drow-${line.type}`}>
      <div className="dgutter old">
        {line.oldLineNumber ?? ''}
        {onAdd && (
          <button
            className="add-comment-btn"
            onClick={onAdd}
            title="Comment on this line"
          >
            +
          </button>
        )}
      </div>
      <div className="dgutter new">{line.newLineNumber ?? ''}</div>
      <div className="dmark">{marker}</div>
      <div
        className="dcontent hljs"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function ThreadRow({
  thread,
  ctx,
  callbacks,
}: {
  thread: CommentThread;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
}): JSX.Element {
  const posting = ctx.postingThreadId === thread.threadId;
  return (
    <div className="drow drow-thread">
      <div className="thread-row-content">
        <InlineThread
          thread={thread}
          posting={posting}
          onReply={(content) => callbacks.onPostReply(thread.threadId, content)}
        />
      </div>
    </div>
  );
}

function ComposerRow({
  location,
  drafts,
  ctx,
  callbacks,
  onClose,
}: {
  location: ComposerLocation;
  drafts: DraftsByLine;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
  onClose: () => void;
}): JSX.Element {
  const existing = drafts.byKey.get(
    threadsForLineKey(location.side, location.line),
  );
  return (
    <div className="drow drow-composer">
      <div className="thread-row-content">
        <InlineComposer
          side={location.side}
          filePath={location.filePath}
          line={location.line}
          draftId={existing?.id}
          initialContent={existing?.content}
          posting={ctx.postingThreadId === '__composer__'}
          onPost={async (content) => {
            await callbacks.onPostComment({
              pullRequestId: ctx.pullRequestId,
              repositoryName: ctx.repositoryName,
              beforeCommitId: ctx.beforeCommitId,
              afterCommitId: ctx.afterCommitId,
              filePath: location.filePath,
              filePosition: location.line,
              relativeFileVersion: location.side,
              content,
            });
            if (existing) await callbacks.onDeleteDraft(existing.id);
            onClose();
          }}
          onSaveDraft={async (content) => {
            await callbacks.onSaveDraft({
              id: existing?.id,
              filePath: location.filePath,
              filePosition: location.line,
              relativeFileVersion: location.side,
              content,
            });
          }}
          onDeleteDraft={async () => {
            if (existing) await callbacks.onDeleteDraft(existing.id);
            onClose();
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
