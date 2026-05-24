import { useMemo, useState } from 'react';
import type { DiffChangeType, FileDiffEntry } from '@shared/types';

interface Props {
  files: FileDiffEntry[];
  selectedPath?: string;
  commentCounts: Record<string, number>;
  reviewedPaths: Set<string>;
  onSelect: (file: FileDiffEntry) => void;
  onToggleReviewed: (file: FileDiffEntry, next: boolean) => void;
}

export function FileSidebar({
  files,
  selectedPath,
  commentCounts,
  reviewedPaths,
  onSelect,
  onToggleReviewed,
}: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [hideReviewed, setHideReviewed] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (hideReviewed && reviewedPaths.has(f.path)) return false;
      if (q && !f.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, query, hideReviewed, reviewedPaths]);

  const reviewedCount = files.filter((f) => reviewedPaths.has(f.path)).length;

  return (
    <div className="file-sidebar">
      <div className="file-sidebar-head">
        <input
          className="file-filter"
          type="search"
          placeholder={`Filter ${files.length} file${files.length === 1 ? '' : 's'}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="reviewed-toggle">
          <input
            type="checkbox"
            checked={hideReviewed}
            onChange={(e) => setHideReviewed(e.target.checked)}
          />
          Hide reviewed ({reviewedCount}/{files.length})
        </label>
      </div>
      <ul>
        {filtered.map((f) => {
          const isActive = f.path === selectedPath;
          const count = commentCounts[f.path] ?? 0;
          const isReviewed = reviewedPaths.has(f.path);
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
              <input
                type="checkbox"
                className="file-reviewed-cb"
                checked={isReviewed}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onToggleReviewed(f, e.target.checked)}
                title="Mark as reviewed"
              />
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
    </div>
  );
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
