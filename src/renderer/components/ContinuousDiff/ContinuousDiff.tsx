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
import { fileDiffSemaphore } from '../../concurrency';
import type {
  ComposerLocation,
  DiffCallbacks,
  DiffContext,
  DiffSearchMatch,
  RevealTarget,
} from './types';
import type { FileDiff } from '@shared/types';

interface Props {
  files: FileDiffEntry[];
  threads: CommentThread[];
  drafts: CommentDraft[];
  reviewedPaths: Set<string>;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
  onActiveFileChange: (path: string | null) => void;
  // Fired whenever a file's loaded diff is registered/unregistered, so the
  // in-diff find can reconcile its match set as files stream in.
  onDiffsChanged?: () => void;
}

export interface ContinuousDiffHandle {
  scrollToFile: (path: string, opts?: ScrollIntoViewOptions) => void;
  scrollToFileBy: (offset: number) => void;
  // Jump between comment threads (n / N) and between changed hunks (] / [).
  // dir > 0 moves forward, dir < 0 backward; both wrap around the ends.
  scrollToAdjacentComment: (dir: number) => void;
  scrollToAdjacentChange: (dir: number) => void;
  // In-diff find: returns the files whose loaded diff contains `query`
  // (case-insensitive), ordered by file position, with per-file match counts.
  // Searches the already-loaded diff data (every file is background-loaded on
  // open), so it covers content that isn't currently painted.
  searchFiles: (query: string) => DiffSearchMatch[];
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
      onDiffsChanged,
    },
    ref,
  ) {
    const [composerAt, setComposerAt] = useState<ComposerLocation | null>(null);
    // Pending "scroll to this thread" request. Only the matching FileDiffSection
    // acts on it; everyone else gets `null` so their memo stays intact.
    const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null);
    const revealNonceRef = useRef(0);
    const clearReveal = useCallback(() => setRevealTarget(null), []);
    const containerRef = useRef<HTMLDivElement | null>(null);
    // Last element each nav landed on, so repeated n/N or ]/[ steps advance
    // through the list rather than re-finding the nearest one.
    const commentNavRef = useRef<HTMLElement | null>(null);
    const changeNavRef = useRef<HTMLElement | null>(null);
    const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
    // Loaded per-file diffs, reported by each FileDiffSection, so the in-diff
    // find can search content that isn't currently painted.
    const diffsRef = useRef<Map<string, FileDiff>>(new Map());
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

    // Stable ref so registerDiff (and thus FileDiffSection's prop) keeps its
    // identity even as onDiffsChanged changes across parent renders.
    const onDiffsChangedRef = useRef(onDiffsChanged);
    useEffect(() => {
      onDiffsChangedRef.current = onDiffsChanged;
    }, [onDiffsChanged]);

    const registerDiff = useCallback(
      (path: string, diff: FileDiff | null) => {
        if (diff) diffsRef.current.set(path, diff);
        else diffsRef.current.delete(path);
        onDiffsChangedRef.current?.();
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

    // ---- Scroll-anchor pin loop --------------------------------------------
    // Every file background-loads on open, but an unloaded section is only a
    // small "Loading diff…" placeholder until its diff arrives, then it grows to
    // full height. So clicking a file low in the list and scrolling to it once
    // lands in the wrong place: as the files ABOVE the target stream in, they
    // expand and shove the target downward. A single (even repeated-on-own-load)
    // scroll can't fix that — the drift comes from other sections loading after
    // the target already settled.
    //
    // The pin loop keeps the clicked target glued to the top of the scroller,
    // re-correcting every frame, until the files above it have all loaded and
    // its position is stable (or the user takes manual control). This is the
    // "scroll anchoring" the browser can't do for us here because programmatic
    // scrollIntoView defeats overflow-anchor.
    const pinRafRef = useRef<number | null>(null);
    const pinCleanupRef = useRef<(() => void) | null>(null);

    const stopPin = useCallback((): void => {
      if (pinRafRef.current !== null) {
        cancelAnimationFrame(pinRafRef.current);
        pinRafRef.current = null;
      }
      if (pinCleanupRef.current) {
        pinCleanupRef.current();
        pinCleanupRef.current = null;
      }
    }, []);

    // Pin `path` (and, for a thread reveal, the thread row once it renders) to
    // the top/center of the scroller until layout settles. threadId === null is
    // a plain file navigation; threadId set additionally tracks the comment row
    // as the file expands.
    const pinToTarget = useCallback(
      (path: string, threadId: string | null): void => {
        const sc = containerRef.current;
        if (!sc) return;
        stopPin();

        const order = orderRef.current;
        const idx = order.indexOf(path);

        // Hoist the target's (still-queued) background fetch to the front so the
        // file the user just clicked loads next instead of waiting behind every
        // other file. Also nudge the few files just after it forward, since a
        // reviewer reads downward from where they landed. Cheap no-op for files
        // already loading or loaded.
        if (idx !== -1) {
          for (let i = Math.min(idx + 2, order.length - 1); i >= idx; i--) {
            fileDiffSemaphore.prioritize(order[i]!);
          }
        }
        const aboveLoaded = (): boolean => {
          for (let i = 0; i < idx; i++) {
            if (!diffsRef.current.has(order[i]!)) return false;
          }
          return true;
        };

        const reduced = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches;

        // Fast path: plain navigation with every file above already loaded —
        // there's no pending drift, so a single smooth scroll is reliable and
        // feels better than an instant jump.
        if (threadId === null && aboveLoaded()) {
          nodesRef.current.get(path)?.scrollIntoView({
            behavior: reduced ? 'auto' : 'smooth',
            block: 'start',
          });
          return;
        }

        const getTarget = (): {
          el: HTMLElement;
          block: 'start' | 'center';
        } | null => {
          if (threadId) {
            const row = sc.querySelector<HTMLElement>(
              `[data-thread-id="${CSS.escape(threadId)}"]`,
            );
            if (row) return { el: row, block: 'center' };
          }
          const sec = nodesRef.current.get(path);
          return sec ? { el: sec, block: 'start' } : null;
        };

        const deltaFor = (el: HTMLElement, block: 'start' | 'center'): number => {
          const scRect = sc.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          if (block === 'center') {
            const desired =
              scRect.top + sc.clientHeight / 2 - elRect.height / 2;
            return elRect.top - desired;
          }
          return elRect.top - scRect.top;
        };

        // The instant the user takes manual control, abandon the pin so we never
        // fight their scrolling. Setting scrollTop ourselves does not emit these
        // events, so the loop's own corrections won't cancel it.
        const onUserScroll = (): void => stopPin();
        const evOpts: AddEventListenerOptions = { passive: true };
        sc.addEventListener('wheel', onUserScroll, evOpts);
        sc.addEventListener('touchstart', onUserScroll, evOpts);
        sc.addEventListener('pointerdown', onUserScroll, evOpts);
        pinCleanupRef.current = () => {
          sc.removeEventListener('wheel', onUserScroll, evOpts);
          sc.removeEventListener('touchstart', onUserScroll, evOpts);
          sc.removeEventListener('pointerdown', onUserScroll, evOpts);
        };

        // Hard cap so a never-loading file (e.g. an errored section above the
        // target) can't pin forever.
        const deadline = performance.now() + 10000;
        let stable = 0;

        const tick = (): void => {
          pinRafRef.current = null;
          const t = getTarget();
          if (t) {
            const delta = deltaFor(t.el, t.block);
            const before = sc.scrollTop;
            if (Math.abs(delta) > 0.5) sc.scrollTop += delta;
            // Base "settled" on whether the scroll actually moved, not on the
            // delta. A target that can't reach the requested position (the last
            // file, with not enough content below it to push it to the top)
            // would report a permanent delta and never settle; the clamped
            // scrollTop not moving is the real "as close as we can get" signal.
            if (Math.abs(sc.scrollTop - before) > 0.5) stable = 0;
            else stable++;
            // Settled = position held for a few frames AND everything that could
            // still push the target (the files above it) is in place. For a
            // thread reveal we normally wait for the row itself to render and
            // center (block === 'center'); but if it never shows (an outdated
            // comment whose line isn't in the current diff) we still stop once
            // the file is stably parked at the top — scrolling to the file is
            // the best we can do there.
            const onRow = threadId === null || t.block === 'center';
            const settled =
              aboveLoaded() && (onRow ? stable >= 4 : stable >= 30);
            if (settled || performance.now() > deadline) {
              stopPin();
              return;
            }
          } else if (performance.now() > deadline) {
            stopPin();
            return;
          }
          pinRafRef.current = requestAnimationFrame(tick);
        };
        pinRafRef.current = requestAnimationFrame(tick);
      },
      [stopPin],
    );

    // Drop any in-flight pin if the file set changes (PR switch) or on unmount.
    useEffect(() => stopPin, [files, stopPin]);

    useImperativeHandle(
      ref,
      () => {
        // File navigation (sidebar click, j/k, finder): hand off entirely to the
        // pin loop, which keeps the target glued to the top as files above it
        // stream in. No reveal request — the section is already eager-loaded, so
        // there's nothing for it to do but be positioned, and a second scroller
        // would just fight the pin.
        const scrollToFile = (path: string): void => {
          pinToTarget(path, null);
        };
        const scrollToFileBy = (offset: number): void => {
          const ordered = orderRef.current;
          const active = ordered.find((p) => visibleRef.current.has(p));
          let target: string | undefined;
          if (!active) {
            target = offset > 0 ? ordered[0] : ordered[ordered.length - 1];
          } else {
            const idx = ordered.indexOf(active);
            const targetIdx = Math.min(
              Math.max(idx + offset, 0),
              ordered.length - 1,
            );
            target = ordered[targetIdx];
          }
          if (target) pinToTarget(target, null);
        };
        // Thread reveal (activity timeline): the section still force-expands +
        // flashes the row (driven by the reveal request), while the pin loop
        // owns the scrolling so the row lands accurately even as the file loads.
        const scrollToComment = (threadId: string, filePath: string): void => {
          revealNonceRef.current += 1;
          setRevealTarget({
            filePath,
            threadId,
            nonce: revealNonceRef.current,
          });
          pinToTarget(filePath, threadId);
        };
        // Step through a set of elements (comment rows or change hunks) by
        // document order. Tracks the last landed element so repeated presses
        // advance; falls back to the nearest element past the top edge when the
        // tracked one is gone. Both directions wrap around the ends.
        const scrollToAdjacent = (
          selector: string,
          navRef: { current: HTMLElement | null },
          dir: number,
        ): void => {
          const root = containerRef.current;
          if (!root) return;
          const nodes = Array.from(
            root.querySelectorAll<HTMLElement>(selector),
          );
          if (nodes.length === 0) return;
          const rootRect = root.getBoundingClientRect();
          // Treat the last-landed element as the cursor only while it's still
          // on-screen. If the user has scrolled away from it (sections are
          // never unmounted, so the node is still in the list), re-anchor to
          // the viewport instead of jumping relative to a far-off element.
          const trackedIdx = navRef.current
            ? nodes.indexOf(navRef.current)
            : -1;
          let trackedOnScreen = false;
          if (trackedIdx !== -1) {
            const r = nodes[trackedIdx]!.getBoundingClientRect();
            trackedOnScreen = r.bottom > rootRect.top && r.top < rootRect.bottom;
          }
          let idx: number;
          if (trackedOnScreen) {
            idx = (trackedIdx + dir + nodes.length) % nodes.length;
          } else {
            const refTop = rootRect.top;
            if (dir >= 0) {
              idx = nodes.findIndex(
                (n) => n.getBoundingClientRect().top > refTop + 4,
              );
              if (idx === -1) idx = 0;
            } else {
              idx = nodes.length - 1;
              for (let i = nodes.length - 1; i >= 0; i--) {
                if (nodes[i]!.getBoundingClientRect().top < refTop - 4) {
                  idx = i;
                  break;
                }
              }
            }
          }
          const target = nodes[idx];
          if (!target) return;
          navRef.current = target;
          const reduced = window.matchMedia(
            '(prefers-reduced-motion: reduce)',
          ).matches;
          target.scrollIntoView({
            behavior: reduced ? 'auto' : 'smooth',
            block: 'center',
          });
        };
        const scrollToAdjacentComment = (dir: number): void =>
          scrollToAdjacent('[data-thread-id]', commentNavRef, dir);
        const scrollToAdjacentChange = (dir: number): void =>
          scrollToAdjacent('[data-change-hunk]', changeNavRef, dir);
        const searchFiles = (query: string): DiffSearchMatch[] => {
          const q = query.trim().toLowerCase();
          if (!q) return [];
          const matches: DiffSearchMatch[] = [];
          for (const path of orderRef.current) {
            const diff = diffsRef.current.get(path);
            if (!diff) continue;
            let count = 0;
            for (const hunk of diff.hunks) {
              for (const line of hunk.lines) {
                if (line.content.toLowerCase().includes(q)) count++;
              }
            }
            if (count > 0) matches.push({ path, count });
          }
          return matches;
        };
        return {
          scrollToFile,
          scrollToFileBy,
          scrollToComment,
          scrollToAdjacentComment,
          scrollToAdjacentChange,
          searchFiles,
        };
      },
      [pinToTarget],
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
      <div className="continuous-diff" ref={containerRef}>
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
              registerDiff={registerDiff}
            />
          );
        })}
      </div>
    );
  },
);
