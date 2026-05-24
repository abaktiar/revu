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

const DEFAULT_FILTERS: FilterState = {
  status: 'OPEN',
  approval: 'ALL',
  search: '',
};

export function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [prs, setPrs] = useState<PullRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Load persisted settings once on mount, then auto-open the settings panel
  // if the user hasn't finished configuring yet.
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

  const refresh = useCallback(async () => {
    if (!settings || !isReadyToFetch(settings)) {
      setError('Finish configuring credentials, region, and repository above.');
      setSettingsOpen(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await unwrap(
        api.prs.list(settings.repositoryName!, {
          status: statusForApi(filters.status),
        }),
      );
      setPrs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPrs([]);
    } finally {
      setLoading(false);
    }
  }, [settings, filters.status]);

  const visible = useMemo(
    () => applyClientFilters(prs, filters),
    [prs, filters],
  );

  if (!settings) {
    return <div className="loading">Loading settings…</div>;
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">revu</div>
        <span className="grow" />
        <SettingsSummary settings={settings} />
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
        onRefresh={() => void refresh()}
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
          <PRList prs={visible} />
        )}
      </div>
    </div>
  );
}

function SettingsSummary({ settings }: { settings: AppSettings }): JSX.Element {
  const credLabel =
    settings.credentialSource === 'keys'
      ? settings.hasManualKeys
        ? 'keys ✓'
        : 'keys (not set)'
      : settings.profile ?? 'default chain';
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
