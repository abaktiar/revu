import { structuredPatch } from 'diff';
import type {
  DiffChangeType,
  DiffHunk,
  DiffLine,
  FileDiff,
} from '@shared/types';

const CONTEXT_LINES = 3;

export interface ComputeFileDiffInput {
  path: string;
  beforePath?: string;
  afterPath?: string;
  changeType: DiffChangeType;
  beforeBlobId?: string;
  afterBlobId?: string;
  beforeText: string | null; // null when the file didn't exist on that side
  afterText: string | null;
  binary: boolean;
  // Collapse whitespace-only changes (the "hide whitespace" toggle).
  ignoreWhitespace?: boolean;
}

export function computeFileDiff(input: ComputeFileDiffInput): FileDiff {
  const oldText = input.beforeText ?? '';
  const newText = input.afterText ?? '';
  const oldTotalLines = countLines(oldText);
  const newTotalLines = countLines(newText);

  if (input.binary) {
    return {
      path: input.path,
      beforePath: input.beforePath,
      afterPath: input.afterPath,
      changeType: input.changeType,
      beforeBlobId: input.beforeBlobId,
      afterBlobId: input.afterBlobId,
      binary: true,
      oldTotalLines,
      newTotalLines,
      hunks: [],
    };
  }

  // structuredPatch returns hunks in unified-diff form. context controls how
  // many surrounding context lines each hunk includes; expansion fetches more.
  const patch = structuredPatch(
    input.beforePath ?? input.path,
    input.afterPath ?? input.path,
    oldText,
    newText,
    '',
    '',
    { context: CONTEXT_LINES, ignoreWhitespace: input.ignoreWhitespace },
  );

  const hunks: DiffHunk[] = patch.hunks.map(toRichHunk);
  return {
    path: input.path,
    beforePath: input.beforePath,
    afterPath: input.afterPath,
    changeType: input.changeType,
    beforeBlobId: input.beforeBlobId,
    afterBlobId: input.afterBlobId,
    binary: false,
    oldTotalLines,
    newTotalLines,
    hunks,
  };
}

function toRichHunk(h: {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}): DiffHunk {
  const lines: DiffLine[] = [];
  let oldCursor = h.oldStart;
  let newCursor = h.newStart;
  for (const raw of h.lines) {
    // The diff library prefixes each line with ' ', '+' or '-'. A trailing
    // "\ No newline at end of file" marker is emitted as a separate line — we
    // drop it; not worth surfacing in the UI for v1.
    if (raw.startsWith('\\')) continue;
    const marker = raw[0];
    const content = raw.slice(1);
    if (marker === '-') {
      lines.push({ type: 'del', oldLineNumber: oldCursor, content });
      oldCursor += 1;
    } else if (marker === '+') {
      lines.push({ type: 'add', newLineNumber: newCursor, content });
      newCursor += 1;
    } else {
      lines.push({
        type: 'context',
        oldLineNumber: oldCursor,
        newLineNumber: newCursor,
        content,
      });
      oldCursor += 1;
      newCursor += 1;
    }
  }
  return {
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines,
  };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  // Trailing newline shouldn't inflate the count.
  if (text.charCodeAt(text.length - 1) === 10) count--;
  return count;
}

export function sliceLines(
  text: string,
  fromLine: number, // 1-based inclusive
  toLine: number, // 1-based inclusive
): string[] {
  if (toLine < fromLine) return [];
  const lines = text.split('\n');
  // text.split('\n') leaves an empty string at the end if text ends with \n.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(Math.max(0, fromLine - 1), Math.min(lines.length, toLine));
}
