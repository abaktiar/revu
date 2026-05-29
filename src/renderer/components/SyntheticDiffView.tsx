import { useCallback, useMemo, useState } from 'react';
import type { CommentDraft, CommentThread, FileDiffEntry } from '@shared/types';
import { ContinuousDiff } from './ContinuousDiff/ContinuousDiff';
import type { DiffCallbacks, DiffContext } from './ContinuousDiff/types';
import { syntheticDifferences } from '../syntheticDiff';

// Dev-only performance harness. Renders the real ContinuousDiff against the
// synthetic 50k-line fixture so huge-diff scroll/highlight performance can be
// regression-tested without a giant PR on AWS. Read-only — no comments, no AWS
// calls. Reached via Cmd/Ctrl+Shift+D in dev (see App.tsx).

const EMPTY_THREADS: CommentThread[] = [];
const EMPTY_DRAFTS: CommentDraft[] = [];
const EMPTY_PATHS = new Set<string>();
const NOOP_ASYNC = async (): Promise<void> => {};

export function SyntheticDiffView({
  onBack,
}: {
  onBack: () => void;
}): JSX.Element {
  const diff = useMemo(() => syntheticDifferences(), []);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const ctx: DiffContext = useMemo(
    () => ({
      pullRequestId: '',
      repositoryName: diff.repositoryName,
      beforeCommitId: diff.beforeCommitId,
      afterCommitId: diff.afterCommitId,
      postingThreadId: null,
      selfArn: undefined,
      readOnly: true,
    }),
    [diff],
  );

  const callbacks: DiffCallbacks = useMemo(
    () => ({
      onPostComment: NOOP_ASYNC,
      onPostReply: NOOP_ASYNC,
      onSaveDraft: NOOP_ASYNC,
      onDeleteDraft: NOOP_ASYNC,
      onDeleteComment: NOOP_ASYNC,
      onToggleReviewed: (_file: FileDiffEntry, _next: boolean) => {},
    }),
    [],
  );

  const onActiveFileChange = useCallback((path: string | null) => {
    setActiveFile(path);
  }, []);

  return (
    <div className="pr-detail">
      <div className="pr-toolbar">
        <button onClick={onBack}>← Back</button>
        <span className="pr-title">
          <span className="id">perf</span> Synthetic diff harness
        </span>
        <span className="hint">
          {diff.files.length} files · one is 50k lines (collapsed by default —
          expand it to stress the renderer)
        </span>
        <span className="grow" />
        {activeFile && <span className="hint">{activeFile}</span>}
      </div>
      <div className="pr-body">
        <div className="diff-area">
          <ContinuousDiff
            files={diff.files}
            threads={EMPTY_THREADS}
            drafts={EMPTY_DRAFTS}
            reviewedPaths={EMPTY_PATHS}
            ctx={ctx}
            callbacks={callbacks}
            onActiveFileChange={onActiveFileChange}
          />
        </div>
      </div>
    </div>
  );
}
