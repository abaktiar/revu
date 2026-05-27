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

type Direction = 'up' | 'down' | 'all';

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

  // Are the up/down edge expanders meaningful? Only when there's enough
  // hidden room left to make a 20-line chunk worth offering separately.
  // Both directions are always valid:
  //   ↑ pulls 20 lines from the TOP of the gap (immediately after the
  //     previous hunk, or — for a leading gap — the first 20 lines of the
  //     file, which is exactly what users need to inspect "initial lines").
  //   ↓ pulls 20 lines from the BOTTOM of the gap (immediately before the
  //     next hunk, useful context-before-change).
  const showEdgeExpanders = gap > EXPAND_CHUNK * 2;

  async function expand(direction: Direction): Promise<void> {
    if (busy) return;
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

  // Clicking the band itself: if the whole gap fits in one chunk, expand it
  // all; otherwise pull from the top of the gap by default. That matches the
  // GitHub/VS Code default and gives the user immediate progress regardless
  // of whether this is a leading, trailing, or between-hunks gap.
  const bandClickDirection: Direction = gap <= EXPAND_CHUNK ? 'all' : 'up';

  const label =
    gap === 1 ? '1 hidden line' : `${gap.toLocaleString()} hidden lines`;

  return (
    <div
      className={`expand-gap${busy ? ' is-busy' : ''}`}
      role="group"
      aria-label={`Expand ${label}`}
    >
      {showEdgeExpanders ? (
        <button
          className="expand-edge expand-up"
          disabled={busy}
          onClick={() => void expand('up')}
          aria-label={`Expand ${EXPAND_CHUNK} lines up`}
          title={`Expand ${EXPAND_CHUNK} lines up`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2.5 7.5L6 4l3.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <span className="expand-edge expand-edge-spacer" aria-hidden="true" />
      )}

      <button
        className="expand-band"
        disabled={busy}
        onClick={() => void expand(bandClickDirection)}
        title={
          gap <= EXPAND_CHUNK
            ? `Expand all ${label}`
            : `Expand ${EXPAND_CHUNK} lines (${label} hidden)`
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
          className="expand-band-icon"
        >
          <path
            d="M3.5 5L7 1.5 10.5 5M3.5 9L7 12.5 10.5 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="expand-band-label">{label}</span>
      </button>

      {showEdgeExpanders ? (
        <button
          className="expand-edge expand-down"
          disabled={busy}
          onClick={() => void expand('down')}
          aria-label={`Expand ${EXPAND_CHUNK} lines down`}
          title={`Expand ${EXPAND_CHUNK} lines down`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2.5 4.5L6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <span className="expand-edge expand-edge-spacer" aria-hidden="true" />
      )}

      {err && (
        <span className="hint warn" role="alert">
          {err}
        </span>
      )}
    </div>
  );
}
