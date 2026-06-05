import { useCallback, useMemo, useRef, useState } from 'react';
import type { PullRequestSummary, PullRequestTarget } from '@shared/types';
import { api, unwrap } from '../api';
import {
  GitPullRequest,
  GitMerge,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  ExternalLink,
  Check,
} from '../icons';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';

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

  const [contextMenu, setContextMenu] = useState<{
    pr: PullRequestSummary;
    cellValue: string;
    x: number;
    y: number;
  } | null>(null);

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
  const copyWebUrl = useCallback(
    async (pr: PullRequestSummary): Promise<void> => {
      if (!repositoryName) return;
      try {
        const url = await unwrap(api.prs.webUrl(repositoryName, pr.id));
        if (url) void navigator.clipboard.writeText(url);
      } catch {
        // Best-effort
      }
    },
    [repositoryName],
  );

  // Resolves the AWS URL lazily (same IPC call as the bare-link copy) and
  // writes a tab-separated row to the clipboard — the same shape you'd
  // get from selecting the row in the AWS CodeCommit web PR list. The
  // URL isn't part of any visible cell in the table, so we tack it on
  // at the end of the row so the share actually contains a clickable
  // link. Pasting into Slack/Teams/email/spreadsheet all "just work"
  // because every cell is just the raw value separated by a tab.
  const copyRow = useCallback(
    async (pr: PullRequestSummary): Promise<void> => {
      let url: string | undefined;
      if (repositoryName) {
        try {
          const resolved = await unwrap(api.prs.webUrl(repositoryName, pr.id));
          url = resolved || undefined;
        } catch {
          // URL is optional in the row copy; missing is fine.
        }
      }
      try {
        await navigator.clipboard.writeText(formatRowForClipboard(pr, url));
      } catch {
        // Clipboard can fail in restricted contexts; silently no-op.
      }
    },
    [repositoryName],
  );

  const buildContextMenu = useCallback(
    (pr: PullRequestSummary, cellValue: string): ContextMenuItem[] => [
      {
        label: 'Copy Cell Value',
        action: () => void navigator.clipboard.writeText(cellValue),
        icon: <Copy size={14} />,
      },
      {
        label: 'Copy Row',
        action: () => void copyRow(pr),
        icon: <FileText size={14} />,
        feedback: {
          label: 'Copied',
          icon: <Check size={14} />,
        },
      },
      ...(repositoryName
        ? [
            {
              label: 'Copy AWS PR Link',
              action: () => void copyWebUrl(pr),
              icon: <ExternalLink size={14} />,
              feedback: {
                label: 'Copied',
                icon: <Check size={14} />,
              },
            },
          ]
        : []),
    ],
    [repositoryName, copyWebUrl, copyRow],
  );

  if (prs.length === 0) {
    return <div className="empty">No pull requests match the current filters.</div>;
  }

  return (
    <>
    <table className="prs">
      <thead>
        <tr>
          <Th label="#" k="id" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
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
        </tr>
      </thead>
      <tbody ref={tbodyRef}>
        {sorted.map((pr) => {
          const target = pr.targets[0];
          const authorName = shortArn(pr.authorArn);
          return (
            <tr
              key={pr.id}
              className="clickable"
              tabIndex={0}
              role="button"
              aria-label={`Pull request ${pr.id}: ${pr.title}`}
              onClick={() => onOpen?.(pr)}
              onKeyDown={(e) => onRowKeyDown(e, pr)}
              onContextMenu={(e) => {
                e.preventDefault();
                const cellText = (e.target as HTMLElement).closest('td')?.textContent?.trim() ?? '';
                setContextMenu({ pr, cellValue: cellText, x: e.clientX, y: e.clientY });
              }}
            >
              <td className="cell-id">#{pr.id}</td>
              <td className="cell-title">
                <span className="pr-title-icon" aria-hidden>
                  {pr.status === 'CLOSED' && pr.mergeState === 'MERGED' ? (
                    <GitMerge size={14} />
                  ) : (
                    <GitPullRequest size={14} />
                  )}
                </span>
                <span className="pr-title-text">{pr.title}</span>
              </td>
              <td className="cell-author" title={pr.authorArn ?? authorName}>
                {authorName}
              </td>
              <td className="cell-target">
                <BranchPair target={target} />
              </td>
              <td className="cell-status">
                {pr.status === 'CLOSED' && pr.mergeState === 'MERGED' ? (
                  <StatusBadge kind="merged" />
                ) : (
                  <StatusBadge kind={pr.status.toLowerCase() as StatusKind} />
                )}
              </td>
              <td className="cell-approval">
                <StatusBadge
                  kind={pr.approvalState.toLowerCase() as StatusKind}
                />
              </td>
              <td className="cell-updated" title={pr.lastActivityAt}>
                {fmtRel(pr.lastActivityAt)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {contextMenu && (
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        items={buildContextMenu(contextMenu.pr, contextMenu.cellValue)}
        onClose={() => setContextMenu(null)}
      />
    )}
    </>
  );
}

// Ghost table shown while the first page of a fresh stream is still in flight
// (list empty, session active). It carries the real column header and a set of
// pulsing placeholder rows so the table structure is present immediately —
// when the first real PR lands, App swaps this for the live <PRList> and the
// header doesn't move. Product register prefers skeletons over a centered
// spinner; the staggered pulse is the only motion. Flattens under
// prefers-reduced-motion via the global reset in index.css.
const SKELETON_TITLE_WIDTHS = [62, 48, 78, 40, 70, 54, 84, 46];

export function PRListSkeleton({
  rows = 8,
}: {
  rows?: number;
}): JSX.Element {
  return (
    <table className="prs prs-skeleton" aria-hidden role="presentation">
      <thead>
        <tr>
          <th>#</th>
          <th>Title</th>
          <th>Author</th>
          <th>Target</th>
          <th>Status</th>
          <th>Approval</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, i) => (
          <tr
            key={i}
            className="pr-skel-row"
            // Staggers the pulse phase per row (read by the .sk children) so
            // the placeholders ripple instead of blinking in unison.
            style={{ '--skel-delay': `${i * 70}ms` } as React.CSSProperties}
          >
            <td>
              <span className="sk" style={{ width: 30 }} />
            </td>
            <td>
              <span
                className="sk"
                style={{
                  width: `${SKELETON_TITLE_WIDTHS[i % SKELETON_TITLE_WIDTHS.length]}%`,
                }}
              />
            </td>
            <td>
              <span className="sk" style={{ width: 84 }} />
            </td>
            <td>
              <span className="sk" style={{ width: 132 }} />
            </td>
            <td>
              <span className="sk sk-badge" />
            </td>
            <td>
              <span className="sk sk-badge" />
            </td>
            <td>
              <span className="sk" style={{ width: 64 }} />
            </td>
          </tr>
        ))}
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
      <ArrowRight size={12} className="branch-arrow" />
      <code className="branch dest" title={target.destinationReference || dest}>
        {dest || '?'}
      </code>
    </span>
  );
}

/* Status pill — single component for every status variant. Uses a single
 * shape recipe: filled background at low alpha, border at 30% alpha, label
 * text in the role color. No emoji, no decoration, the letter + color
 * together carry meaning (color-blind safe). */
type StatusKind =
  | 'open'
  | 'closed'
  | 'merged'
  | 'approved'
  | 'not_approved'
  | 'no_rules'
  | 'unknown';

function StatusBadge({ kind }: { kind: StatusKind }): JSX.Element {
  const label =
    kind === 'open'
      ? 'Open'
      : kind === 'closed'
        ? 'Closed'
        : kind === 'merged'
          ? 'Merged'
          : kind === 'approved'
            ? 'Approved'
            : kind === 'not_approved'
              ? 'Not approved'
              : kind === 'no_rules'
                ? 'No rules'
                : 'Unknown';
  return <span className={`pill pill-${kind}`}>{label}</span>;
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
      {active && (
        <span className="sort-arrow">
          {props.sortDir === 'asc' ? (
            <ChevronUp size={12} />
          ) : (
            <ChevronDown size={12} />
          )}
        </span>
      )}
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

function formatRowForClipboard(
  pr: PullRequestSummary,
  url?: string,
): string {
  const target = pr.targets[0];
  const status =
    pr.status === 'CLOSED' && pr.mergeState === 'MERGED'
      ? 'Merged'
      : pr.status === 'CLOSED'
        ? 'Closed'
        : 'Open';
  const approval = pr.approvalState
    .replace('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const source = target ? stripRefs(target.sourceReference) : '';
  const dest = target ? stripRefs(target.destinationReference) : '';
  const branches = source && dest ? `${source} → ${dest}` : source || dest;
  const author = shortArn(pr.authorArn);
  const updated = pr.lastActivityAt ? fmtRel(pr.lastActivityAt) : '';

  // Conversational multi-line share text. Reads like English in any
  // chat/email/doc context with no escaping, no markdown that might
  // not render, no tabs that collapse. Line 1 is the headline so it
  // previews clearly in a chat notification. Line 2 is the branches
  // (joined with an arrow — natural to read as "from X to Y"). Line 3
  // is the meta: author, last activity, status, approval. The URL
  // goes on its own line at the end so it's easy to click in any
  // client that auto-links.
  const lines: string[] = [`#${pr.id} ${pr.title}`];
  if (branches) lines.push(branches);
  const meta = [author, updated, status, approval].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  if (url) lines.push(url);
  return lines.join('\n');
}

/* Relative time formatter: "just now", "5m", "2h", "3d", "2w", "Mar 14".
 * Falls back to locale date for anything older than 60 days. Engineers
 * scan relative times in lists — "5h ago" is one read, "5/30/2026,
 * 11:34:02 AM" is four. */
function fmtRel(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  if (abs < minute) return 'just now';
  if (abs < hour) return `${Math.round(abs / minute)}m`;
  if (abs < day) return `${Math.round(abs / hour)}h`;
  if (abs < week) return `${Math.round(abs / day)}d`;
  if (abs < month) return `${Math.round(abs / week)}w`;
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
