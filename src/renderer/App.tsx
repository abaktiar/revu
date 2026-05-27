import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, PullRequestSummary } from '@shared/types';
import { api, IpcError, unwrap } from './api';
import { Settings } from './components/Settings';
import {
  PRFilters,
  statusForApi,
  type FilterState,
} from './components/PRFilters';
import { PRList } from './components/PRList';
import { PRDetail } from './components/PRDetail';
import { KeyboardHelpOverlay } from './components/KeyboardHelpOverlay';
import { ErrorBanner } from './components/ErrorBanner';

// Page size for the historical (closed/merged/all) PR loads. CodeCommit
// returns IDs newest-first, so this is "the next 100 most recent." Open
// lists are streamed uncapped since they're naturally small. Larger values
// multiply API load (each PR is GetPullRequest + EvaluatePullRequestApprovalRules).
const HISTORICAL_PAGE = 100;

const DEFAULT_FILTERS: FilterState = {
  status: 'OPEN',
  approval: 'ALL',
  search: '',
};

type View =
  | { kind: 'list' }
  | { kind: 'detail'; pr: PullRequestSummary };

// Live state of an in-flight streaming PR-list session. Mirrors the
// item-event payload's `loaded`/`total` so the loading chip can render a
// counter and a progress bar.
interface LoadingState {
  sessionId: string;
  loaded: number;
  total: number;
  // Distinguishes the initial fresh-load (list is empty, we're populating it)
  // from a Load more (list has items, we're appending). The chip copy uses
  // this to say "Loading…" vs "Loading more…".
  kind: 'initial' | 'more';
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [prs, setPrs] = useState<PullRequestSummary[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [helpOpen, setHelpOpen] = useState(false);
  // Truncation / load-more state. `truncated` is set by the done event when
  // the provider stopped at the cap with more available; `lastId` is the
  // cursor we'll pass as afterId on the next Load more call.
  const [truncated, setTruncated] = useState(false);
  const [lastId, setLastId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<LoadingState | null>(null);

  // Active session id (also stored in `loading.sessionId` but kept in a ref
  // so event handlers can read it synchronously without re-subscribing on
  // every render).
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    unwrap(api.settings.get())
      .then((s) => {
        setSettings(s);
        if (!isReadyToFetch(s)) setSettingsOpen(true);
      })
      .catch((err: unknown) => setError(err));
  }, []);

  // Subscribe to streaming events once on mount. Handlers gate on the active
  // sessionId so events from cancelled sessions (race: cancel sent, item
  // already in flight) are ignored. Without this gate, a stale event from
  // the prior session could re-populate after Refresh started a new one.
  useEffect(() => {
    const offItem = api.prs.onListItem((ev) => {
      if (ev.sessionId !== sessionIdRef.current) return;
      setPrs((cur) => [...cur, ev.item]);
      setLoading((cur) =>
        cur && cur.sessionId === ev.sessionId
          ? { ...cur, loaded: ev.loaded, total: ev.total }
          : cur,
      );
    });
    const offDone = api.prs.onListDone((ev) => {
      if (ev.sessionId !== sessionIdRef.current) return;
      // truncated is the provider's word on whether AWS had more. After a
      // Load more that didn't fill the cap, this naturally becomes false
      // and the banner disappears — that's the signal "you've seen it all."
      setTruncated(ev.truncated);
      // Only advance the cursor if we actually delivered something. A zero-
      // delivery session (cancel before first batch finished, or all PRs in
      // the page failed) shouldn't clobber the cursor from the prior load.
      if (ev.lastId) setLastId(ev.lastId);
      setLoading(null);
      sessionIdRef.current = null;
    });
    const offError = api.prs.onListError((ev) => {
      if (ev.sessionId !== sessionIdRef.current) return;
      setError(new IpcError(ev.error, ev.errorCode ?? 'unknown', ev.errorHint));
      setLoading(null);
      sessionIdRef.current = null;
    });
    return () => {
      offItem();
      offDone();
      offError();
    };
  }, []);

  const persistSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    try {
      const saved = await unwrap(api.settings.set(next));
      setSettings(saved);
    } catch (err) {
      setError(err);
    }
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      const fresh = await unwrap(api.settings.get());
      setSettings(fresh);
    } catch (err) {
      setError(err);
    }
  }, []);

  // Refresh: cancel anything in flight, clear the list, start a fresh stream.
  // The streamed PRs appear in the list as they arrive — no waiting for the
  // whole batch.
  const refresh = useCallback(
    async (forceFresh = true): Promise<void> => {
      if (!settings || !isReadyToFetch(settings)) {
        setError(
          new Error('Finish configuring credentials, region, and repository above.'),
        );
        setSettingsOpen(true);
        return;
      }
      // Cancel any in-flight session. Fire-and-forget; the prior session's
      // done event (with cancelled=true) will land and be ignored because
      // sessionIdRef will have moved on.
      const prior = sessionIdRef.current;
      if (prior) void api.prs.cancelList(prior).catch(() => {});

      const sessionId = crypto.randomUUID();
      sessionIdRef.current = sessionId;
      setPrs([]);
      setError(null);
      setTruncated(false);
      setLastId(undefined);
      setLoading({ sessionId, loaded: 0, total: 0, kind: 'initial' });

      try {
        if (forceFresh) {
          // Drop per-PR + per-repo caches so the stream goes straight to AWS.
          await unwrap(api.cache.invalidateRepo(settings.repositoryName!));
        }
        await unwrap(
          api.prs.startList({
            sessionId,
            repositoryName: settings.repositoryName!,
            filter: {
              status: statusForApi(filters.status),
              limit: filters.status === 'OPEN' ? undefined : HISTORICAL_PAGE,
            },
            forceFresh,
          }),
        );
      } catch (err) {
        // startList failed before the session got going — clear state. If
        // the failure was after some items streamed (it shouldn't be, but
        // belt and suspenders), an error event will land via the subscription
        // and overwrite this.
        if (sessionIdRef.current === sessionId) {
          setError(err);
          setLoading(null);
          sessionIdRef.current = null;
        }
      }
    },
    [settings, filters.status],
  );

  // Load more: continue the stream from where the last session stopped.
  // Keeps `prs` intact and appends new items as they arrive.
  const loadMore = useCallback(async (): Promise<void> => {
    if (!settings || loading || !lastId) return;
    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;
    setError(null);
    setLoading({ sessionId, loaded: 0, total: 0, kind: 'more' });
    try {
      await unwrap(
        api.prs.startList({
          sessionId,
          repositoryName: settings.repositoryName!,
          filter: {
            status: statusForApi(filters.status),
            limit: HISTORICAL_PAGE,
            afterId: lastId,
          },
          // No forceFresh — we want to keep the per-PR cache built up by the
          // first page so already-loaded PRs (none, since afterId skips them
          // server-side, but defensive) come back instantly.
          forceFresh: false,
        }),
      );
    } catch (err) {
      if (sessionIdRef.current === sessionId) {
        setError(err);
        setLoading(null);
        sessionIdRef.current = null;
      }
    }
  }, [settings, filters.status, lastId, loading]);

  // Cancel button: stops the current stream. Items already streamed remain.
  // The done event (with cancelled=true) will clear loading state.
  const cancel = useCallback((): void => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    void api.prs.cancelList(sid).catch(() => {});
  }, []);

  // Status change → cancel any in-flight session and reset the list. We
  // don't auto-trigger a refresh; the user clicks Refresh when they're ready
  // to spend the API calls on the new status.
  useEffect(() => {
    const prior = sessionIdRef.current;
    if (prior) {
      void api.prs.cancelList(prior).catch(() => {});
      sessionIdRef.current = null;
    }
    setPrs([]);
    setError(null);
    setTruncated(false);
    setLastId(undefined);
    setLoading(null);
  }, [filters.status]);

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

  const showTruncationBanner =
    truncated && !loading && !error && prs.length > 0 && !!lastId;

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
        loading={loading}
        onCancel={cancel}
      />
      <div className="list-wrap">
        {showTruncationBanner && (
          <TruncationBanner
            shown={prs.length}
            onLoadMore={() => void loadMore()}
          />
        )}
        {prs.length > 0 ? (
          <PRList
            prs={visible}
            repositoryName={settings.repositoryName}
            onOpen={(pr) => setView({ kind: 'detail', pr })}
          />
        ) : loading ? (
          // Empty list + active stream = first items haven't arrived yet.
          // The chip in PRFilters has the counter; this just keeps the
          // empty area from looking abandoned.
          <div className="empty">Waiting for the first results…</div>
        ) : error ? null : (
          <div className="empty">
            {isReadyToFetch(settings)
              ? 'Click Refresh to load PRs.'
              : 'Finish configuring credentials, region, and repository in Settings.'}
          </div>
        )}
        {error ? (
          <ErrorBanner
            title={
              prs.length > 0
                ? 'Stopped loading more pull requests.'
                : 'Could not load pull requests.'
            }
            error={error}
            onRetry={() => void refresh(true)}
            retryLabel="Retry"
            retrying={!!loading}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : null}
      </div>
      <KeyboardHelpOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}

// Banner that sits above the PR list when more pages are available. Renders
// only when truncated AND idle — during an active Load more, the chip in
// PRFilters carries the loading affordance instead.
function TruncationBanner({
  shown,
  onLoadMore,
}: {
  shown: number;
  onLoadMore: () => void;
}): JSX.Element {
  return (
    <div className="truncation-banner" role="status">
      <span>
        Showing the <strong>{shown}</strong> most recent pull requests.
      </span>
      <button onClick={onLoadMore}>Load {HISTORICAL_PAGE} more</button>
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
