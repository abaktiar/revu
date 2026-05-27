import type { ApprovalState, PRStatus } from '@shared/types';

export type StatusFilter = 'OPEN' | 'CLOSED' | 'MERGED' | 'ALL';
export type ApprovalFilter = ApprovalState | 'ALL';

export interface FilterState {
  status: StatusFilter;
  approval: ApprovalFilter;
  search: string;
}

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
  onRefresh: () => void;
  // Streaming load state. When present, the Refresh button is swapped for a
  // compact "loaded / total · Cancel" chip so the user can see progress and
  // stop the load without leaving the filter bar.
  loading: {
    sessionId: string;
    loaded: number;
    total: number;
    kind: 'initial' | 'more';
  } | null;
  onCancel: () => void;
}

export function PRFilters({
  value,
  onChange,
  onRefresh,
  loading,
  onCancel,
}: Props): JSX.Element {
  return (
    <div className="filters">
      <label>
        Status&nbsp;
        <select
          value={value.status}
          onChange={(e) =>
            onChange({ ...value, status: e.target.value as StatusFilter })
          }
        >
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed (incl. merged)</option>
          <option value="MERGED">Merged only</option>
          <option value="ALL">All</option>
        </select>
      </label>
      <label>
        Approval&nbsp;
        <select
          value={value.approval}
          onChange={(e) =>
            onChange({ ...value, approval: e.target.value as ApprovalFilter })
          }
        >
          <option value="ALL">Any</option>
          <option value="APPROVED">Approved</option>
          <option value="NOT_APPROVED">Not approved</option>
          <option value="NO_RULES">No rules</option>
          <option value="UNKNOWN">Unknown</option>
        </select>
      </label>
      <input
        type="search"
        placeholder="Filter by title or author…"
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
        style={{ minWidth: 280 }}
      />
      <span className="grow" />
      {loading ? <LoadingChip loading={loading} onCancel={onCancel} /> : (
        <button className="primary" onClick={onRefresh}>
          Refresh
        </button>
      )}
    </div>
  );
}

// Compact loading chip rendered in place of Refresh while a streaming session
// is active. Shows "Loading 47 / 100" (or just "Loading 47" when total isn't
// known yet) plus a Cancel link. Includes a thin progress bar below the
// count when total is known.
function LoadingChip({
  loading,
  onCancel,
}: {
  loading: {
    sessionId: string;
    loaded: number;
    total: number;
    kind: 'initial' | 'more';
  };
  onCancel: () => void;
}): JSX.Element {
  const { loaded, total, kind } = loading;
  const label = kind === 'more' ? 'Loading more' : 'Loading';
  const counter = total > 0 ? `${loaded} / ${total}` : `${loaded}`;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  return (
    <div className="loading-chip" role="status" aria-live="polite">
      <div className="loading-chip-row">
        <span className="loading-chip-spinner" aria-hidden />
        <span className="loading-chip-text">
          {label} <strong>{counter}</strong>
        </span>
        <button className="loading-chip-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {total > 0 && (
        <div className="loading-chip-bar" aria-hidden>
          <div
            className="loading-chip-bar-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// The CodeCommit ListPullRequests API only filters by OPEN/CLOSED, so MERGED
// and ALL are mapped to CLOSED/undefined and the rest is filtered client-side.
export function statusForApi(s: StatusFilter): PRStatus | undefined {
  if (s === 'OPEN') return 'OPEN';
  if (s === 'CLOSED' || s === 'MERGED') return 'CLOSED';
  return undefined;
}
