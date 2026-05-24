import {
  loadSharedConfigFiles,
  type ParsedIniData,
} from '@smithy/shared-ini-file-loader';
import type { AwsProfileInfo } from '@shared/types';

/**
 * Read AWS profile names from ~/.aws/credentials and ~/.aws/config.
 * Returns a de-duplicated list (a profile in both files appears once,
 * with `source` reflecting where it was first found).
 */
export async function listAwsProfiles(): Promise<AwsProfileInfo[]> {
  const { credentialsFile, configFile } = await loadSharedConfigFiles();
  const seen = new Map<string, AwsProfileInfo>();

  collectProfiles(credentialsFile, 'credentials', seen);
  collectProfiles(configFile, 'config', seen);

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectProfiles(
  data: ParsedIniData,
  source: 'credentials' | 'config',
  out: Map<string, AwsProfileInfo>,
): void {
  for (const [name, profile] of Object.entries(data)) {
    if (out.has(name)) continue;
    out.set(name, {
      name,
      source,
      region: typeof profile?.region === 'string' ? profile.region : undefined,
    });
  }
}
