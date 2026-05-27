import { useEffect, useMemo, useState } from 'react';
import {
  AWS_CODECOMMIT_REGIONS,
  type AppSettings,
  type AwsProfileInfo,
  type CredentialSource,
  type RepositorySummary,
  type ThemePreference,
} from '@shared/types';
import { api, IpcError, unwrap } from '../api';
import { maskKey, parseEnvBlock } from '../parseEnvBlock';

interface Props {
  settings: AppSettings;
  onChange: (next: AppSettings) => Promise<void>;
  onCredentialsChanged: () => Promise<void>;
}

export function Settings({
  settings,
  onChange,
  onCredentialsChanged,
}: Props): JSX.Element {
  const [profiles, setProfiles] = useState<AwsProfileInfo[]>([]);
  const [repos, setRepos] = useState<RepositorySummary[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<{ message: string; hint?: string } | null>(null);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  useEffect(() => {
    unwrap(api.aws.listProfiles())
      .then(setProfiles)
      .catch((err: Error) => setProfilesError(err.message));
  }, []);

  function update<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ): void {
    void onChange({ ...settings, [key]: value });
  }

  async function refreshRepos(): Promise<void> {
    setReposLoading(true);
    setReposError(null);
    try {
      setRepos(await unwrap(api.repos.list()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hint =
        err instanceof IpcError ? err.hint : undefined;
      setReposError({ message, hint });
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  }

  const favSet = useMemo(
    () => new Set(settings.favoriteRepos),
    [settings.favoriteRepos],
  );

  function toggleFavorite(name: string): void {
    if (!name) return;
    const next = favSet.has(name)
      ? settings.favoriteRepos.filter((n) => n !== name)
      : [...settings.favoriteRepos, name];
    update('favoriteRepos', next);
  }

  // Sort repos: favorites first (alpha), then the rest. Always include the
  // currently-selected repo so the dropdown shows it even before a refresh.
  const allRepoNames = useMemo(() => {
    const names = new Set(repos.map((r) => r.name));
    for (const f of settings.favoriteRepos) names.add(f);
    if (settings.repositoryName) names.add(settings.repositoryName);
    return [...names];
  }, [repos, settings.favoriteRepos, settings.repositoryName]);

  const favorites = allRepoNames
    .filter((n) => favSet.has(n))
    .sort((a, b) => a.localeCompare(b));
  const others = allRepoNames
    .filter((n) => !favSet.has(n))
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className="settings-panel">
      <section className="row">
        <h3>Appearance</h3>
        <div className="seg">
          {(['light', 'dark', 'system'] as ThemePreference[]).map((t) => (
            <SegButton
              key={t}
              active={settings.themePreference === t}
              onClick={() => update('themePreference', t)}
            >
              {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System'}
            </SegButton>
          ))}
        </div>
      </section>

      <section className="row">
        <h3>Credentials</h3>
        <div className="seg">
          <SegButton
            active={settings.credentialSource === 'profile'}
            onClick={() => update('credentialSource', 'profile')}
          >
            AWS profile
          </SegButton>
          <SegButton
            active={settings.credentialSource === 'keys'}
            onClick={() => update('credentialSource', 'keys')}
          >
            Access keys (paste)
          </SegButton>
        </div>
      </section>

      {settings.credentialSource === 'profile' ? (
        <section className="row">
          <label>
            Profile
            <select
              value={settings.profile ?? ''}
              onChange={(e) =>
                update(
                  'profile',
                  e.target.value === '' ? undefined : e.target.value,
                )
              }
              title={profilesError ?? undefined}
            >
              <option value="">(default credential chain)</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.region ? ` · ${p.region}` : ''}
                </option>
              ))}
            </select>
          </label>
          {profilesError && (
            <span className="hint warn">{profilesError}</span>
          )}
        </section>
      ) : (
        <KeysPanel
          hasKeys={settings.hasManualKeys}
          onSaved={onCredentialsChanged}
        />
      )}

      <section className="row">
        <label>
          Region
          <select
            value={settings.region ?? ''}
            onChange={(e) => update('region', e.target.value || undefined)}
          >
            <option value="">(none)</option>
            {AWS_CODECOMMIT_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · {r.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="row">
        <label>
          Repository
          <select
            value={settings.repositoryName ?? ''}
            onChange={(e) =>
              update('repositoryName', e.target.value || undefined)
            }
          >
            <option value="">(none)</option>
            {favorites.length > 0 && (
              <optgroup label="★ Favorites">
                {favorites.map((name) => (
                  <option key={`fav-${name}`} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="All repositories">
                {others.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button
          onClick={() => toggleFavorite(settings.repositoryName ?? '')}
          disabled={!settings.repositoryName}
          title={
            settings.repositoryName && favSet.has(settings.repositoryName)
              ? 'Remove from favorites'
              : 'Add to favorites'
          }
          className="star"
        >
          {settings.repositoryName && favSet.has(settings.repositoryName)
            ? '★'
            : '☆'}
        </button>
        <button onClick={() => void refreshRepos()} disabled={reposLoading}>
          {reposLoading ? 'Loading…' : 'Refresh repos'}
        </button>
        {reposError && (
          <div className="hint warn settings-inline-error">
            <div>{reposError.message}</div>
            {reposError.hint && (
              <div className="settings-inline-error-hint">{reposError.hint}</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      className={`seg-btn${active ? ' active' : ''}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function KeysPanel({
  hasKeys,
  onSaved,
}: {
  hasKeys: boolean;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!hasKeys);

  const parsed = useMemo(() => parseEnvBlock(text), [text]);

  async function save(): Promise<void> {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.creds.save(parsed));
      setText('');
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clear(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.creds.clear());
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (hasKeys && !editing) {
    return (
      <section className="row keys">
        <span className="ok-dot">●</span>
        <span>Access keys saved in OS keychain.</span>
        <span className="grow" />
        <button onClick={() => setEditing(true)} disabled={busy}>
          Replace
        </button>
        <button onClick={() => void clear()} disabled={busy}>
          Clear
        </button>
        {error && <span className="hint warn">{error}</span>}
      </section>
    );
  }

  return (
    <section className="keys-edit">
      <div className="hint">
        Paste the {'"'}Option 1: Set AWS environment variables{'"'} block from
        the AWS access portal. The values are encrypted with your OS keychain
        via Electron <code>safeStorage</code> and never shown again.
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder={`export AWS_ACCESS_KEY_ID="ASIA..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."`}
      />
      <div className="keys-actions">
        {parsed ? (
          <span className="hint ok">
            Detected: <code>{maskKey(parsed.accessKeyId)}</code>
            {parsed.sessionToken ? ' (with session token)' : ''}
          </span>
        ) : text.trim() ? (
          <span className="hint warn">
            Could not find AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the
            pasted text.
          </span>
        ) : (
          <span className="hint">Awaiting paste…</span>
        )}
        <span className="grow" />
        {hasKeys && (
          <button onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
        )}
        <button
          className="primary"
          onClick={() => void save()}
          disabled={!parsed || busy}
        >
          {busy ? 'Saving…' : 'Save keys'}
        </button>
      </div>
      {error && <div className="hint warn">{error}</div>}
    </section>
  );
}
