import { useEffect, useMemo, useState } from 'react';
import type {
  ActivityEvent,
  DiffChangeType,
  FileDiffEntry,
  PullRequestCommit,
} from '@shared/types';

export type SidebarTab = 'files' | 'commits' | 'activity';

// Tree vs flat-list mode for the files panel, persisted across sessions so a
// user who prefers one layout keeps it. Mirrors VS Code's "Source Control"
// list/tree toggle.
type FileViewMode = 'tree' | 'list';
const VIEW_MODE_KEY = 'revu.fileViewMode';

function loadViewMode(): FileViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'tree';
  } catch {
    return 'tree';
  }
}

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
  // Activity panel. Optional — the create-PR flow reuses this sidebar in a
  // files-only mode where there's no PR (and so no activity) yet.
  activity?: ActivityEvent[];
  activityLoading?: boolean;
  // Clicking a line-anchored comment in the timeline scrolls the diff to it.
  onActivitySelect?: (event: ActivityEvent) => void;
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
  activity = [],
  activityLoading,
  onActivitySelect,
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
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'activity'}
          className={`sidebar-tab${tab === 'activity' ? ' is-active' : ''}`}
          onClick={() => onChangeTab('activity')}
        >
          Activity
          {activity.length > 0 && (
            <span className="sidebar-tab-count">{activity.length}</span>
          )}
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
      ) : tab === 'commits' ? (
        <CommitsPanel
          commits={commits}
          selectedCommitId={selectedCommitId}
          onSelectCommit={onSelectCommit}
        />
      ) : (
        <ActivityPanel
          activity={activity}
          loading={activityLoading}
          onNavigate={onActivitySelect}
        />
      )}
    </div>
  );
}

interface FilesPanelCommon {
  selectedPath?: string;
  commentCounts: Record<string, number>;
  reviewedPaths: Set<string>;
  onSelect: (file: FileDiffEntry) => void;
  onToggleReviewed: (file: FileDiffEntry, next: boolean) => void;
  readOnly?: boolean;
}

function FilesPanel({
  files,
  selectedPath,
  commentCounts,
  reviewedPaths,
  onSelect,
  onToggleReviewed,
  readOnly,
}: { files: FileDiffEntry[] } & FilesPanelCommon): JSX.Element {
  const [query, setQuery] = useState('');
  const [hideReviewed, setHideReviewed] = useState(false);
  const [viewMode, setViewMode] = useState<FileViewMode>(loadViewMode);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }, [viewMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (!readOnly && hideReviewed && reviewedPaths.has(f.path)) return false;
      if (q && !f.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, query, hideReviewed, reviewedPaths, readOnly]);

  // When the user is searching or hiding reviewed files, the tree should show
  // every match expanded rather than honoring collapsed folders.
  const forceExpand = query.trim().length > 0 || (!readOnly && hideReviewed);

  const reviewedCount = files.filter((f) => reviewedPaths.has(f.path)).length;

  const common: FilesPanelCommon = {
    selectedPath,
    commentCounts,
    reviewedPaths,
    onSelect,
    onToggleReviewed,
    readOnly,
  };

  return (
    <>
      <div className="file-sidebar-head">
        <div className="file-sidebar-head-row">
          <input
            className="file-filter"
            type="search"
            placeholder={`Filter ${files.length} file${files.length === 1 ? '' : 's'}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="file-view-toggle" role="group" aria-label="File view">
            <button
              type="button"
              className={`view-toggle-btn${viewMode === 'tree' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'tree'}
              title="Tree view"
              onClick={() => setViewMode('tree')}
            >
              Tree
            </button>
            <button
              type="button"
              className={`view-toggle-btn${viewMode === 'list' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'list'}
              title="List view"
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
        </div>
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
      {filtered.length === 0 ? (
        <ul>
          <li className="empty-li">No files match.</li>
        </ul>
      ) : viewMode === 'tree' ? (
        <TreeView files={filtered} forceExpand={forceExpand} {...common} />
      ) : (
        <ListView files={filtered} {...common} />
      )}
    </>
  );
}

// ---- Flat list view --------------------------------------------------

function ListView({
  files,
  ...common
}: { files: FileDiffEntry[] } & FilesPanelCommon): JSX.Element {
  return (
    <ul>
      {files.map((f) => (
        <FileRow
          key={`${f.changeType}-${f.path}`}
          entry={f}
          label={f.path}
          depth={0}
          {...common}
        />
      ))}
    </ul>
  );
}

// ---- Tree view -------------------------------------------------------

type TreeNode =
  | {
      kind: 'dir';
      name: string;
      path: string;
      children: TreeNode[];
      fileCount: number;
    }
  | { kind: 'file'; name: string; entry: FileDiffEntry };

interface DirAcc {
  dirs: Map<string, DirAcc>;
  files: FileDiffEntry[];
}

// Build a nested tree from file paths, compacting single-child directory chains
// (e.g. `src/main/providers` becomes one node when nothing else lives along the
// way) exactly like VS Code's tree.
function buildFileTree(files: FileDiffEntry[]): TreeNode[] {
  const root: DirAcc = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      let next = cur.dirs.get(seg);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        cur.dirs.set(seg, next);
      }
      cur = next;
    }
    cur.files.push(f);
  }

  function toNodes(acc: DirAcc, prefix: string): TreeNode[] {
    const dirNodes: TreeNode[] = [];
    for (const [name, child] of acc.dirs) {
      let displayName = name;
      let node = child;
      let nodePath = prefix ? `${prefix}/${name}` : name;
      // Compact chains: while this dir has exactly one subdir and no files,
      // fold the child into the name.
      while (node.files.length === 0 && node.dirs.size === 1) {
        const entry = [...node.dirs.entries()][0]!;
        displayName = `${displayName}/${entry[0]}`;
        nodePath = `${nodePath}/${entry[0]}`;
        node = entry[1];
      }
      const children = toNodes(node, nodePath);
      dirNodes.push({
        kind: 'dir',
        name: displayName,
        path: nodePath,
        children,
        fileCount: countFiles(children),
      });
    }
    dirNodes.sort((a, b) => a.name.localeCompare(b.name));
    const fileNodes: TreeNode[] = acc.files
      .map((entry) => ({
        kind: 'file' as const,
        name: entry.path.split('/').pop() ?? entry.path,
        entry,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...dirNodes, ...fileNodes];
  }

  return toNodes(root, '');
}

function countFiles(nodes: TreeNode[]): number {
  let n = 0;
  for (const node of nodes) n += node.kind === 'file' ? 1 : node.fileCount;
  return n;
}

interface FlatRow {
  node: TreeNode;
  depth: number;
}

// Flatten the tree into rows honoring collapsed directories, so the rendered
// <ul> stays a simple list (easier indentation + no deep nesting reflow).
function flattenTree(
  nodes: TreeNode[],
  depth: number,
  collapsed: Set<string>,
  forceExpand: boolean,
  out: FlatRow[],
): void {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.kind === 'dir') {
      const isCollapsed = !forceExpand && collapsed.has(node.path);
      if (!isCollapsed) {
        flattenTree(node.children, depth + 1, collapsed, forceExpand, out);
      }
    }
  }
}

function TreeView({
  files,
  forceExpand,
  ...common
}: {
  files: FileDiffEntry[];
  forceExpand: boolean;
} & FilesPanelCommon): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => buildFileTree(files), [files]);
  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    flattenTree(tree, 0, collapsed, forceExpand, out);
    return out;
  }, [tree, collapsed, forceExpand]);

  const toggleDir = (path: string): void => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <ul className="file-tree">
      {rows.map(({ node, depth }) =>
        node.kind === 'dir' ? (
          <DirRow
            key={`d-${node.path}`}
            name={node.name}
            depth={depth}
            fileCount={node.fileCount}
            collapsed={!forceExpand && collapsed.has(node.path)}
            onToggle={() => toggleDir(node.path)}
          />
        ) : (
          <FileRow
            key={`f-${node.entry.path}`}
            entry={node.entry}
            label={node.name}
            depth={depth}
            {...common}
          />
        ),
      )}
    </ul>
  );
}

function DirRow({
  name,
  depth,
  fileCount,
  collapsed,
  onToggle,
}: {
  name: string;
  depth: number;
  fileCount: number;
  collapsed: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <li
      className="file-tree-dir"
      style={{ paddingLeft: 6 + depth * 12 }}
      onClick={onToggle}
      title={name}
    >
      <span className="tree-chevron">{collapsed ? '▸' : '▾'}</span>
      <span className="tree-dir-name">{name}</span>
      <span className="tree-dir-count">{fileCount}</span>
    </li>
  );
}

function FileRow({
  entry,
  label,
  depth,
  selectedPath,
  commentCounts,
  reviewedPaths,
  onSelect,
  onToggleReviewed,
  readOnly,
}: { entry: FileDiffEntry; label: string; depth: number } & FilesPanelCommon): JSX.Element {
  const isActive = entry.path === selectedPath;
  const count = commentCounts[entry.path] ?? 0;
  const isReviewed = !readOnly && reviewedPaths.has(entry.path);
  return (
    <li
      className={[
        'file-tree-file',
        isActive ? 'active' : '',
        isReviewed ? 'reviewed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: 6 + depth * 12 }}
      onClick={() => onSelect(entry)}
      title={entry.path}
    >
      {!readOnly && (
        <input
          type="checkbox"
          className="file-reviewed-cb"
          checked={isReviewed}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleReviewed(entry, e.target.checked)}
          title="Mark as reviewed"
        />
      )}
      <span className={`ct ct-${entry.changeType}`}>{entry.changeType}</span>
      <span className="path">{label}</span>
      {count > 0 && <span className="badge-count">{count}</span>}
    </li>
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

// ---- Activity panel --------------------------------------------------

function ActivityPanel({
  activity,
  loading,
  onNavigate,
}: {
  activity: ActivityEvent[];
  loading?: boolean;
  onNavigate?: (event: ActivityEvent) => void;
}): JSX.Element {
  if (activity.length === 0) {
    return (
      <ul>
        <li className="empty-li">
          {loading ? 'Loading activity…' : 'No activity yet.'}
        </li>
      </ul>
    );
  }
  return (
    <ul className="activity-list">
      {activity.map((e) => (
        <ActivityRow key={e.id} event={e} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

function ActivityRow({
  event,
  onNavigate,
}: {
  event: ActivityEvent;
  onNavigate?: (event: ActivityEvent) => void;
}): JSX.Element {
  const who = shortArn(event.actorArn);
  // Only a line-anchored comment can jump to a thread in the diff. General PR
  // comments (no filePath) and lifecycle events have no location, so they stay
  // inert. threadId is what the diff uses to find the rendered row.
  const navigable =
    !!onNavigate &&
    event.type === 'comment' &&
    !!event.filePath &&
    !!event.threadId;
  const onActivate = navigable ? () => onNavigate!(event) : undefined;
  return (
    <li
      className={`activity-item activity-${event.type}${
        event.isReply ? ' is-reply' : ''
      }${navigable ? ' is-navigable' : ''}`}
      role={navigable ? 'button' : undefined}
      tabIndex={navigable ? 0 : undefined}
      title={
        navigable ? `Go to comment on ${baseName(event.filePath!)}` : undefined
      }
      onClick={onActivate}
      onKeyDown={
        navigable
          ? (ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                onActivate?.();
              }
            }
          : undefined
      }
    >
      <span className="activity-icon" aria-hidden>
        {activityIcon(event)}
      </span>
      <span className="activity-main">
        <span className="activity-line">
          <span className="activity-actor">{who}</span>{' '}
          <span className="activity-verb">{activityVerb(event)}</span>
        </span>
        {event.type === 'comment' && (
          <>
            {event.isReply && event.replyToExcerpt && (
              <span className="activity-quote" title={event.replyToExcerpt}>
                {event.replyToExcerpt}
              </span>
            )}
            {event.commentExcerpt && (
              <span className="activity-excerpt" title={event.commentExcerpt}>
                {event.filePath && (
                  <span className="activity-file">
                    {baseName(event.filePath)}:{' '}
                  </span>
                )}
                {event.commentExcerpt}
              </span>
            )}
          </>
        )}
        {event.occurredAt && (
          <span className="activity-when" title={event.occurredAt}>
            {fmtRel(event.occurredAt)}
          </span>
        )}
      </span>
    </li>
  );
}

// Human-readable predicate for a timeline entry. The actor name is rendered
// separately, so this is just the verb phrase that follows it.
function activityVerb(e: ActivityEvent): string {
  switch (e.type) {
    case 'created':
      return 'opened this pull request';
    case 'statusChanged':
      return e.status === 'CLOSED'
        ? 'closed this pull request'
        : 'reopened this pull request';
    case 'sourceUpdated':
      return 'pushed new commits';
    case 'approvalStateChanged':
      return e.approvalState === 'APPROVE' ? 'approved' : 'revoked approval';
    case 'merged':
      return e.mergedWith
        ? `merged this pull request (${mergeLabel(e.mergedWith)})`
        : 'merged this pull request';
    case 'comment':
      if (e.isReply) {
        return e.replyToAuthorArn
          ? `replied to ${shortArn(e.replyToAuthorArn)}`
          : 'replied';
      }
      return 'commented';
  }
}

function activityIcon(e: ActivityEvent): string {
  switch (e.type) {
    case 'created':
      return '◆';
    case 'statusChanged':
      return '⊘';
    case 'sourceUpdated':
      return '↑';
    case 'approvalStateChanged':
      return '✓';
    case 'merged':
      return '⇄';
    case 'comment':
      return e.isReply ? '↩' : '💬';
  }
}

function mergeLabel(opt: ActivityEvent['mergedWith']): string {
  switch (opt) {
    case 'FAST_FORWARD_MERGE':
      return 'fast-forward';
    case 'SQUASH_MERGE':
      return 'squash';
    case 'THREE_WAY_MERGE':
      return '3-way';
    default:
      return 'merge';
  }
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function shortArn(arn: string | undefined): string {
  if (!arn) return 'Someone';
  const i = arn.lastIndexOf('/');
  return i >= 0 ? arn.slice(i + 1) : arn;
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
