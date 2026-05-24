import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AppSettings, ManualCredentialsInput } from '@shared/types';

const SETTINGS_FILE = 'settings.json';
const CREDS_FILE = 'manual-credentials.bin'; // raw encrypted bytes

// On-disk shape — `hasManualKeys` is derived at read time, never stored.
type PersistedSettings = Omit<AppSettings, 'hasManualKeys'>;

const DEFAULTS: PersistedSettings = {
  credentialSource: 'profile',
  favoriteRepos: [],
};

let cache: PersistedSettings | null = null;

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE);
}

function credsPath(): string {
  return join(app.getPath('userData'), CREDS_FILE);
}

export async function loadSettings(): Promise<AppSettings> {
  const persisted = await loadPersisted();
  const hasManualKeys = await fileExists(credsPath());
  return { ...persisted, hasManualKeys };
}

export async function saveSettings(
  next: Omit<AppSettings, 'hasManualKeys'>,
): Promise<AppSettings> {
  const cleaned: PersistedSettings = {
    credentialSource: next.credentialSource,
    profile: next.profile,
    region: next.region,
    repositoryName: next.repositoryName,
    favoriteRepos: dedupe(next.favoriteRepos),
  };
  cache = cleaned;
  await fs.writeFile(settingsPath(), JSON.stringify(cleaned, null, 2), 'utf8');
  return loadSettings();
}

export async function saveManualCredentials(
  creds: ManualCredentialsInput,
): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS keychain is unavailable — cannot securely store access keys on this machine.',
    );
  }
  if (!creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error('Access Key ID and Secret Access Key are both required.');
  }
  const blob = safeStorage.encryptString(JSON.stringify(creds));
  await fs.writeFile(credsPath(), blob);
}

export async function clearManualCredentials(): Promise<void> {
  try {
    await fs.unlink(credsPath());
  } catch (err: unknown) {
    if (!(isNodeError(err) && err.code === 'ENOENT')) throw err;
  }
}

/**
 * Main-process-only: decrypt and return the stored manual credentials.
 * NEVER expose this over IPC.
 */
export async function readManualCredentials(): Promise<ManualCredentialsInput | null> {
  try {
    const blob = await fs.readFile(credsPath());
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'OS keychain is unavailable — cannot decrypt stored access keys.',
      );
    }
    const json = safeStorage.decryptString(blob);
    return JSON.parse(json) as ManualCredentialsInput;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function loadPersisted(): Promise<PersistedSettings> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    cache = {
      credentialSource: parsed.credentialSource ?? DEFAULTS.credentialSource,
      profile: parsed.profile,
      region: parsed.region,
      repositoryName: parsed.repositoryName,
      favoriteRepos: dedupe(parsed.favoriteRepos ?? []),
    };
    return cache;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      cache = { ...DEFAULTS };
      return cache;
    }
    throw err;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.filter((x) => x && x.trim().length > 0))];
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
