import { useState } from 'react';
import type { DiffHunk, DiffLine } from '@shared/types';
import { api, unwrap } from '../../api';

interface Props {
  repositoryName: string;
  beforeBlobId?: string;
  afterBlobId?: string;
  // Boundary line numbers on each side that bracket the gap. The gap covers
  // (prevOldEnd+1 … nextOldStart-1) on the before side and the matching span
  // on the after side.
  prevOldEnd: number;
  prevNewEnd: number;
  nextOldStart: number;
  nextNewStart: number;
  onInsert: (synthetic: DiffHunk) => void;
}

const EXPAND_CHUNK = 20;

export function ExpandGap({
  repositoryName,
  beforeBlobId,
  afterBlobId,
  prevOldEnd,
  prevNewEnd,
  nextOldStart,
  nextNewStart,
  onInsert,
}: Props): JSX.Element | null {
  const oldGap = Math.max(0, nextOldStart - prevOldEnd - 1);
  const newGap = Math.max(0, nextNewStart - prevNewEnd - 1);
  const gap = Math.max(oldGap, newGap);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (gap <= 0) return null;

  async function expand(direction: 'up' | 'down' | 'all'): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const requestedOld =
        direction === 'all'
          ? { from: prevOldEnd + 1, to: nextOldStart - 1 }
          : direction === 'up'
            ? {
                from: prevOldEnd + 1,
                to: Math.min(nextOldStart - 1, prevOldEnd + EXPAND_CHUNK),
              }
            : {
                from: Math.max(prevOldEnd + 1, nextOldStart - EXPAND_CHUNK),
                to: nextOldStart - 1,
              };

      const offset = prevNewEnd - prevOldEnd; // line-number delta from before → after
      const requestedNew = {
        from: requestedOld.from + offset,
        to: requestedOld.to + offset,
      };

      // Fetch the before-side slice (after side will derive from same content
      // for context lines — they're unchanged by definition between hunks).
      const blobId = beforeBlobId ?? afterBlobId;
      if (!blobId) return;
      const side: 'before' | 'after' = beforeBlobId ? 'before' : 'after';
      const res = await unwrap(
        api.prs.expandLines({
          repositoryName,
          blobId,
          side,
          fromLine: side === 'before' ? requestedOld.from : requestedNew.from,
          toLine: side === 'before' ? requestedOld.to : requestedNew.to,
        }),
      );
      if (res.lines.length === 0) return;

      const lines: DiffLine[] = res.lines.map((content, i) => ({
        type: 'context',
        oldLineNumber: requestedOld.from + i,
        newLineNumber: requestedNew.from + i,
        content,
      }));

      const synthetic: DiffHunk = {
        oldStart: requestedOld.from,
        oldLines: res.lines.length,
        newStart: requestedNew.from,
        newLines: res.lines.length,
        lines,
        isExpansion: true,
      };
      onInsert(synthetic);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="expand-gap">
      <div className="dgutter old">…</div>
      <div className="dgutter new">…</div>
      <div className="dmark"></div>
      <div className="expand-controls">
        {gap > EXPAND_CHUNK * 2 ? (
          <>
            <button disabled={busy} onClick={() => void expand('up')}>
              ↑ Expand {EXPAND_CHUNK}
            </button>
            <button disabled={busy} onClick={() => void expand('down')}>
              ↓ Expand {EXPAND_CHUNK}
            </button>
          </>
        ) : null}
        <button disabled={busy} onClick={() => void expand('all')}>
          Expand all {gap} line{gap === 1 ? '' : 's'}
        </button>
        {err && <span className="hint warn">{err}</span>}
      </div>
    </div>
  );
}
