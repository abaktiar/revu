import type { ManualCredentialsInput } from '@shared/types';

/**
 * Parse the AWS "Option 1: Set AWS environment variables" snippet from the
 * IAM Identity Center / SSO portal. Accepts the common shell variants the
 * portal emits as well as raw KEY=VALUE lines:
 *
 *   export AWS_ACCESS_KEY_ID="ASIA..."
 *   export AWS_ACCESS_KEY_ID=ASIA...
 *   AWS_ACCESS_KEY_ID=ASIA...
 *   set AWS_ACCESS_KEY_ID=ASIA...
 *   $Env:AWS_ACCESS_KEY_ID="ASIA..."
 *   setx AWS_ACCESS_KEY_ID "ASIA..."
 *
 * Returns the parsed credentials, or null if AccessKeyId / SecretAccessKey
 * couldn't be found.
 */
export function parseEnvBlock(text: string): ManualCredentialsInput | null {
  const vars: Record<string, string> = {};
  const wanted = new Set([
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
  ]);

  // Strip common shell prefixes, then match KEY = VALUE / KEY VALUE pairs.
  // We scan line-by-line so a value can't accidentally swallow the next line.
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const stripped = line
      .replace(/^export\s+/i, '')
      .replace(/^set\s+/i, '')
      .replace(/^setx\s+/i, '')
      .replace(/^\$env:/i, '')
      .replace(/;$/, '')
      .trim();

    // Forms: KEY=VALUE  or  KEY VALUE  (setx uses space)
    const m = stripped.match(/^([A-Z_][A-Z0-9_]*)\s*(?:=|\s)\s*(.+)$/i);
    if (!m || !m[1] || !m[2]) continue;
    const key = m[1].toUpperCase();
    if (!wanted.has(key)) continue;

    vars[key] = unquote(m[2].trim());
  }

  const accessKeyId = vars.AWS_ACCESS_KEY_ID;
  const secretAccessKey = vars.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

  const sessionToken = vars.AWS_SESSION_TOKEN || undefined;
  return { accessKeyId, secretAccessKey, sessionToken };
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

export function maskKey(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}
