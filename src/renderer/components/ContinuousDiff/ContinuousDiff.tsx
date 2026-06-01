import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CommentDraft,
  CommentThread,
  FileDiffEntry,
} from '@shared/types';
import { FileDiffSection } from './FileDiffSection';
import type {
  ComposerLocation,
  DiffCallbacks,
  DiffContext,
  RevealTarget,
} from './types';

interface Props {
  files: FileDiffEntry[];
  threads: CommentThread[];
  drafts: CommentDraft[];
  reviewedPaths: Set<string>;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
  onActiveFileChange: (path: string | null) => void;
}

export interface ContinuousDiffHandle {
  scrollToFile: (path: string, opts?: ScrollIntoViewOptions) => void;
  scrollToFileBy: (offset: number) => void;
  // Bring a specific comment thread into view — used by the Activity timeline.
  // Loads + expands the containing file as needed, then scrolls to + briefly
  // highlights the thread. No-op if the file isn't part of the current diff.
  scrollToComment: (
    threadId: string,
    filePath: string,
    opts?: ScrollIntoViewOptions,
  ) => void;
}

// Stable empty refs so memoized children that get an "I have no threads/drafts
// for this file" array don't see a new [] each render.
const EMPTY_THREADS: CommentThread[] = [];
const EMPTY_DRAFTS: CommentDraft[] = [];

export const ContinuousDiff = forwardRef<ContinuousDiffHandle, Props>(
  function ContinuousDiff(
    {
      files,
      threads,
      drafts,
      reviewedPaths,
      ctx,
      callbacks,
      onActiveFileChange,
    },
    ref,
  ) {
    const [composerAt, setComposerAt] = useState<ComposerLocation | null>(null);
    // Pending "scroll to this thread" request. Only the matching FileDiffSection
    // acts on it; everyone else gets `null` so their memo stays intact.
    const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null);
    const revealNonceRef = useRef(0);
    const clearReveal = useCallback(() => setRevealTarget(null), []);
    const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const visibleRef = useRef<Set<string>>(new Set());
    const orderRef = useRef<string[]>([]);
    // Remember the last active path we reported so we only call up to the
    // parent when it actually changes. The IntersectionObserver fires many
    // times per second during scroll; without this guard, every flip caused
    // setActiveFile in PRDetail → re-render of PRDetail → re-render of every
    // mounted FileDiffSection. That was the dominant scroll-time cost.
    const lastActiveRef = useRef<string | null>(null);

    // Keep orderRef in sync with the files array. Done in an effect, not
    // during render, so concurrent renders don't observe a half-written ref.
    useEffect(() => {
      orderRef.current = files.map((f) => f.path);
    }, [files]);

    const registerNode = useCallback(
      (path: string, el: HTMLDivElement | null) => {
        if (el) nodesRef.current.set(path, el);
        else nodesRef.current.delete(path);
      },
      [],
    );

    // rAF-coalesced visibility recompute. Many sections can flip visibility in
    // the same scroll frame; we used to run a linear `.find()` per flip and
    // possibly call setActiveFile up-tree, which kicks off a render. Now we
    // schedule at most one recompute per animation frame, which means at most
    // one parent re-render per frame regardless of how many sections crossed
    // the viewport edge in that frame.
    const rafPendingRef = useRef<number | null>(null);
    const onActiveFileChangeRef = useRef(onActiveFileChange);
    useEffect(() => {
      onActiveFileChangeRef.current = onActiveFileChange;
    }, [onActiveFileChange]);

    const scheduleActiveRecompute = useCallback((): void => {
      if (rafPendingRef.current !== null) return;
      rafPendingRef.current = requestAnimationFrame(() => {
        rafPendingRef.current = null;
        const ordered = orderRef.current;
        // Topmost file currently visible. Linear scan — files are an array of
        // paths so this is O(N) worst case, but only once per frame.
        let active: string | null = null;
        for (const p of ordered) {
          if (visibleRef.current.has(p)) {
            active = p;
            break;
          }
        }
        if (active !== lastActiveRef.current) {
          lastActiveRef.current = active;
          onActiveFileChangeRef.current(active);
        }
      });
    }, []);

    useEffect(() => {
      return () => {
        if (rafPendingRef.current !== null) {
          cancelAnimationFrame(rafPendingRef.current);
          rafPendingRef.current = null;
        }
      };
    }, []);

    const onVisibilityChange = useCallback(
      (path: string, visible: boolean) => {
        if (visible) visibleRef.current.add(path);
        else visibleRef.current.delete(path);
        scheduleActiveRecompute();
      },
      [scheduleActiveRecompute],
    );

    // Threads / drafts grouped by file path for O(1) lookup per section.
    const threadsByPath = useMemo(() => {
      const m = new Map<string, CommentThread[]>();
      for (const t of threads) {
        if (!t.filePath) continue;
        const arr = m.get(t.filePath);
        if (arr) arr.push(t);
        else m.set(t.filePath, [t]);
      }
      return m;
    }, [threads]);

    const draftsByPath = useMemo(() => {
      const m = new Map<string, CommentDraft[]>();
      for (const d of drafts) {
        const arr = m.get(d.filePath);
        if (arr) arr.push(d);
        else m.set(d.filePath, [d]);
      }
      return m;
    }, [drafts]);

    useImperativeHandle(
      ref,
      () => {
        const scrollToFile = (
          path: string,
          opts?: ScrollIntoViewOptions,
        ): void => {
          const el = nodesRef.current.get(path);
          if (!el) return;
          const reduced = window.matchMedia(
            '(prefers-reduced-motion: reduce)',
          ).matches;
          el.scrollIntoView(
            opts ?? { behavior: reduced ? 'auto' : 'smooth', block: 'start' },
          );
        };
        const scrollToFileBy = (offset: number): void => {
          const ordered = orderRef.current;
          const active = ordered.find((p) => visibleRef.current.has(p));
          if (!active) {
            const target = offset > 0 ? ordered[0] : ordered[ordered.length - 1];
            if (target) scrollToFile(target);
            return;
          }
          const idx = ordered.indexOf(active);
          const targetIdx = Math.min(
            Math.max(idx + offset, 0),
            ordered.length - 1,
          );
          const target = ordered[targetIdx];
          if (target) scrollToFile(target);
        };
        const scrollToComment = (
          threadId: string,
          filePath: string,
          opts?: ScrollIntoViewOptions,
        ): void => {
          // Start moving toward the file right away (its <section> root is
          // always mounted), then hand the precise work to the matching
          // FileDiffSection: it force-loads + expands the file as needed and
          // scrolls to the exact thread once that row is in the DOM.
          scrollToFile(filePath, opts);
          revealNonceRef.current += 1;
          setRevealTarget({ filePath, threadId, nonce: revealNonceRef.current });
        };
        return { scrollToFile, scrollToFileBy, scrollToComment };
      },
      [],
    );

    useEffect(() => {
      // If composer is open for a file that's no longer in the list, drop it.
      if (composerAt && !files.some((f) => f.path === composerAt.filePath)) {
        setComposerAt(null);
      }
    }, [files, composerAt]);

    // Stable callbacks for FileDiffSection — these never change identity, so
    // they don't bust the React.memo on the section.
    const onOpenComposer = useCallback((loc: ComposerLocation): void => {
      setComposerAt(loc);
    }, []);
    const onCloseComposer = useCallback((): void => {
      setComposerAt(null);
    }, []);

    return (
      <div className="continuous-diff">
        {files.map((f) => {
          // Pass only the slice of composerAt that applies to this file.
          // For every other file the prop is `null` both before and after the
          // composer state change — so memoized sections skip rendering.
          const composerForFile =
            composerAt && composerAt.filePath === f.path ? composerAt : null;
          return (
            <FileDiffSection
              key={f.path}
              entry={f}
              threads={threadsByPath.get(f.path) ?? EMPTY_THREADS}
              drafts={draftsByPath.get(f.path) ?? EMPTY_DRAFTS}
              reviewed={reviewedPaths.has(f.path)}
              composerAt={composerForFile}
              ctx={ctx}
              callbacks={callbacks}
              reveal={
                revealTarget && revealTarget.filePath === f.path
                  ? revealTarget
                  : null
              }
              onRevealComplete={clearReveal}
              onOpenComposer={onOpenComposer}
              onCloseComposer={onCloseComposer}
              onVisibilityChange={onVisibilityChange}
              registerNode={registerNode}
            />
          );
        })}
      </div>
    );
  },
);
