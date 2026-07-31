/**
 * Canonical partner catalog — inherited by every entity on provision.
 * Connection secrets stay in env / vault; this is the product spine map.
 */

import type { PartnerCatalogEntry, PartnerKey } from '@/lib/partners/types';
import { PARTNER_SPINE_CONTRACT_VERSION } from '@/lib/partners/types';

export { PARTNER_SPINE_CONTRACT_VERSION };

export const PARTNER_CATALOG: readonly PartnerCatalogEntry[] = [
  {
    key: 'dialpad',
    name: 'Dialpad',
    category: 'communications',
    ownerFunction: 'IT',
    summary: 'Phone + SMS + AI voice across entities; replace/augment RingCentral paths.',
    manageHref: '/shared-services/it/technology#dialpad',
    docsPath: 'docs/PARTNER_SPINE.md#dialpad',
    scopeMode: 'all_entities',
    envKeys: ['DIALPAD_API_KEY', 'DIALPAD_WEBHOOK_SECRET'],
    liveEnvKey: 'DIALPAD_LIVE',
    supportsImport: true,
    supportsWebhook: true,
    supportsAutoProvision: true,
    biSignals: ['call_volume', 'sms_volume', 'ai_assist_usage'],
    implementNow: ['all'],
  },
  {
    key: 'verified_first',
    name: 'Verified First',
    category: 'screening',
    ownerFunction: 'HR',
    summary:
      'Background checks + drug screens. Spine live for HRIS + Recruit; Signent scaffold.',
    manageHref: '/shared-services/hr/screening',
    docsPath: 'docs/VERIFIED_FIRST_SCREENING_SPINE.md',
    scopeMode: 'all_entities',
    envKeys: [
      'VERIFIED_FIRST_API_KEY',
      'VERIFIED_FIRST_WEBHOOK_SECRET',
      'VERIFIED_FIRST_API_BASE',
    ],
    liveEnvKey: 'VERIFIED_FIRST_LIVE',
    supportsImport: false,
    supportsWebhook: true,
    supportsAutoProvision: false,
    biSignals: ['orders_pending', 'orders_clear', 'orders_review'],
    implementNow: ['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT'],
  },
  {
    key: 'mybasepay',
    name: 'MyBasePay',
    category: 'eor',
    ownerFunction: 'HR',
    summary:
      'Employer of Record. Architected firm-wide; implement Recruit 619 contractor placements first.',
    manageHref: '/shared-services/it/technology#mybasepay',
    docsPath: 'docs/PARTNER_SPINE.md#mybasepay',
    scopeMode: 'recruit_first',
    envKeys: ['MYBASEPAY_API_KEY', 'MYBASEPAY_WEBHOOK_SECRET'],
    liveEnvKey: 'MYBASEPAY_LIVE',
    supportsImport: true,
    supportsWebhook: true,
    supportsAutoProvision: true,
    biSignals: ['active_eor_workers', 'placement_eor_pending'],
    implementNow: ['ENT-R619'],
  },
  {
    key: 'apollo',
    name: 'Apollo',
    category: 'data',
    ownerFunction: 'Shared',
    summary:
      'Contact/company database into Tage portal + unified DB for all entities.',
    manageHref: '/shared-services/it/technology#apollo',
    docsPath: 'docs/PARTNER_SPINE.md#apollo',
    scopeMode: 'all_entities',
    envKeys: ['APOLLO_API_KEY'],
    liveEnvKey: 'APOLLO_LIVE',
    supportsImport: true,
    supportsWebhook: false,
    supportsAutoProvision: false,
    biSignals: ['contacts_imported', 'companies_enriched'],
    implementNow: ['all'],
  },
  {
    key: 'gusto',
    name: 'Gusto',
    category: 'payroll',
    ownerFunction: 'Finance',
    summary:
      'Payroll for internal employees. Invoice-paid → commission calc → payroll push stubs.',
    manageHref: '/shared-services/af',
    docsPath: 'docs/PARTNER_SPINE.md#gusto',
    scopeMode: 'all_entities',
    envKeys: ['GUSTO_API_TOKEN', 'GUSTO_COMPANY_UUID'],
    liveEnvKey: 'GUSTO_LIVE',
    supportsImport: true,
    supportsWebhook: true,
    supportsAutoProvision: true,
    biSignals: ['payroll_runs', 'commission_queued', 'commission_pushed'],
    implementNow: ['all'],
  },
  {
    key: 'docusign',
    name: 'DocuSign',
    category: 'esignature',
    ownerFunction: 'Legal',
    summary:
      'Org account Tage VC + per-subsidiary enablement. Existing JWT/Connect spine.',
    manageHref: '/shared-services/legal/docusign',
    docsPath: 'docs/PARTNER_SPINE.md#docusign',
    scopeMode: 'all_entities',
    envKeys: [
      'DOCUSIGN_INTEGRATION_KEY',
      'DOCUSIGN_USER_ID',
      'DOCUSIGN_ACCOUNT_ID',
      'DOCUSIGN_PRIVATE_KEY',
      'DOCUSIGN_WEBHOOK_SECRET',
      'DOCUSIGN_CONNECT_HMAC_SECRET',
    ],
    supportsImport: true,
    supportsWebhook: true,
    supportsAutoProvision: false,
    biSignals: ['envelopes_sent', 'envelopes_completed', 'archive_health'],
    implementNow: ['all'],
  },
  {
    key: 'linkedin_recruiter',
    name: 'LinkedIn Recruiter',
    category: 'recruiting',
    ownerFunction: 'Recruiting',
    summary:
      'Two-way sync scaffold. Biggest use at Recruit 619; attach account when issued.',
    manageHref: '/shared-services/it/technology#linkedin_recruiter',
    docsPath: 'docs/PARTNER_SPINE.md#linkedin-recruiter',
    scopeMode: 'all_entities',
    envKeys: [
      'LINKEDIN_RECRUITER_CLIENT_ID',
      'LINKEDIN_RECRUITER_CLIENT_SECRET',
      'LINKEDIN_RECRUITER_ACCESS_TOKEN',
    ],
    liveEnvKey: 'LINKEDIN_RECRUITER_LIVE',
    supportsImport: true,
    supportsWebhook: false,
    supportsAutoProvision: false,
    biSignals: ['candidates_synced', 'inmail_activity'],
    implementNow: ['ENT-R619'],
  },
  {
    key: 'appcast',
    name: 'Appcast',
    category: 'job_publish',
    ownerFunction: 'Recruiting',
    summary:
      'Job publishing. Immediate at R619; careers pages for all entities; contact dedup on apply.',
    manageHref: '/shared-services/it/technology#appcast',
    docsPath: 'docs/PARTNER_SPINE.md#appcast',
    scopeMode: 'all_entities',
    envKeys: ['APPCAST_API_KEY', 'APPCAST_EMPLOYER_ID', 'APPCAST_WEBHOOK_SECRET'],
    liveEnvKey: 'APPCAST_LIVE',
    supportsImport: true,
    supportsWebhook: true,
    supportsAutoProvision: false,
    biSignals: ['jobs_published', 'applies_inbound', 'spend'],
    implementNow: ['ENT-R619'],
  },
  {
    key: 'google_business',
    name: 'Google Business Profile',
    category: 'marketing_presence',
    ownerFunction: 'Marketing',
    summary:
      'Per-entity Google Business pages. Managed under Marketing Shared Services.',
    manageHref: '/shared-services/marketing/presence#google_business',
    docsPath: 'docs/PARTNER_SPINE.md#google-business-analytics-linkedin',
    scopeMode: 'marketing_all_entities',
    envKeys: [
      'GOOGLE_BUSINESS_CLIENT_ID',
      'GOOGLE_BUSINESS_CLIENT_SECRET',
      'GOOGLE_BUSINESS_REFRESH_TOKEN',
    ],
    liveEnvKey: 'GOOGLE_BUSINESS_LIVE',
    supportsImport: true,
    supportsWebhook: false,
    supportsAutoProvision: true,
    biSignals: ['reviews', 'insights_views', 'search_queries'],
    implementNow: ['all'],
  },
  {
    key: 'google_analytics',
    name: 'Google Analytics (GA4)',
    category: 'analytics',
    ownerFunction: 'Marketing',
    summary:
      'GA4 property per entity. Import into unified DB + AI BI. Marketing-owned.',
    manageHref: '/shared-services/marketing/presence#google_analytics',
    docsPath: 'docs/PARTNER_SPINE.md#google-business-analytics-linkedin',
    scopeMode: 'marketing_all_entities',
    envKeys: [
      'GA4_PROPERTY_ID',
      'GOOGLE_ANALYTICS_CLIENT_ID',
      'GOOGLE_ANALYTICS_CLIENT_SECRET',
      'GOOGLE_ANALYTICS_REFRESH_TOKEN',
    ],
    liveEnvKey: 'GA4_LIVE',
    supportsImport: true,
    supportsWebhook: false,
    supportsAutoProvision: true,
    biSignals: ['sessions', 'conversions', 'traffic_sources'],
    implementNow: ['all'],
  },
  {
    key: 'linkedin_company_pages',
    name: 'LinkedIn Company Pages',
    category: 'marketing_presence',
    ownerFunction: 'Marketing',
    summary:
      'Per-entity LinkedIn Business/Company Pages under Marketing Shared Services (distinct from Recruiter + personal publish OAuth).',
    manageHref: '/shared-services/marketing/presence#linkedin_company_pages',
    docsPath: 'docs/PARTNER_SPINE.md#google-business-analytics-linkedin',
    scopeMode: 'marketing_all_entities',
    envKeys: [
      'LINKEDIN_COMPANY_CLIENT_ID',
      'LINKEDIN_COMPANY_CLIENT_SECRET',
      'LINKEDIN_COMPANY_ACCESS_TOKEN',
    ],
    liveEnvKey: 'LINKEDIN_COMPANY_LIVE',
    supportsImport: true,
    supportsWebhook: false,
    supportsAutoProvision: true,
    biSignals: ['followers', 'page_posts', 'engagement'],
    implementNow: ['all'],
  },
] as const;

export function partnerByKey(key: PartnerKey): PartnerCatalogEntry {
  const row = PARTNER_CATALOG.find((p) => p.key === key);
  if (!row) throw new Error(`Unknown partner key: ${key}`);
  return row;
}

export function partnersForOwner(
  owner: PartnerCatalogEntry['ownerFunction'],
): PartnerCatalogEntry[] {
  return PARTNER_CATALOG.filter((p) => p.ownerFunction === owner);
}

export function marketingPresencePartners(): PartnerCatalogEntry[] {
  return PARTNER_CATALOG.filter(
    (p) =>
      p.key === 'google_business' ||
      p.key === 'google_analytics' ||
      p.key === 'linkedin_company_pages',
  );
}

export function defaultEnabledForEntity(
  key: PartnerKey,
  entityId: string,
): boolean {
  const entry = partnerByKey(key);
  if (entry.implementNow.includes('all')) return true;
  if (entry.scopeMode === 'recruit_first') return entityId === 'ENT-R619';
  return (
    entry.implementNow.includes(entityId as 'ENT-FIRM') ||
    entry.implementNow.includes('all')
  );
}
