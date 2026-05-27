import { useCallback, useMemo, useRef, useState } from 'react';
import type { PullRequestSummary, PullRequestTarget } from '@shared/types';
import { api, unwrap } from '../api';

type SortKey =
  | 'id'
  | 'title'
  | 'author'
  | 'lastActivityAt'
  | 'createdAt'
  | 'target';
type SortDir = 'asc' | 'desc';

interface Props {
  prs: PullRequestSummary[];
  repositoryName?: string;
  onOpen?: (pr: PullRequestSummary) => void;
}

export function PRList({ prs, repositoryName, onOpen }: Props): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('lastActivityAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  const sorted = useMemo(() => {
    const copy = [...prs];
    copy.sort((a, b) => cmp(a, b, sortKey) * (sortDir === 'asc' ? 1 : -1));
    return copy;
  }, [prs, sortKey, sortDir]);

  function toggleSort(key: SortKey): void {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir(key === 'title' || key === 'id' ? 'asc' : 'desc');
    }
  }

  // Move keyboard focus between PR rows. ArrowUp/Down + j/k cycle through the
  // focusable <tr> elements inside <tbody>. Wraps at top/bottom so j past the
  // last row returns to the first; matches how engineers expect a list to feel.
  const focusRow = useCallback((delta: number): void => {
    const tbody = tbodyRef.current;
    if (!tbody) return;
    const rows = Array.from(
      tbody.querySelectorAll<HTMLTableRowElement>('tr[tabindex="0"]'),
    );
    if (rows.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? rows.indexOf(active as HTMLTableRowElement) : -1;
    let next: number;
    if (idx === -1) {
      next = delta > 0 ? 0 : rows.length - 1;
    } else {
      next = (idx + delta + rows.length) % rows.length;
    }
    rows[next]?.focus();
  }, []);

  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>, pr: PullRequestSummary): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen?.(pr);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        focusRow(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        focusRow(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        const tbody = tbodyRef.current;
        tbody?.querySelector<HTMLTableRowElement>('tr[tabindex="0"]')?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        const tbody = tbodyRef.current;
        const rows = tbody?.querySelectorAll<HTMLTableRowElement>('tr[tabindex="0"]');
        rows?.[rows.length - 1]?.focus();
      }
    },
    [onOpen, focusRow],
  );

  // Lazy lookup + open. We don't pre-resolve every row's URL because the
  // provider call is over IPC; doing it on demand keeps the list mount cheap.
  const openExternal = useCallback(
    async (pr: PullRequestSummary): Promise<void> => {
      if (!repositoryName) return;
      try {
        const url = await unwrap(api.prs.webUrl(repositoryName, pr.id));
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      } catch {
        // Best-effort; the row still opens the in-app detail view.
      }
    },
    [repositoryName],
  );

  if (prs.length === 0) {
    return <div className="empty">No pull requests match the current filters.</div>;
  }

  return (
    <table className="prs">
      <thead>
        <tr>
          <Th label="ID" k="id" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
          <Th label="Title" k="title" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
          <Th label="Author" k="author" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
          <Th
            label="Target"
            k="target"
            sortKey={sortKey}
            sortDir={sortDir}
            onClick={toggleSort}
          />
          <th>Status</th>
          <th>Approval</th>
          <Th label="Updated" k="lastActivityAt" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
          {repositoryName && <th aria-label="External link"></th>}
        </tr>
      </thead>
      <tbody ref={tbodyRef}>
        {sorted.map((pr) => {
          const target = pr.targets[0];
          return (
            <tr
              key={pr.id}
              className="clickable"
              tabIndex={0}
              role="button"
              aria-label={`Pull request ${pr.id}: ${pr.title}`}
              onClick={() => onOpen?.(pr)}
              onKeyDown={(e) => onRowKeyDown(e, pr)}
            >
              <td className="id">#{pr.id}</td>
              <td>{pr.title}</td>
              <td className="id">{shortArn(pr.authorArn)}</td>
              <td className="target-cell">
                <BranchPair target={target} />
              </td>
              <td>
                {pr.status === 'CLOSED' && pr.mergeState === 'MERGED' ? (
                  <span className="badge MERGED">MERGED</span>
                ) : (
                  <span className={`badge ${pr.status}`}>{pr.status}</span>
                )}
              </td>
              <td>
                <span className={`badge ${pr.approvalState}`}>
                  {pr.approvalState.replace('_', ' ')}
                </span>
              </td>
              <td className="id">{fmtDate(pr.lastActivityAt)}</td>
              {repositoryName && (
                <td className="row-actions">
                  <button
                    type="button"
                    className="row-external"
                    title="Open in AWS CodeCommit console"
                    aria-label={`Open PR ${pr.id} in AWS CodeCommit console`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void openExternal(pr);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    ↗
                  </button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BranchPair({
  target,
}: {
  target: PullRequestTarget | undefined;
}): JSX.Element {
  if (!target) return <span className="hint">—</span>;
  const source = stripRefs(target.sourceReference);
  const dest = stripRefs(target.destinationReference);
  return (
    <span className="branch-pair">
      <code className="branch source" title={target.sourceReference || source}>
        {source || '?'}
      </code>
      <span className="branch-arrow">→</span>
      <code className="branch dest" title={target.destinationReference || dest}>
        {dest || '?'}
      </code>
    </span>
  );
}

function stripRefs(ref: string | undefined): string {
  if (!ref) return '';
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '');
}

function Th(props: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
}): JSX.Element {
  const active = props.sortKey === props.k;
  return (
    <th
      tabIndex={0}
      role="button"
      aria-sort={
        active ? (props.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      onClick={() => props.onClick(props.k)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onClick(props.k);
        }
      }}
    >
      {props.label}
      {active && <span className="arrow">{props.sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

function cmp(a: PullRequestSummary, b: PullRequestSummary, key: SortKey): number {
  switch (key) {
    case 'id':
      return numericCmp(a.id, b.id);
    case 'title':
      return a.title.localeCompare(b.title);
    case 'author':
      return (a.authorArn ?? '').localeCompare(b.authorArn ?? '');
    case 'lastActivityAt':
      return dateCmp(a.lastActivityAt, b.lastActivityAt);
    case 'createdAt':
      return dateCmp(a.createdAt, b.createdAt);
    case 'target': {
      // Group by destination first (where it's going) then by source (where
      // it's from). PRs landing on the same release branch end up adjacent.
      const ad = stripRefForCmp(a.targets[0]?.destinationReference);
      const bd = stripRefForCmp(b.targets[0]?.destinationReference);
      const byDest = ad.localeCompare(bd);
      if (byDest !== 0) return byDest;
      const as = stripRefForCmp(a.targets[0]?.sourceReference);
      const bs = stripRefForCmp(b.targets[0]?.sourceReference);
      return as.localeCompare(bs);
    }
  }
}

function stripRefForCmp(ref: string | undefined): string {
  if (!ref) return '';
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '');
}

function numericCmp(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

function dateCmp(a: string | undefined, b: string | undefined): number {
  return (a ? Date.parse(a) : 0) - (b ? Date.parse(b) : 0);
}

function shortArn(arn: string | undefined): string {
  if (!arn) return '';
  const slash = arn.lastIndexOf('/');
  return slash >= 0 ? arn.slice(slash + 1) : arn;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}
