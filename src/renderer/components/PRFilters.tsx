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
  busy: boolean;
}

export function PRFilters({ value, onChange, onRefresh, busy }: Props): JSX.Element {
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
      <button className="primary" onClick={onRefresh} disabled={busy}>
        {busy ? 'Loading…' : 'Refresh'}
      </button>
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
