import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileDiffEntry } from '@shared/types';

// Command-palette-style fuzzy file finder for the changed files in a PR.
// Opened with Cmd/Ctrl+P from the PR detail view. Arrow keys move, Enter jumps
// to the file (scrolls the diff), Esc closes.

interface Props {
  files: FileDiffEntry[];
  onSelect: (file: FileDiffEntry) => void;
  onClose: () => void;
}

interface Ranked {
  entry: FileDiffEntry;
  score: number;
}

// Subsequence fuzzy match with bonuses for consecutive hits and matches at
// path boundaries (/_-.). Returns null when the query isn't a subsequence.
function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let s = 1;
      if (ti === prev + 1) s += 5;
      const before = ti === 0 ? '/' : t[ti - 1]!;
      if (/[/\-_.]/.test(before)) s += 8;
      score += s;
      prev = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  // Slightly prefer shorter paths so the closest match floats up.
  return score - t.length * 0.04;
}

export function FileFinder({ files, onSelect, onClose }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<Ranked[]>(() => {
    const q = query.trim();
    if (!q) {
      return files.slice(0, 200).map((entry) => ({ entry, score: 0 }));
    }
    const ranked: Ranked[] = [];
    for (const entry of files) {
      const score = fuzzyScore(q, entry.path);
      if (score !== null) ranked.push({ entry, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, 200);
  }, [files, query]);

  // Clamp the active index whenever the result set shrinks.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Keep the active row in view as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function commit(idx: number): void {
    const r = results[idx];
    if (!r) return;
    onSelect(r.entry);
    onClose();
  }

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(active);
    }
  }

  return (
    <div
      className="finder-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="finder" role="dialog" aria-modal="true" aria-label="Find file">
        <input
          ref={inputRef}
          className="finder-input"
          type="text"
          placeholder="Go to file…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          spellCheck={false}
        />
        <ul className="finder-list" ref={listRef}>
          {results.length === 0 ? (
            <li className="empty-li">No files match.</li>
          ) : (
            results.map((r, i) => {
              const path = r.entry.path;
              const slash = path.lastIndexOf('/');
              const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
              const base = slash >= 0 ? path.slice(slash + 1) : path;
              return (
                <li
                  key={`${r.entry.changeType}-${path}`}
                  className={`finder-item${i === active ? ' is-active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => commit(i)}
                  title={path}
                >
                  <span className={`ct ct-${r.entry.changeType}`}>
                    {r.entry.changeType}
                  </span>
                  <span className="finder-base">{base}</span>
                  {dir && <span className="finder-dir">{dir}</span>}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
