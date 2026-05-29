import type {
  DiffHunk,
  DiffLine,
  FileDiff,
  FileDiffEntry,
  PRDifferences,
} from '@shared/types';
import { api, unwrap } from './api';

// Synthetic large-diff fixture for performance regression testing. It builds a
// real PRDifferences + per-file FileDiff entirely in the renderer so we can
// eyeball scroll/highlight performance on a 50k-line file without needing an
// actual giant PR on AWS.
//
// How it's wired: the diff components fetch per-file diffs through
// `loadFileDiff` (below) instead of calling `api.prs.fileDiff` directly. When a
// file's blob id starts with "synthetic", we short-circuit to generated data;
// every other blob id goes straight to the real IPC path. So the fixture
// exercises the exact same ContinuousDiff → FileDiffSection → HunkView render
// pipeline the real app uses — which is the whole point of a perf harness.
//
// Reach it in dev with Cmd/Ctrl+Shift+D (see App.tsx). Dev-only.

export const SYNTHETIC_REPO = 'synthetic';

// One genuinely huge file (the worst case the perf rule cares about) plus a
// handful of normal-sized ones so the file-tree / sidebar are exercised too.
const HUGE_LINE_COUNT = 50_000;
const SMALL_LINE_COUNT = 80;

export function syntheticDifferences(): PRDifferences {
  const files: FileDiffEntry[] = [];
  for (let i = 0; i < 5; i++) {
    files.push({
      path: `src/module-${i}/file-${i}.ts`,
      changeType: 'M',
      beforeBlobId: `synthetic-before-${i}`,
      afterBlobId: `synthetic-after-${i}`,
    });
  }
  files.push({
    path: 'src/generated/huge.ts',
    changeType: 'M',
    beforeBlobId: 'synthetic-before-huge',
    afterBlobId: 'synthetic-after-huge',
  });
  return {
    pullRequestId: '',
    repositoryName: SYNTHETIC_REPO,
    beforeCommitId: 'synthetic-before',
    afterCommitId: 'synthetic-after',
    files,
  };
}

export function isSyntheticBlob(blobId: string | undefined): boolean {
  return !!blobId && blobId.startsWith('synthetic');
}

function lineCountFor(entry: FileDiffEntry): number {
  return entry.path.includes('huge') ? HUGE_LINE_COUNT : SMALL_LINE_COUNT;
}

// Build one big hunk where lines alternate context/add/del so highlighting,
// gutters, and +/- markers are all exercised. content carries NO leading
// +/-/space — the renderer owns the marker column.
export function syntheticFileDiff(entry: FileDiffEntry): FileDiff {
  const count = lineCountFor(entry);
  const lines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (let i = 0; i < count; i++) {
    if (i % 9 === 0) {
      lines.push({
        type: 'add',
        newLineNumber: newNo++,
        content: `  const result_${i} = compute(${i}, options);`,
      });
    } else if (i % 13 === 0) {
      lines.push({
        type: 'del',
        oldLineNumber: oldNo++,
        content: `  const legacy_${i} = computeOld(${i});`,
      });
    } else {
      lines.push({
        type: 'context',
        oldLineNumber: oldNo++,
        newLineNumber: newNo++,
        content: `  function step_${i}(value: number): number { return value + ${i}; }`,
      });
    }
  }
  const hunk: DiffHunk = {
    oldStart: 1,
    oldLines: oldNo - 1,
    newStart: 1,
    newLines: newNo - 1,
    lines,
  };
  return {
    path: entry.path,
    beforePath: entry.beforePath,
    afterPath: entry.afterPath,
    changeType: entry.changeType,
    beforeBlobId: entry.beforeBlobId,
    afterBlobId: entry.afterBlobId,
    binary: false,
    oldTotalLines: oldNo - 1,
    newTotalLines: newNo - 1,
    hunks: [hunk],
  };
}

// The seam the diff components use. Synthetic blobs are served locally; all
// real blobs go through the normal IPC path. The synthetic check is a single
// string prefix test, so this is free on the production hot path.
export function loadFileDiff(
  repositoryName: string,
  entry: FileDiffEntry,
  opts?: { forceFresh?: boolean },
): Promise<FileDiff> {
  if (isSyntheticBlob(entry.afterBlobId) || isSyntheticBlob(entry.beforeBlobId)) {
    return Promise.resolve(syntheticFileDiff(entry));
  }
  return unwrap(api.prs.fileDiff(repositoryName, entry, opts));
}
