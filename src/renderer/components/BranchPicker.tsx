import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { BranchSummary } from '@shared/types';
import { api, unwrap } from '../api';
import {
  ChevronDown,
  GitBranch,
  RefreshCw,
  Search,
  Star,
} from '../icons';

interface Props {
  repositoryName: string;
  value: string | null;
  onChange: (branch: string) => void;
  // When provided, the picker renders favorite stars and surfaces them at the
  // top of the list. Pass `undefined` for source pickers (no favorites UX).
  favoriteDestinations?: readonly string[];
  onToggleFavorite?: (branchName: string, favorite: boolean) => void;
  placeholder?: string;
  // Visible label for assistive tech ("Source branch" / "Destination branch").
  ariaLabel: string;
  // When set, the picker shows "disabled" state — the trigger button is
  // greyed and the dropdown won't open.
  disabled?: boolean;
  // Visible id of the trigger so external labels can associate.
  id?: string;
}

// Reusable branch combobox. Source pickers pass no `favoriteDestinations` —
// the dropdown shows a plain alphabetical list. Destination pickers pass the
// favorites array; favorites pin to the top with filled stars, the rest get
// empty stars the user can toggle. Either way the active row's gesture
// selects + closes; the star is a separate target that fires
// onToggleFavorite without picking.
export function BranchPicker({
  repositoryName,
  value,
  onChange,
  favoriteDestinations,
  onToggleFavorite,
  placeholder = 'Pick a branch…',
  ariaLabel,
  disabled,
  id,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchSummary[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Load branches lazily on first open (and on refresh). Until the user opens
  // the dropdown we don't burn a CodeCommit ListBranches call.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const forceFresh = refreshToken > 0;
    unwrap(
      api.branches.list(
        repositoryName,
        forceFresh ? { forceFresh: true } : undefined,
      ),
    )
      .then((list) => {
        if (cancelled) return;
        setBranches(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repositoryName, refreshToken]);

  // Focus the search input when the panel opens — typical combobox UX.
  useEffect(() => {
    if (open) {
      // Defer to next tick so the popup is in the DOM.
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
    function onDown(ev: MouseEvent): void {
      const t = ev.target as Node | null;
      if (!t) return;
      if (popupRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.preventDefault();
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

  // Favorite-aware sort: favorites first (alphabetical among themselves),
  // then everything else alphabetical. Source pickers receive
  // favoriteDestinations === undefined and skip the partition entirely.
  const sorted = useMemo<{
    favorites: BranchSummary[];
    rest: BranchSummary[];
  }>(() => {
    // Pre-fetch: surface locally-known favorites immediately so the popup is
    // useful before the CodeCommit ListBranches call resolves. The full list
    // reconciles in (and re-partitions) once `branches` arrives.
    if (!branches) {
      const favNames = favoriteDestinations ?? [];
      return { favorites: favNames.map((name) => ({ name })), rest: [] };
    }
    if (!favoriteDestinations || favoriteDestinations.length === 0) {
      return { favorites: [], rest: branches };
    }
    const favSet = new Set(favoriteDestinations);
    const fav: BranchSummary[] = [];
    const rest: BranchSummary[] = [];
    for (const b of branches) {
      if (favSet.has(b.name)) fav.push(b);
      else rest.push(b);
    }
    return { favorites: fav, rest };
  }, [branches, favoriteDestinations]);

  // Apply the typeahead filter to a section. We filter each section
  // independently so the favorites header doesn't disappear if a favorite
  // happens not to match.
  const visible = useMemo<{
    favorites: BranchSummary[];
    rest: BranchSummary[];
    flat: string[];
  }>(() => {
    const q = filter.trim().toLowerCase();
    const matches = (b: BranchSummary): boolean =>
      q ? b.name.toLowerCase().includes(q) : true;
    const favorites = sorted.favorites.filter(matches);
    const rest = sorted.rest.filter(matches);
    // flat = the order of branch names as they'll appear in the DOM; the
    // keyboard arrow keys walk through this list 1-by-1 regardless of section.
    const flat = [...favorites.map((b) => b.name), ...rest.map((b) => b.name)];
    return { favorites, rest, flat };
  }, [sorted, filter]);

  // Clamp activeIndex when the visible list shrinks.
  useEffect(() => {
    if (activeIndex >= visible.flat.length) {
      setActiveIndex(Math.max(0, visible.flat.length - 1));
    }
  }, [visible.flat.length, activeIndex]);

  const selectBranch = useCallback(
    (name: string): void => {
      onChange(name);
      setOpen(false);
      // Return focus to the trigger so the user can keep tabbing.
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    },
    [onChange],
  );

  const onSearchKey = useCallback(
    (ev: React.KeyboardEvent<HTMLInputElement>): void => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        setActiveIndex((i) =>
          Math.min(visible.flat.length - 1, Math.max(0, i + 1)),
        );
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const name = visible.flat[activeIndex];
        if (name) selectBranch(name);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        setActiveIndex(0);
      } else if (ev.key === 'End') {
        ev.preventDefault();
        setActiveIndex(Math.max(0, visible.flat.length - 1));
      }
    },
    [visible.flat, activeIndex, selectBranch],
  );

  // Scroll the active row into view as keyboard nav moves it. Without this
  // arrow-down past the visible region looks unresponsive.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const allowFavorites = !!favoriteDestinations && !!onToggleFavorite;

  const renderRow = (
    b: BranchSummary,
    overallIndex: number,
    favorited: boolean,
  ): JSX.Element => {
    const active = overallIndex === activeIndex;
    const selected = value === b.name;
    return (
      <div
        key={b.name}
        role="option"
        aria-selected={selected}
        data-row-index={overallIndex}
        className={`branch-row${active ? ' is-active' : ''}${
          selected ? ' is-selected' : ''
        }`}
        onMouseEnter={() => setActiveIndex(overallIndex)}
        onClick={() => selectBranch(b.name)}
      >
        <span className="branch-row-name" title={b.name}>
          {b.name}
        </span>
        {allowFavorites && (
          <button
            type="button"
            className={`branch-row-star${favorited ? ' is-favorited' : ''}`}
            aria-label={
              favorited
                ? `Unfavorite ${b.name} as destination`
                : `Favorite ${b.name} as destination`
            }
            aria-pressed={favorited}
            title={favorited ? 'Unfavorite this destination' : 'Favorite this destination'}
            onClick={(ev) => {
              // Don't let the click bubble up into row-select.
              ev.stopPropagation();
              onToggleFavorite?.(b.name, !favorited);
            }}
          >
            <Star size={13} filled={favorited} />
          </button>
        )}
      </div>
    );
  };

  let runningIndex = 0;
  return (
    <div className={`branch-picker${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`branch-picker-trigger${value ? '' : ' is-empty'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <GitBranch size={12} className="branch-picker-icon" aria-hidden />
        <span className="branch-picker-value">
          {value ?? placeholder}
        </span>
        <span className="branch-picker-caret" aria-hidden="true">
          <ChevronDown size={12} />
        </span>
      </button>
      {open && (
        <div
          className="branch-picker-popup"
          ref={popupRef}
          role="dialog"
          aria-label={ariaLabel}
        >
          <div className="branch-picker-search-row">
            <Search size={14} className="search-icon" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={filter}
              placeholder="Filter branches…"
              aria-label="Filter branches"
              autoComplete="off"
              spellCheck={false}
              onChange={(ev) => {
                setFilter(ev.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKey}
            />
            <button
              type="button"
              className="branch-picker-refresh"
              onClick={() => setRefreshToken((n) => n + 1)}
              title="Re-fetch the branch list from the server"
              aria-label="Refresh branch list"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div
            className="branch-picker-list"
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
          >
            {loadError && !branches && visible.flat.length === 0 ? (
              // Hard failure with nothing to show — full error + retry.
              <div className="branch-picker-error">
                Could not load branches.{' '}
                <button
                  type="button"
                  onClick={() => setRefreshToken((n) => n + 1)}
                >
                  Retry
                </button>
              </div>
            ) : (
              // Render locally-known favorites immediately; the full branch list
              // reconciles in below once ListBranches resolves. A spinner row
              // sits under the favorites while loading.
              <>
                {visible.favorites.length > 0 && (
                  <div className="branch-picker-section">
                    <div className="branch-picker-section-head">Favorites</div>
                    {visible.favorites.map((b) =>
                      renderRow(b, runningIndex++, true),
                    )}
                  </div>
                )}
                {visible.rest.length > 0 && (
                  <div className="branch-picker-section">
                    {visible.favorites.length > 0 && (
                      <div className="branch-picker-section-head">
                        All branches
                      </div>
                    )}
                    {visible.rest.map((b) =>
                      renderRow(b, runningIndex++, false),
                    )}
                  </div>
                )}
                {loading && (
                  <div className="branch-picker-loading" role="status">
                    <span className="branch-picker-spinner" aria-hidden="true" />
                    Loading branches…
                  </div>
                )}
                {loadError && (
                  <div className="branch-picker-loading">
                    Couldn’t refresh.{' '}
                    <button
                      type="button"
                      onClick={() => setRefreshToken((n) => n + 1)}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {!loading && !loadError && visible.flat.length === 0 && (
                  <div className="branch-picker-empty">
                    {filter
                      ? `No branches match "${filter}".`
                      : 'No branches found.'}
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
