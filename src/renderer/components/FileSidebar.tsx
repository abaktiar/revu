import { useMemo, useState } from 'react';
import type { DiffChangeType, FileDiffEntry } from '@shared/types';

interface Props {
  files: FileDiffEntry[];
  selectedPath?: string;
  commentCounts: Record<string, number>;
  onSelect: (file: FileDiffEntry) => void;
}

export function FileSidebar({
  files,
  selectedPath,
  commentCounts,
  onSelect,
}: Props): JSX.Element {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, query]);

  return (
    <div className="file-sidebar">
      <input
        className="file-filter"
        type="search"
        placeholder={`Filter ${files.length} file${files.length === 1 ? '' : 's'}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul>
        {filtered.map((f) => {
          const isActive = f.path === selectedPath;
          const count = commentCounts[f.path] ?? 0;
          return (
            <li
              key={`${f.changeType}-${f.path}`}
              className={isActive ? 'active' : ''}
              onClick={() => onSelect(f)}
              title={f.path}
            >
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
