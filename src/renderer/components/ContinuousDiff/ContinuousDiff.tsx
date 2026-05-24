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
}

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
    const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const visibleRef = useRef<Set<string>>(new Set());
    const orderRef = useRef<string[]>([]);

    orderRef.current = files.map((f) => f.path);

    const registerNode = useCallback((path: string, el: HTMLDivElement | null) => {
      if (el) nodesRef.current.set(path, el);
      else nodesRef.current.delete(path);
    }, []);

    const onVisibilityChange = useCallback(
      (path: string, visible: boolean) => {
        if (visible) visibleRef.current.add(path);
        else visibleRef.current.delete(path);
        // Active = topmost file currently visible.
        const ordered = orderRef.current;
        const active = ordered.find((p) => visibleRef.current.has(p)) ?? null;
        onActiveFileChange(active);
      },
      [onActiveFileChange],
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
          el.scrollIntoView(opts ?? { behavior: 'smooth', block: 'start' });
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
        return { scrollToFile, scrollToFileBy };
      },
      [],
    );

    useEffect(() => {
      // If composer is open for a file that's no longer in the list, drop it.
      if (composerAt && !files.some((f) => f.path === composerAt.filePath)) {
        setComposerAt(null);
      }
    }, [files, composerAt]);

    return (
      <div className="continuous-diff">
        {files.map((f) => (
          <FileDiffSection
            key={f.path}
            entry={f}
            threads={threadsByPath.get(f.path) ?? []}
            drafts={draftsByPath.get(f.path) ?? []}
            reviewed={reviewedPaths.has(f.path)}
            composerAt={composerAt}
            ctx={ctx}
            callbacks={callbacks}
            onOpenComposer={setComposerAt}
            onCloseComposer={() => setComposerAt(null)}
            onVisibilityChange={onVisibilityChange}
            registerNode={registerNode}
          />
        ))}
      </div>
    );
  },
);
