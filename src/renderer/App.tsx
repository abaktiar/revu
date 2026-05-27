import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, PullRequestSummary } from '@shared/types';
import { api, unwrap } from './api';
import { Settings } from './components/Settings';
import {
  PRFilters,
  statusForApi,
  type FilterState,
} from './components/PRFilters';
import { PRList } from './components/PRList';
import { PRDetail } from './components/PRDetail';
import { KeyboardHelpOverlay } from './components/KeyboardHelpOverlay';

const DEFAULT_FILTERS: FilterState = {
  status: 'OPEN',
  approval: 'ALL',
  search: '',
};

type View =
  | { kind: 'list' }
  | { kind: 'detail'; pr: PullRequestSummary };

export function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [prs, setPrs] = useState<PullRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    unwrap(api.settings.get())
      .then((s) => {
        setSettings(s);
        if (!isReadyToFetch(s)) setSettingsOpen(true);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const persistSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    try {
      const saved = await unwrap(api.settings.set(next));
      setSettings(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      const fresh = await unwrap(api.settings.get());
      setSettings(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Two entry points: the initial load (which is happy with a cache hit) and
  // the explicit Refresh button (which bypasses the cache). The button calls
  // refresh(true); the initial path passes nothing so it stays cheap.
  const refresh = useCallback(
    async (forceFresh = false): Promise<void> => {
      if (!settings || !isReadyToFetch(settings)) {
        setError(
          'Finish configuring credentials, region, and repository above.',
        );
        setSettingsOpen(true);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (forceFresh) {
          // Wipe per-PR and list caches for this repo so the next read goes
          // to AWS. Doing this in main keeps the cache state consistent with
          // what the renderer is about to fetch.
          await unwrap(api.cache.invalidateRepo(settings.repositoryName!));
        }
        const list = await unwrap(
          api.prs.list(
            settings.repositoryName!,
            { status: statusForApi(filters.status) },
            { forceFresh },
          ),
        );
        setPrs(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPrs([]);
      } finally {
        setLoading(false);
      }
    },
    [settings, filters.status],
  );

  const visible = useMemo(
    () => applyClientFilters(prs, filters),
    [prs, filters],
  );

  // List-level keyboard shortcuts. Only active when the list view is on screen
  // and the user isn't typing into a field; `/` focuses the title-or-author
  // filter, Esc clears it when populated. These are the small power-user beats
  // that PRODUCT.md commits to but the mouse-only flow couldn't deliver.
  useEffect(() => {
    if (view.kind !== 'list') return;
    if (helpOpen) return;
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !isTyping) {
        const el = document.querySelector<HTMLInputElement>(
          '.filters input[type="search"]',
        );
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
      } else if (e.key === 'Escape' && isTyping && filters.search) {
        setFilters((f) => ({ ...f, search: '' }));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.kind, filters.search, helpOpen]);

  // Global help-overlay toggle. `?` opens (Shift+/ on US layouts), Cmd/Ctrl+/
  // is the editor-shaped alt. Closing is handled inside the overlay so the
  // listener there owns Esc capture.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isTyping) return;
      if (e.key === '?' || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!settings) {
    return <div className="loading">Loading settings…</div>;
  }

  if (view.kind === 'detail' && settings.repositoryName) {
    return (
      <div className="app">
        <PRDetail
          repositoryName={settings.repositoryName}
          pullRequest={view.pr}
          onBack={() => setView({ kind: 'list' })}
        />
        <KeyboardHelpOverlay
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">revu</div>
        <span className="grow" />
        <SettingsSummary settings={settings} />
        <button
          onClick={() => setHelpOpen(true)}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
        <button onClick={() => setSettingsOpen((v) => !v)}>
          {settingsOpen ? 'Close settings' : 'Settings'}
        </button>
      </div>
      {settingsOpen && (
        <Settings
          settings={settings}
          onChange={persistSettings}
          onCredentialsChanged={reloadSettings}
        />
      )}
      <PRFilters
        value={filters}
        onChange={setFilters}
        onRefresh={() => void refresh(true)}
        busy={loading}
      />
      <div className="list-wrap">
        {error ? (
          <div className="error">
            <div>Could not load pull requests.</div>
            <pre>{error}</pre>
          </div>
        ) : loading ? (
          <div className="loading">Loading…</div>
        ) : prs.length === 0 ? (
          <div className="empty">
            {isReadyToFetch(settings)
              ? 'Click Refresh to load PRs.'
              : 'Finish configuring credentials, region, and repository in Settings.'}
          </div>
        ) : (
          <PRList prs={visible} onOpen={(pr) => setView({ kind: 'detail', pr })} />
        )}
      </div>
      <KeyboardHelpOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}

function SettingsSummary({ settings }: { settings: AppSettings }): JSX.Element {
  const credLabel =
    settings.credentialSource === 'keys'
      ? settings.hasManualKeys
        ? 'keys ✓'
        : 'keys (not set)'
      : (settings.profile ?? 'default chain');
  const parts = [
    credLabel,
    settings.region ?? 'no region',
    settings.repositoryName ?? 'no repo',
  ];
  return <span className="summary">{parts.join('  ·  ')}</span>;
}

function isReadyToFetch(s: AppSettings): boolean {
  if (!s.region || !s.repositoryName) return false;
  if (s.credentialSource === 'keys' && !s.hasManualKeys) return false;
  return true;
}

function applyClientFilters(
  prs: PullRequestSummary[],
  f: FilterState,
): PullRequestSummary[] {
  const q = f.search.trim().toLowerCase();
  return prs.filter((pr) => {
    if (f.status === 'MERGED' && pr.mergeState !== 'MERGED') return false;
    if (f.status === 'CLOSED' && pr.status !== 'CLOSED') return false;
    if (f.status === 'OPEN' && pr.status !== 'OPEN') return false;
    if (f.approval !== 'ALL' && pr.approvalState !== f.approval) return false;
    if (q) {
      const hay = `${pr.title} ${pr.authorArn ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
