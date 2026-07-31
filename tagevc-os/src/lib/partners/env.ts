/**
 * Partner env / connection status — never invents credentials.
 */

import {
  PARTNER_CATALOG,
  asCatalogEntry,
  type PartnerCatalogEntry,
  type PartnerKey,
} from '@/lib/partners/catalog';

export type PartnerConnectionStatus =
  | 'not_configured'
  | 'scaffold'
  | 'scaffolded'
  | 'configured'
  | 'live'
  | 'error'
  | 'disabled';

export function envPresent(keys: string[]): boolean {
  return keys.every((k) => Boolean(process.env[k]?.trim()));
}

export function envAnyPresent(keys: string[]): boolean {
  return keys.some((k) => Boolean(process.env[k]?.trim()));
}

export function isPartnerLive(entry: PartnerCatalogEntry): boolean {
  if (!entry.liveEnvKey) {
    return envPresent(
      entry.envKeys.filter((k) => !k.endsWith('_LIVE')).slice(0, 4),
    );
  }
  return process.env[entry.liveEnvKey]?.trim() === '1';
}

export function partnerConnectionStatus(
  key: PartnerKey,
): PartnerConnectionStatus {
  const raw = PARTNER_CATALOG.find((p) => p.key === key);
  if (!raw) return 'not_configured';
  const entry = asCatalogEntry(raw);

  if (key === 'docusign') {
    const configured = envPresent([
      'DOCUSIGN_INTEGRATION_KEY',
      'DOCUSIGN_USER_ID',
      'DOCUSIGN_ACCOUNT_ID',
      'DOCUSIGN_PRIVATE_KEY',
    ]);
    return configured ? 'live' : 'scaffold';
  }

  if (key === 'verified_first') {
    const hasKey = Boolean(process.env.VERIFIED_FIRST_API_KEY?.trim());
    if (!hasKey) return 'scaffold';
    return isPartnerLive(entry) ? 'live' : 'configured';
  }

  const secretKeys = entry.envKeys.filter((k) => !k.endsWith('_LIVE'));
  const hasSecrets = envAnyPresent(secretKeys);
  if (!hasSecrets) return 'scaffold';
  if (entry.liveEnvKey && !isPartnerLive(entry)) return 'configured';
  return isPartnerLive(entry) ? 'live' : 'configured';
}

export function partnerSetupNote(key: PartnerKey): string {
  const raw = PARTNER_CATALOG.find((p) => p.key === key);
  if (!raw) return 'Unknown partner.';
  const entry = asCatalogEntry(raw);
  const missing = entry.envKeys.filter(
    (k) => !k.endsWith('_LIVE') && !process.env[k]?.trim(),
  );
  if (missing.length === 0) {
    if (entry.liveEnvKey && process.env[entry.liveEnvKey]?.trim() !== '1') {
      return `Secrets present. Set ${entry.liveEnvKey}=1 to go live (fail-closed).`;
    }
    return 'Configured.';
  }
  return `Set env: ${missing.join(', ')}. See ${entry.docsPath}.`;
}

export type PartnerRuntimeRow = {
  key: PartnerKey;
  name: string;
  ownerFunction: PartnerCatalogEntry['ownerFunction'];
  status: PartnerConnectionStatus;
  setupNote: string;
  manageHref: string;
  live: boolean;
};

export function listPartnerRuntimeStatuses(): PartnerRuntimeRow[] {
  return PARTNER_CATALOG.map((p) => {
    const entry = asCatalogEntry(p);
    return {
      key: p.key,
      name: entry.name,
      ownerFunction: entry.ownerFunction,
      status: partnerConnectionStatus(p.key),
      setupNote: partnerSetupNote(p.key),
      manageHref: entry.manageHref,
      live: isPartnerLive(entry),
    };
  });
}
