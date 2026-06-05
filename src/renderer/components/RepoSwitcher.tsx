import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RepositorySummary } from '@shared/types';
import { api, unwrap } from '../api';
import {
  ChevronDown,
  RefreshCw,
  Search,
  Star,
  Check,
} from '../icons';

// Quick repository switcher for the list-view topbar. Lets the user change the
// active CodeCommit repo without opening Settings. Mirrors BranchPicker: a
// trigger button opens a filterable popup; favorites pin to the top with
// filled stars, the rest get empty stars the user can toggle inline. Picking a
// row switches the repo + closes; the star is a separate target that toggles
// the favorite without switching. Repos are fetched lazily the first time the
// popup opens (and cached by the provider), so the topbar stays cheap on
// startup.

interface Props {
  current?: string;
  favorites: string[];
  onSwitch: (name: string) => void;
  onToggleFavorite: (name: string, favorite: boolean) => void;
}

export function RepoSwitcher({
  current,
  favorites,
  onSwitch,
  onToggleFavorite,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<RepositorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  // Fetch repos the first time the popup opens (or on a manual refresh).
  const loadRepos = useCallback(async (forceFresh = false): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setRepos(
        await unwrap(api.repos.list(forceFresh ? { forceFresh: true } : undefined)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Retry on every (re)open while we still have nothing — a transient failure
    // shouldn't permanently wedge the popup. `error` is intentionally NOT part
    // of the guard: a prior failure must not block the next attempt.
    if ((repos.length === 0 || refreshToken > 0) && !loading) {
      void loadRepos(refreshToken > 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refreshToken]);

  // Focus the filter when the popup opens; reset filter/cursor when it closes.
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    setFilter('');
    setActiveIndex(0);
    return undefined;
  }, [open]);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      const t = e.target as Node | null;
      if (!t) return;
      if (popupRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Favorite-aware sort: favorites first (alpha), then the rest (alpha). Always
  // include the current repo + any favorites so the list is meaningful even
  // before the fetch resolves.
  const sorted = useMemo<{ favs: string[]; rest: string[] }>(() => {
    const set = new Set(repos.map((r) => r.name));
    for (const f of favorites) set.add(f);
    if (current) set.add(current);
    const all = [...set];
    const favs = all.filter((n) => favSet.has(n)).sort((a, b) => a.localeCompare(b));
    const rest = all.filter((n) => !favSet.has(n)).sort((a, b) => a.localeCompare(b));
    return { favs, rest };
  }, [repos, favorites, current, favSet]);

  // Apply the typeahead filter to each section independently so the favorites
  // header doesn't vanish when a favorite happens not to match.
  const visible = useMemo<{ favs: string[]; rest: string[]; flat: string[] }>(() => {
    const q = filter.trim().toLowerCase();
    const matches = (n: string): boolean => (q ? n.toLowerCase().includes(q) : true);
    const favs = sorted.favs.filter(matches);
    const rest = sorted.rest.filter(matches);
    return { favs, rest, flat: [...favs, ...rest] };
  }, [sorted, filter]);

  // Clamp activeIndex when the visible list shrinks.
  useEffect(() => {
    if (activeIndex >= visible.flat.length) {
      setActiveIndex(Math.max(0, visible.flat.length - 1));
    }
  }, [visible.flat.length, activeIndex]);

  const pick = useCallback(
    (name: string): void => {
      setOpen(false);
      if (name !== current) onSwitch(name);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    },
    [current, onSwitch],
  );

  const onSearchKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(visible.flat.length - 1, Math.max(0, i + 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const name = visible.flat[activeIndex];
        if (name) pick(name);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveIndex(Math.max(0, visible.flat.length - 1));
      }
    },
    [visible.flat, activeIndex, pick],
  );

  // Scroll the active row into view as keyboard nav moves it.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const renderRow = (name: string, overallIndex: number, favorited: boolean): JSX.Element => {
    const active = overallIndex === activeIndex;
    const isCurrent = name === current;
    return (
      <div
        key={name}
        role="option"
        aria-selected={isCurrent}
        data-row-index={overallIndex}
        className={`repo-row${active ? ' is-active' : ''}${isCurrent ? ' is-selected' : ''}`}
        onMouseEnter={() => setActiveIndex(overallIndex)}
        onClick={() => pick(name)}
      >
        <button
          type="button"
          className={`repo-row-star${favorited ? ' is-favorited' : ''}`}
          aria-label={favorited ? `Unfavorite ${name}` : `Favorite ${name}`}
          aria-pressed={favorited}
          title={favorited ? 'Unfavorite this repository' : 'Favorite this repository'}
          onClick={(e) => {
            // Don't let the click bubble up into row-select.
            e.stopPropagation();
            onToggleFavorite(name, !favorited);
          }}
        >
          <Star size={14} />
        </button>
        <span className="repo-row-name" title={name}>
          {name}
        </span>
        {isCurrent && (
          <span className="repo-row-current" aria-label="current repository">
            <Check size={12} />
          </span>
        )}
      </div>
    );
  };

  let runningIndex = 0;
  return (
    <div className={`repo-switcher${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="repo-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch repository"
        title="Switch repository"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="repo-switcher-value">{current ?? 'Select repository'}</span>
        <span className="repo-switcher-caret" aria-hidden="true">
          <ChevronDown size={12} />
        </span>
      </button>
      {open && (
        <div
          className="repo-switcher-popup"
          ref={popupRef}
          role="dialog"
          aria-label="Repositories"
        >
          <div className="repo-switcher-search-row">
            <Search size={14} className="search-icon" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={filter}
              placeholder="Filter repositories…"
              aria-label="Filter repositories"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setFilter(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKey}
            />
            <button
              type="button"
              className="repo-switcher-refresh"
              onClick={() => setRefreshToken((n) => n + 1)}
              title="Re-fetch the repository list from the server"
              aria-label="Refresh repository list"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div
            className="repo-switcher-list"
            ref={listRef}
            role="listbox"
            aria-label="Repositories"
          >
            {error && repos.length === 0 ? (
              // Hard failure with nothing cached — full error + retry.
              <div className="repo-switcher-error" title={error}>
                Could not load repositories.{' '}
                <button type="button" onClick={() => setRefreshToken((n) => n + 1)}>
                  Retry
                </button>
              </div>
            ) : (
              // Render locally-known favorites (and the current repo) immediately;
              // the full list reconciles in below once the CodeCommit fetch
              // resolves. A spinner row sits under the favorites while loading.
              <>
                {visible.favs.length > 0 && (
                  <div className="repo-switcher-section">
                    <div className="repo-switcher-section-head">Favorites</div>
                    {visible.favs.map((n) => renderRow(n, runningIndex++, true))}
                  </div>
                )}
                {visible.rest.length > 0 && (
                  <div className="repo-switcher-section">
                    {visible.favs.length > 0 && (
                      <div className="repo-switcher-section-head">All repositories</div>
                    )}
                    {visible.rest.map((n) => renderRow(n, runningIndex++, false))}
                  </div>
                )}
                {loading && (
                  <div className="repo-switcher-loading" role="status">
                    <span className="repo-switcher-spinner" aria-hidden="true" />
                    Loading repositories…
                  </div>
                )}
                {error && repos.length > 0 && (
                  <div className="repo-switcher-loading" title={error}>
                    Couldn’t refresh.{' '}
                    <button type="button" onClick={() => setRefreshToken((n) => n + 1)}>
                      Retry
                    </button>
                  </div>
                )}
                {!loading && !error && visible.flat.length === 0 && (
                  <div className="repo-switcher-empty">
                    {filter
                      ? `No repositories match "${filter}".`
                      : 'No repositories found.'}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
