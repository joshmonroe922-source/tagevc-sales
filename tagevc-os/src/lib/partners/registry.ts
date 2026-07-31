/**
 * Runtime partner registry helpers — env readiness, hub cards, entity inheritance.
 */

import {
  PARTNER_CATALOG,
  PARTNER_SPINE_VERSION,
  defaultEntityPartnerEnablement,
  marketingPresencePartners,
  partnerEnvConfigured,
  partnersForOwner,
  type PartnerDefinition,
  type PartnerKey,
  type PartnerOwnerSs,
} from '@/lib/partners/catalog';
import type { PartnerConnectionStatus, PartnerHubCard } from '@/lib/partners/types';

export { PARTNER_CATALOG, PARTNER_SPINE_VERSION, marketingPresencePartners };

export function resolvePartnerStatus(
  def: PartnerDefinition,
  bindingStatus?: PartnerConnectionStatus | null,
): PartnerConnectionStatus {
  if (bindingStatus === 'disabled') return 'disabled';
  if (bindingStatus === 'live' || bindingStatus === 'error') return bindingStatus;
  const envReady = partnerEnvConfigured(def);
  if (def.liveFlag && process.env[def.liveFlag]?.trim() === '1' && envReady) {
    return 'live';
  }
  if (envReady) return 'configured';
  if (def.status === 'live' || def.status === 'scaffolded') return 'scaffolded';
  return 'not_configured';
}

export function buildPartnerHubCards(opts?: {
  owner?: PartnerOwnerSs;
  bindings?: Partial<Record<PartnerKey, PartnerConnectionStatus>>;
}): PartnerHubCard[] {
  const list = opts?.owner
    ? partnersForOwner(opts.owner)
    : PARTNER_CATALOG;
  return list.map((def) => {
    const status = resolvePartnerStatus(def, opts?.bindings?.[def.key]);
    return {
      key: def.key,
      label: def.label,
      ownerSs: def.ownerSs,
      status,
      summary: def.summary,
      href: partnerAdminHref(def),
      envReady: partnerEnvConfigured(def),
    };
  });
}

export function partnerAdminHref(def: PartnerDefinition): string {
  if (
    def.key === 'google_business' ||
    def.key === 'google_analytics' ||
    def.key === 'linkedin_company'
  ) {
    return '/shared-services/marketing/presence';
  }
  if (def.key === 'verified_first') {
    return '/shared-services/hr/screening';
  }
  if (def.key === 'docusign') {
    return '/shared-services/legal/docusign';
  }
  if (def.key === 'gusto' || def.key === 'mybasepay') {
    return '/shared-services/it/technology-stack#gusto';
  }
  return '/shared-services/it/technology-stack';
}

/** Bindings every new OS entity should receive (scaffold rows). */
export function entityCreatePartnerPlan(entityId: string): Array<{
  partner_key: PartnerKey;
  enabled: boolean;
  status: PartnerConnectionStatus;
  lifecycle_hook: string | null;
}> {
  const enabledKeys = new Set(defaultEntityPartnerEnablement(entityId));
  return PARTNER_CATALOG.map((def) => ({
    partner_key: def.key,
    enabled: enabledKeys.has(def.key),
    status: 'scaffolded' as const,
    lifecycle_hook: def.lifecycleHooks.entityCreate ?? null,
  }));
}

export function joinerPartnerHooks(entityId: string): string[] {
  void entityId;
  return PARTNER_CATALOG.map((p) => p.lifecycleHooks.joiner).filter(
    (h): h is string => Boolean(h),
  );
}

export function leaverPartnerHooks(entityId: string): string[] {
  void entityId;
  return PARTNER_CATALOG.map((p) => p.lifecycleHooks.leaver).filter(
    (h): h is string => Boolean(h),
  );
}

export function missingEnvForPartner(key: PartnerKey): string[] {
  const def = PARTNER_CATALOG.find((p) => p.key === key);
  if (!def) return [];
  return def.envKeys.filter((k) => !process.env[k]?.trim());
}
