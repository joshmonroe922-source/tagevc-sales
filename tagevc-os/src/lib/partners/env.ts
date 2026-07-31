/**
 * Partner env / connection status — never invents credentials.
 */

import { PARTNER_CATALOG } from '@/lib/partners/catalog';
import type {
  PartnerCatalogEntry,
  PartnerConnectionStatus,
  PartnerKey,
} from '@/lib/partners/types';

export function envPresent(keys: string[]): boolean {
  return keys.every((k) => Boolean(process.env[k]?.trim()));
}

export function envAnyPresent(keys: string[]): boolean {
  return keys.some((k) => Boolean(process.env[k]?.trim()));
}

export function isPartnerLive(entry: PartnerCatalogEntry): boolean {
  if (!entry.liveEnvKey) {
    // DocuSign uses config presence as live
    return envPresent(entry.envKeys.slice(0, Math.min(4, entry.envKeys.length)));
  }
  return process.env[entry.liveEnvKey]?.trim() === '1';
}

export function partnerConnectionStatus(
  key: PartnerKey,
): PartnerConnectionStatus {
  const entry = PARTNER_CATALOG.find((p) => p.key === key);
  if (!entry) return 'not_configured';

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

  const hasSecrets = envAnyPresent(entry.envKeys);
  if (!hasSecrets) return 'scaffold';
  if (entry.liveEnvKey && !isPartnerLive(entry)) return 'configured';
  return isPartnerLive(entry) ? 'live' : 'configured';
}

export function partnerSetupNote(key: PartnerKey): string {
  const entry = PARTNER_CATALOG.find((p) => p.key === key);
  if (!entry) return 'Unknown partner.';
  const missing = entry.envKeys.filter((k) => !process.env[k]?.trim());
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
  return PARTNER_CATALOG.map((p) => ({
    key: p.key,
    name: p.name,
    ownerFunction: p.ownerFunction,
    status: partnerConnectionStatus(p.key),
    setupNote: partnerSetupNote(p.key),
    manageHref: p.manageHref,
    live: isPartnerLive(p),
  }));
}
