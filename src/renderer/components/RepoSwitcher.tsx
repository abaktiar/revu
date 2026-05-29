import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepositorySummary } from '@shared/types';
import { api, unwrap } from '../api';

// Quick repository switcher for the list-view topbar. Lets the user change the
// active CodeCommit repo without opening Settings. Favorites float to the top.
// Repos are fetched lazily the first time the menu opens (and cached by the
// provider), so the topbar stays cheap on startup.

interface Props {
  current?: string;
  favorites: string[];
  onSwitch: (name: string) => void;
}

export function RepoSwitcher({ current, favorites, onSwitch }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<RepositorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  // Fetch repos the first time the menu opens (or on a manual refresh).
  async function loadRepos(forceFresh = false): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setRepos(await unwrap(api.repos.list(forceFresh ? { forceFresh: true } : undefined)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && repos.length === 0 && !loading && !error) {
      void loadRepos();
    }
    if (open) {
      // Focus the filter after the menu paints.
      queueMicrotask(() => inputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const names = useMemo(() => {
    const set = new Set(repos.map((r) => r.name));
    for (const f of favorites) set.add(f);
    if (current) set.add(current);
    const q = query.trim().toLowerCase();
    const all = [...set].filter((n) => !q || n.toLowerCase().includes(q));
    const favs = all.filter((n) => favSet.has(n)).sort((a, b) => a.localeCompare(b));
    const rest = all.filter((n) => !favSet.has(n)).sort((a, b) => a.localeCompare(b));
    return { favs, rest };
  }, [repos, favorites, current, query, favSet]);

  function pick(name: string): void {
    setOpen(false);
    setQuery('');
    if (name !== current) onSwitch(name);
  }

  return (
    <div className="repo-switcher" ref={rootRef}>
      <button
        type="button"
        className="repo-switcher-btn"
        onClick={() => setOpen((v) => !v)}
        title="Switch repository"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="repo-name">{current ?? 'Select repository'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="repo-switcher-menu" role="listbox" aria-label="Repositories">
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter repositories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          <ul className="repo-switcher-list">
            {loading && <li className="repo-switcher-section">Loading…</li>}
            {error && (
              <li className="repo-switcher-section" title={error}>
                {error}
              </li>
            )}
            {!loading && names.favs.length > 0 && (
              <li className="repo-switcher-section">Favorites</li>
            )}
            {names.favs.map((n) => (
              <RepoItem
                key={`fav-${n}`}
                name={n}
                isCurrent={n === current}
                isFav
                onPick={pick}
              />
            ))}
            {!loading && names.rest.length > 0 && (
              <li className="repo-switcher-section">All repositories</li>
            )}
            {names.rest.map((n) => (
              <RepoItem
                key={n}
                name={n}
                isCurrent={n === current}
                isFav={false}
                onPick={pick}
              />
            ))}
            {!loading && names.favs.length === 0 && names.rest.length === 0 && (
              <li className="repo-switcher-section">No repositories.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function RepoItem({
  name,
  isCurrent,
  isFav,
  onPick,
}: {
  name: string;
  isCurrent: boolean;
  isFav: boolean;
  onPick: (name: string) => void;
}): JSX.Element {
  return (
    <li
      className={`repo-switcher-item${isCurrent ? ' is-active' : ''}`}
      role="option"
      aria-selected={isCurrent}
      onClick={() => onPick(name)}
      title={name}
    >
      {isFav && (
        <span className="repo-fav" aria-hidden="true">
          ★
        </span>
      )}
      <span className="repo-name">{name}</span>
      {isCurrent && <span className="repo-current">current</span>}
    </li>
  );
}
