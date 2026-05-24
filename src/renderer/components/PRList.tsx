import { useMemo, useState } from 'react';
import type { PullRequestSummary } from '@shared/types';

type SortKey = 'id' | 'title' | 'author' | 'lastActivityAt' | 'createdAt';
type SortDir = 'asc' | 'desc';

interface Props {
  prs: PullRequestSummary[];
  onOpen?: (pr: PullRequestSummary) => void;
}

export function PRList({ prs, onOpen }: Props): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('lastActivityAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

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
          <th>Status</th>
          <th>Approval</th>
          <Th label="Updated" k="lastActivityAt" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((pr) => (
          <tr
            key={pr.id}
            className="clickable"
            onClick={() => onOpen?.(pr)}
          >
            <td className="id">#{pr.id}</td>
            <td>{pr.title}</td>
            <td className="id">{shortArn(pr.authorArn)}</td>
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
          </tr>
        ))}
      </tbody>
    </table>
  );
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
    <th onClick={() => props.onClick(props.k)}>
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
  }
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
