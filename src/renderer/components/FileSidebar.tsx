import { useMemo, useState } from 'react';
import type {
  DiffChangeType,
  FileDiffEntry,
  PullRequestCommit,
} from '@shared/types';

export type SidebarTab = 'files' | 'commits';

interface Props {
  // Tabs
  tab: SidebarTab;
  onChangeTab: (next: SidebarTab) => void;
  // Files panel
  files: FileDiffEntry[];
  selectedPath?: string;
  commentCounts: Record<string, number>;
  reviewedPaths: Set<string>;
  onSelect: (file: FileDiffEntry) => void;
  onToggleReviewed: (file: FileDiffEntry, next: boolean) => void;
  // Disable reviewed checkboxes when the file list is the per-commit view —
  // reviewed state is anchored to the PR's afterCommit, not arbitrary commits.
  filesReadOnly?: boolean;
  // Commits panel
  commits: PullRequestCommit[];
  selectedCommitId?: string;
  onSelectCommit: (commit: PullRequestCommit) => void;
}

export function FileSidebar({
  tab,
  onChangeTab,
  files,
  selectedPath,
  commentCounts,
  reviewedPaths,
  onSelect,
  onToggleReviewed,
  filesReadOnly,
  commits,
  selectedCommitId,
  onSelectCommit,
}: Props): JSX.Element {
  return (
    <div className="file-sidebar">
      <div className="file-sidebar-tabs" role="tablist" aria-label="Sidebar">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'files'}
          className={`sidebar-tab${tab === 'files' ? ' is-active' : ''}`}
          onClick={() => onChangeTab('files')}
        >
          Files <span className="sidebar-tab-count">{files.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'commits'}
          className={`sidebar-tab${tab === 'commits' ? ' is-active' : ''}`}
          onClick={() => onChangeTab('commits')}
          disabled={commits.length === 0}
          title={commits.length === 0 ? 'No commits to show' : undefined}
        >
          Commits <span className="sidebar-tab-count">{commits.length}</span>
        </button>
      </div>
      {tab === 'files' ? (
        <FilesPanel
          files={files}
          selectedPath={selectedPath}
          commentCounts={commentCounts}
          reviewedPaths={reviewedPaths}
          onSelect={onSelect}
          onToggleReviewed={onToggleReviewed}
          readOnly={filesReadOnly}
        />
      ) : (
        <CommitsPanel
          commits={commits}
          selectedCommitId={selectedCommitId}
          onSelectCommit={onSelectCommit}
        />
      )}
    </div>
  );
}

function FilesPanel({
  files,
  selectedPath,
  commentCounts,
  reviewedPaths,
  onSelect,
  onToggleReviewed,
  readOnly,
}: {
  files: FileDiffEntry[];
  selectedPath?: string;
  commentCounts: Record<string, number>;
  reviewedPaths: Set<string>;
  onSelect: (file: FileDiffEntry) => void;
  onToggleReviewed: (file: FileDiffEntry, next: boolean) => void;
  readOnly?: boolean;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [hideReviewed, setHideReviewed] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (!readOnly && hideReviewed && reviewedPaths.has(f.path)) return false;
      if (q && !f.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, query, hideReviewed, reviewedPaths, readOnly]);

  const reviewedCount = files.filter((f) => reviewedPaths.has(f.path)).length;

  return (
    <>
      <div className="file-sidebar-head">
        <input
          className="file-filter"
          type="search"
          placeholder={`Filter ${files.length} file${files.length === 1 ? '' : 's'}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!readOnly && (
          <label className="reviewed-toggle">
            <input
              type="checkbox"
              checked={hideReviewed}
              onChange={(e) => setHideReviewed(e.target.checked)}
            />
            Hide reviewed ({reviewedCount}/{files.length})
          </label>
        )}
      </div>
      <ul>
        {filtered.map((f) => {
          const isActive = f.path === selectedPath;
          const count = commentCounts[f.path] ?? 0;
          const isReviewed = !readOnly && reviewedPaths.has(f.path);
          return (
            <li
              key={`${f.changeType}-${f.path}`}
              className={[
                isActive ? 'active' : '',
                isReviewed ? 'reviewed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(f)}
              title={f.path}
            >
              {!readOnly && (
                <input
                  type="checkbox"
                  className="file-reviewed-cb"
                  checked={isReviewed}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onToggleReviewed(f, e.target.checked)}
                  title="Mark as reviewed"
                />
              )}
              <span className={`ct ct-${f.changeType}`}>{f.changeType}</span>
              <span className="path">{f.path}</span>
              {count > 0 && <span className="badge-count">{count}</span>}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="empty-li">No files match.</li>
        )}
      </ul>
    </>
  );
}

function CommitsPanel({
  commits,
  selectedCommitId,
  onSelectCommit,
}: {
  commits: PullRequestCommit[];
  selectedCommitId?: string;
  onSelectCommit: (c: PullRequestCommit) => void;
}): JSX.Element {
  return (
    <ul className="commits-sidebar-list">
      {commits.length === 0 ? (
        <li className="empty-li">No commits in this PR.</li>
      ) : (
        commits.map((c) => (
          <CommitRow
            key={c.id}
            commit={c}
            selected={c.id === selectedCommitId}
            onSelect={() => onSelectCommit(c)}
          />
        ))
      )}
    </ul>
  );
}

function CommitRow({
  commit,
  selected,
  onSelect,
}: {
  commit: PullRequestCommit;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const subject = subjectOf(commit.message);
  const who = commit.authorName ?? commit.committerName ?? '';
  const when = commit.committerDate ?? commit.authorDate;

  return (
    <li
      className={`commit-item${selected ? ' active' : ''}`}
      onClick={onSelect}
      title={commit.message || commit.id}
    >
      <button
        type="button"
        className={`commit-sha-chip${copied ? ' is-copied' : ''}`}
        title={copied ? 'Copied' : `Copy ${commit.id}`}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard
            .writeText(commit.id)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1100);
            })
            .catch(() => {
              // Clipboard can fail in restricted contexts; silently no-op.
            });
        }}
      >
        {copied ? 'copied' : commit.id.slice(0, 7)}
      </button>
      <span className="commit-item-main">
        <span className="commit-item-subject">
          {subject || '(empty message)'}
        </span>
        <span className="commit-item-meta">
          {who && <span className="commit-item-author">{who}</span>}
          {when && (
            <>
              {who && <span className="commit-item-sep">·</span>}
              <span className="commit-item-when" title={when}>
                {fmtRel(when)}
              </span>
            </>
          )}
        </span>
      </span>
    </li>
  );
}

function subjectOf(msg: string): string {
  if (!msg) return '';
  const i = msg.indexOf('\n');
  return (i >= 0 ? msg.slice(0, i) : msg).trim();
}

function fmtRel(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const sign = diff >= 0 ? '' : 'in ';
  const suffix = diff >= 0 ? ' ago' : '';
  if (abs < minute) return diff >= 0 ? 'now' : 'soon';
  if (abs < hour) return `${sign}${Math.round(abs / minute)}m${suffix}`;
  if (abs < day) return `${sign}${Math.round(abs / hour)}h${suffix}`;
  if (abs < week) return `${sign}${Math.round(abs / day)}d${suffix}`;
  if (abs < month) return `${sign}${Math.round(abs / week)}w${suffix}`;
  return new Date(t).toLocaleDateString();
}

export function changeTypeLabel(ct: DiffChangeType): string {
  switch (ct) {
    case 'A':
      return 'Added';
    case 'M':
      return 'Modified';
    case 'D':
      return 'Deleted';
    case 'R':
      return 'Renamed';
  }
}
