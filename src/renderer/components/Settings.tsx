import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AWS_CODECOMMIT_REGIONS,
  type AppSettings,
  type AwsProfileInfo,
  type ChecklistItem,
} from '@shared/types';
import { api, unwrap } from '../api';
import { maskKey, parseEnvBlock } from '../parseEnvBlock';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle,
  Key,
  Monitor,
  Moon,
  Plus,
  Sun,
  Trash2,
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

        <section className="settings-section settings-section-wide">
          <header className="settings-section-head">
            <h3>Approval checklist</h3>
            <p>
              A reminder shown when approving a PR in
              {settings.repositoryName ? ' ' : ' the current repository — '}
              {settings.repositoryName ? (
                <code>{settings.repositoryName}</code>
              ) : null}
              . Checked items are recorded in the PR description. Export to share
              it with your team.
            </p>
          </header>
          <div className="settings-section-body">
            {settings.repositoryName ? (
              <ChecklistEditor repositoryName={settings.repositoryName} />
            ) : (
              <span className="hint">
                Select a repository to configure its approval checklist.
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ChecklistEditor({
  repositoryName,
}: {
  repositoryName: string;
}): JSX.Element {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  // Last-saved snapshot, used to compute the dirty state.
  const [saved, setSaved] = useState<ChecklistItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const tpl = await unwrap(api.checklistTemplate.get(repositoryName));
      setItems(tpl.items);
      setSaved(tpl.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [repositoryName]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(items) !== JSON.stringify(saved),
    [items, saved],
  );

  function addItem(): void {
    setStatus(null);
    setItems((cur) => [
      ...cur,
      { id: crypto.randomUUID(), text: '', required: false },
    ]);
  }
  function setText(id: string, text: string): void {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, text } : i)));
  }
  function toggleRequired(id: string): void {
    setItems((cur) =>
      cur.map((i) => (i.id === id ? { ...i, required: !i.required } : i)),
    );
  }
  function remove(id: string): void {
    setItems((cur) => cur.filter((i) => i.id !== id));
  }
  function move(index: number, dir: -1 | 1): void {
    setItems((cur) => {
      const next = [...cur];
      const j = index + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });
  }

  async function persist(next: ChecklistItem[]): Promise<ChecklistItem[]> {
    const tpl = await unwrap(
      api.checklistTemplate.set(
        repositoryName,
        next.filter((i) => i.text.trim()),
      ),
    );
    setItems(tpl.items);
    setSaved(tpl.items);
    return tpl.items;
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await persist(items);
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doExport(): Promise<void> {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      // Export reads the saved template, so flush unsaved edits first.
      if (dirty) await persist(items);
      const ok = await unwrap(api.checklistTemplate.export(repositoryName));
      setStatus(ok ? 'Exported' : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doImport(): Promise<void> {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const tpl = await unwrap(api.checklistTemplate.import(repositoryName));
      if (tpl) {
        setItems(tpl.items);
        setSaved(tpl.items);
        setStatus('Imported');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="checklist-editor">
      {items.length === 0 ? (
        <p className="hint">No checklist items yet.</p>
      ) : (
        <ul className="checklist-items">
          {items.map((it, idx) => (
            <li key={it.id} className="checklist-item">
              <span className="checklist-reorder">
                <button
                  type="button"
                  className="ghost icon"
                  aria-label="Move up"
                  disabled={idx === 0}
                  onClick={() => move(idx, -1)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  className="ghost icon"
                  aria-label="Move down"
                  disabled={idx === items.length - 1}
                  onClick={() => move(idx, 1)}
                >
                  <ArrowDown size={13} />
                </button>
              </span>
              <input
                type="text"
                className="checklist-item-text"
                value={it.text}
                placeholder="e.g. I ran the tests locally"
                onChange={(e) => setText(it.id, e.target.value)}
              />
              <label className="checklist-required" title="Required item">
                <input
                  type="checkbox"
                  checked={it.required}
                  onChange={() => toggleRequired(it.id)}
                />
                Required
              </label>
              <button
                type="button"
                className="ghost icon checklist-remove"
                aria-label="Remove item"
                onClick={() => remove(it.id)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="checklist-editor-actions">
        <button type="button" onClick={addItem} disabled={busy}>
          <Plus size={13} /> Add item
        </button>
        <span className="grow" />
        {status && <span className="hint ok">{status}</span>}
        {error && <span className="hint warn">{error}</span>}
        <button type="button" onClick={() => void doImport()} disabled={busy}>
          Import…
        </button>
        <button type="button" onClick={() => void doExport()} disabled={busy}>
          Export…
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
        >
          {busy ? 'Saving…' : 'Save checklist'}
        </button>
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
