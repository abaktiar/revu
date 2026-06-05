import { useEffect, useMemo, useState } from 'react';
import {
  AWS_CODECOMMIT_REGIONS,
  type AppSettings,
  type AwsProfileInfo,
} from '@shared/types';
import { api, unwrap } from '../api';
import { maskKey, parseEnvBlock } from '../parseEnvBlock';
import {
  Check,
  CheckCircle,
  Key,
  Monitor,
  Moon,
  Sun,
  User,
} from '../icons';

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

  return (
    <div className="settings-panel">
      <div className="settings-grid">
        <section className="settings-section">
          <header className="settings-section-head">
            <h3>Appearance</h3>
            <p>How revu looks on this machine.</p>
          </header>
          <div className="settings-section-body">
            <div className="seg seg-icons" role="radiogroup" aria-label="Theme">
              <SegButton
                active={settings.themePreference === 'light'}
                onClick={() => update('themePreference', 'light')}
                icon={<Sun size={14} />}
                label="Light"
              />
              <SegButton
                active={settings.themePreference === 'dark'}
                onClick={() => update('themePreference', 'dark')}
                icon={<Moon size={14} />}
                label="Dark"
              />
              <SegButton
                active={settings.themePreference === 'system'}
                onClick={() => update('themePreference', 'system')}
                icon={<Monitor size={14} />}
                label="System"
              />
            </div>
          </div>
        </section>

        <section className="settings-section">
          <header className="settings-section-head">
            <h3>Credentials</h3>
            <p>Authentication and target region.</p>
          </header>
          <div className="settings-section-body">
            <div className="seg" role="radiogroup" aria-label="Credential source">
              <SegButton
                active={settings.credentialSource === 'profile'}
                onClick={() => update('credentialSource', 'profile')}
                icon={<User size={14} />}
                label="AWS profile"
              />
              <SegButton
                active={settings.credentialSource === 'keys'}
                onClick={() => update('credentialSource', 'keys')}
                icon={<Key size={14} />}
                label="Access keys"
              />
            </div>
            {settings.credentialSource === 'profile' ? (
              <div className="settings-row">
                <label className="settings-label">
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
              </div>
            ) : (
              <KeysPanel
                hasKeys={settings.hasManualKeys}
                onSaved={onCredentialsChanged}
              />
            )}
            <div className="settings-row">
              <label className="settings-label">
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
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SegButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}): JSX.Element {
  return (
    <button
      className={`seg-btn${active ? ' active' : ''}`}
      onClick={onClick}
      type="button"
      role="radio"
      aria-checked={active}
    >
      {icon}
      <span>{label}</span>
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
      <div className="settings-keys-saved">
        <CheckCircle size={14} className="ok-icon" />
        <span>Access keys saved in OS keychain.</span>
        <span className="grow" />
        <button onClick={() => setEditing(true)} disabled={busy}>
          Replace
        </button>
        <button onClick={() => void clear()} disabled={busy}>
          Clear
        </button>
        {error && <span className="hint warn">{error}</span>}
      </div>
    );
  }

  return (
    <div className="keys-edit">
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
            <Check size={12} />
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
    </div>
  );
}
