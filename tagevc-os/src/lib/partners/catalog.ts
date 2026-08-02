/**
 * Partner platform spine catalog — inherited by every OS entity.
 * Secrets stay in env / vault; this registry is capability + ownership metadata.
 */

export type PartnerKey =
  | 'dialpad'
  | 'verified_first'
  | 'mybasepay'
  | 'apollo'
  | 'gusto'
  | 'docusign'
  | 'linkedin_recruiter'
  | 'appcast'
  | 'google_business'
  | 'google_analytics'
  | 'linkedin_company';

export type PartnerOwnerSs =
  | 'IT'
  | 'HR'
  | 'Finance'
  | 'Legal'
  | 'Marketing'
  | 'Recruiting';

export type PartnerScope =
  | 'all_entities'
  | 'recruit_primary'
  | 'internal_employees'
  | 'contractor_placements';

export type PartnerCapability =
  | 'phone_sms_ai'
  | 'background_drug'
  | 'eor'
  | 'contacts_db'
  | 'payroll'
  | 'esignature'
  | 'recruiter_crm'
  | 'job_publish'
  | 'local_presence'
  | 'web_analytics'
  | 'company_page';

export type PartnerDefinition = {
  key: PartnerKey;
  label: string;
  summary: string;
  ownerSs: PartnerOwnerSs;
  /** Secondary owners (ops surfaces that also manage / consume). */
  coOwners?: PartnerOwnerSs[];
  scope: PartnerScope;
  capabilities: PartnerCapability[];
  /** Env vars Josh must set — never invent values. */
  envKeys: string[];
  /** Fail-closed live switch when present. */
  liveFlag?: string;
  webhookPath?: string;
  docsPath: string;
  /** Auto-provision / revoke hooks in JML when product allows. */
  lifecycleHooks: {
    joiner?: string;
    leaver?: string;
    entityCreate?: string;
  };
  /** Where implement-now vs scaffold-only applies. */
  implementNow: Array<'ENT-FIRM' | 'ENT-R619' | 'ENT-SIGNENT' | 'ENT-INDA' | 'all'>;
  biFeed: boolean;
  importSupported: boolean;
  status: 'live' | 'scaffolded' | 'planned';
};

export const PARTNER_SPINE_VERSION = 'partner-spine-v1' as const;
/** @deprecated alias — prefer PARTNER_SPINE_VERSION */
export const PARTNER_SPINE_CONTRACT_VERSION = PARTNER_SPINE_VERSION;

export const PARTNER_CATALOG: PartnerDefinition[] = [
  {
    key: 'dialpad',
    label: 'Dialpad',
    summary: 'Phone + SMS + AI communications for all entities.',
    ownerSs: 'IT',
    coOwners: ['Marketing'],
    scope: 'all_entities',
    capabilities: ['phone_sms_ai'],
    envKeys: [
      'DIALPAD_API_KEY',
      'DIALPAD_WEBHOOK_SECRET',
      'DIALPAD_LIVE',
    ],
    liveFlag: 'DIALPAD_LIVE',
    webhookPath: '/api/partners/dialpad/webhook',
    docsPath: 'docs/PARTNER_SPINE.md#dialpad',
    lifecycleHooks: {
      joiner: 'provision_dialpad_user',
      leaver: 'revoke_dialpad_user',
      entityCreate: 'ensure_dialpad_office',
    },
    implementNow: ['all'],
    biFeed: true,
    importSupported: true,
    status: 'scaffolded',
  },
  {
    key: 'verified_first',
    label: 'Verified First',
    summary:
      'Background checks + drug screens — Tage HR, Recruit 619 placements, Signent HR.',
    ownerSs: 'HR',
    coOwners: ['Recruiting'],
    scope: 'all_entities',
    capabilities: ['background_drug'],
    envKeys: [
      'VERIFIED_FIRST_API_KEY',
      'VERIFIED_FIRST_WEBHOOK_SECRET',
      'VERIFIED_FIRST_LIVE',
      'VERIFIED_FIRST_API_BASE',
    ],
    liveFlag: 'VERIFIED_FIRST_LIVE',
    webhookPath: '/api/screening/verified-first/webhook',
    docsPath: 'docs/VERIFIED_FIRST_SCREENING_SPINE.md',
    lifecycleHooks: {
      joiner: 'pending_verified_first_if_required',
      entityCreate: 'seed_screening_entity_defaults',
    },
    implementNow: ['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT'],
    biFeed: true,
    importSupported: false,
    status: 'live',
  },
  {
    key: 'mybasepay',
    label: 'MyBasePay',
    summary:
      'Employer of Record for contractor placements. Spine-wide; implement at Recruit 619 first.',
    ownerSs: 'HR',
    coOwners: ['Finance', 'Recruiting'],
    scope: 'contractor_placements',
    capabilities: ['eor'],
    envKeys: [
      'MYBASEPAY_API_KEY',
      'MYBASEPAY_WEBHOOK_SECRET',
      'MYBASEPAY_LIVE',
      'MYBASEPAY_API_BASE',
    ],
    liveFlag: 'MYBASEPAY_LIVE',
    webhookPath: '/api/partners/mybasepay/webhook',
    docsPath: 'docs/PARTNER_SPINE.md#mybasepay',
    lifecycleHooks: {
      entityCreate: 'enable_mybasepay_if_recruiting',
    },
    implementNow: ['ENT-R619'],
    biFeed: true,
    importSupported: true,
    status: 'scaffolded',
  },
  {
    key: 'apollo',
    label: 'Apollo',
    summary:
      'Contact/company database into Tage portal + unified layered DB for all entities.',
    ownerSs: 'Marketing',
    coOwners: ['Recruiting'],
    scope: 'all_entities',
    capabilities: ['contacts_db'],
    envKeys: ['APOLLO_API_KEY', 'APOLLO_LIVE'],
    liveFlag: 'APOLLO_LIVE',
    docsPath: 'docs/PARTNER_SPINE.md#apollo',
    lifecycleHooks: {
      entityCreate: 'ensure_apollo_workspace_binding',
    },
    implementNow: ['all'],
    biFeed: true,
    importSupported: true,
    status: 'scaffolded',
  },
  {
    key: 'gusto',
    label: 'Gusto',
    summary:
      'Payroll for internal employees at all entities + commission push from paid invoices.',
    ownerSs: 'Finance',
    coOwners: ['HR'],
    scope: 'internal_employees',
    capabilities: ['payroll'],
    envKeys: [
      'GUSTO_API_TOKEN',
      'GUSTO_COMPANY_UUID',
      'GUSTO_WEBHOOK_SECRET',
      'GUSTO_LIVE',
    ],
    liveFlag: 'GUSTO_LIVE',
    webhookPath: '/api/partners/gusto/webhook',
    docsPath: 'docs/PARTNER_SPINE.md#gusto',
    lifecycleHooks: {
      joiner: 'provision_gusto_employee',
      leaver: 'terminate_gusto_employee',
      entityCreate: 'ensure_gusto_company_binding',
    },
    implementNow: ['all'],
    biFeed: true,
    importSupported: true,
    status: 'scaffolded',
  },
  {
    key: 'docusign',
    label: 'DocuSign',
    summary:
      'Org account with Tage Venture Capital + each subsidiary for e-signature.',
    ownerSs: 'Legal',
    scope: 'all_entities',
    capabilities: ['esignature'],
    envKeys: [
      'DOCUSIGN_INTEGRATION_KEY',
      'DOCUSIGN_USER_ID',
      'DOCUSIGN_ACCOUNT_ID',
      'DOCUSIGN_ACCOUNT_ID_FIRM',
      'DOCUSIGN_ACCOUNT_ID_R619',
      'DOCUSIGN_ACCOUNT_ID_SIGNENT',
      'DOCUSIGN_ACCOUNT_ID_INDA',
      'DOCUSIGN_PRIVATE_KEY',
      'DOCUSIGN_OAUTH_HOST',
      'DOCUSIGN_BASE_PATH',
      'DOCUSIGN_WEBHOOK_SECRET',
      'DOCUSIGN_CONNECT_HMAC_SECRET',
    ],
    webhookPath: '/api/docusign/webhook',
    docsPath: 'docs/DOCUSIGN_JOSH_CHECKLIST.md',
    lifecycleHooks: {
      entityCreate: 'ensure_docusign_account_binding',
    },
    implementNow: ['all'],
    biFeed: true,
    importSupported: true,
    status: 'live',
  },
  {
    key: 'linkedin_recruiter',
    label: 'LinkedIn Recruiter',
    summary:
      'Two-way sync scaffold; primary use Recruit 619; available to all entities later.',
    ownerSs: 'Recruiting',
    coOwners: ['HR'],
    scope: 'recruit_primary',
    capabilities: ['recruiter_crm'],
    envKeys: [
      'LINKEDIN_RECRUITER_CLIENT_ID',
      'LINKEDIN_RECRUITER_CLIENT_SECRET',
      'LINKEDIN_RECRUITER_LIVE',
    ],
    liveFlag: 'LINKEDIN_RECRUITER_LIVE',
    docsPath: 'docs/PARTNER_SPINE.md#linkedin-recruiter',
    lifecycleHooks: {
      entityCreate: 'ensure_linkedin_recruiter_seat_pool',
    },
    implementNow: ['ENT-R619'],
    biFeed: true,
    importSupported: true,
    status: 'scaffolded',
  },
  {
    key: 'appcast',
    label: 'Appcast',
    summary:
      'Job publishing — careers/internal for all entities; Recruit 619 client fills now.',
    ownerSs: 'Recruiting',
    coOwners: ['Marketing'],
    scope: 'all_entities',
    capabilities: ['job_publish'],
    envKeys: [
      'APPCAST_API_KEY',
      'APPCAST_EMPLOYER_ID',
      'APPCAST_WEBHOOK_SECRET',
      'APPCAST_LIVE',
    ],
    liveFlag: 'APPCAST_LIVE',
    webhookPath: '/api/partners/appcast/webhook',
    docsPath: 'docs/PARTNER_SPINE.md#appcast',
    lifecycleHooks: {
      entityCreate: 'ensure_appcast_employer_binding',
    },
    implementNow: ['ENT-R619', 'all'],
    biFeed: true,
    importSupported: true,
    status: 'live',
  },
  {
    key: 'google_business',
    label: 'Google Business Profile',
    summary:
      'Google Business pages per entity — managed under Marketing Shared Services.',
    ownerSs: 'Marketing',
    scope: 'all_entities',
    capabilities: ['local_presence'],
    envKeys: [
      'GOOGLE_BUSINESS_CLIENT_ID',
      'GOOGLE_BUSINESS_CLIENT_SECRET',
      'GOOGLE_BUSINESS_REFRESH_TOKEN',
      'GOOGLE_BUSINESS_LIVE',
    ],
    liveFlag: 'GOOGLE_BUSINESS_LIVE',
    docsPath: 'docs/PARTNER_SPINE.md#google-business',
    lifecycleHooks: {
      entityCreate: 'ensure_google_business_location_slot',
      leaver: 'revoke_google_business_managers_if_sole',
    },
    implementNow: ['all'],
    biFeed: true,
    importSupported: true,
    status: 'scaffolded',
  },
  {
    key: 'google_analytics',
    label: 'Google Analytics (GA4)',
    summary:
      'GA4 property per entity — Marketing Shared Services central management.',
    ownerSs: 'Marketing',
    scope: 'all_entities',
    capabilities: ['web_analytics'],
    envKeys: [
      'GA4_PROPERTY_ID',
      'GA4_SERVICE_ACCOUNT_JSON',
      'GA4_LIVE',
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
    ],
    liveFlag: 'GA4_LIVE',
    docsPath: 'docs/PARTNER_SPINE.md#google-analytics',
    lifecycleHooks: {
      entityCreate: 'ensure_ga4_property_binding',
    },
    implementNow: ['all'],
    biFeed: true,
    importSupported: true,
    status: 'scaffolded',
  },
  {
    key: 'linkedin_company',
    label: 'LinkedIn Company Pages',
    summary:
      'LinkedIn Business / Company Pages per entity — Marketing Shared Services.',
    ownerSs: 'Marketing',
    scope: 'all_entities',
    capabilities: ['company_page'],
    envKeys: [
      'LINKEDIN_COMPANY_CLIENT_ID',
      'LINKEDIN_COMPANY_CLIENT_SECRET',
      'LINKEDIN_COMPANY_ORGANIZATION_URN',
      'LINKEDIN_COMPANY_LIVE',
    ],
    liveFlag: 'LINKEDIN_COMPANY_LIVE',
    docsPath: 'docs/PARTNER_SPINE.md#linkedin-company',
    lifecycleHooks: {
      entityCreate: 'ensure_linkedin_company_page_binding',
      leaver: 'revoke_linkedin_company_admin_if_sole',
    },
    implementNow: ['all'],
    biFeed: true,
    importSupported: true,
    status: 'scaffolded',
  },
];

export function getPartner(key: PartnerKey): PartnerDefinition {
  const row = PARTNER_CATALOG.find((p) => p.key === key);
  if (!row) throw new Error(`Unknown partner: ${key}`);
  return row;
}

export function partnersForOwner(owner: PartnerOwnerSs): PartnerDefinition[] {
  return PARTNER_CATALOG.filter(
    (p) => p.ownerSs === owner || p.coOwners?.includes(owner),
  );
}

export function marketingPresencePartners(): PartnerDefinition[] {
  return PARTNER_CATALOG.filter((p) =>
    (['google_business', 'google_analytics', 'linkedin_company'] as PartnerKey[]).includes(
      p.key,
    ),
  );
}

export function defaultEntityPartnerEnablement(entityId: string): PartnerKey[] {
  const keys = PARTNER_CATALOG.filter((p) => {
    if (p.implementNow.includes('all')) return true;
    if (entityId === 'ENT-R619' && p.implementNow.includes('ENT-R619')) return true;
    if (entityId === 'ENT-FIRM' && p.implementNow.includes('ENT-FIRM')) return true;
    if (entityId === 'ENT-SIGNENT' && p.implementNow.includes('ENT-SIGNENT'))
      return true;
    if (entityId === 'ENT-INDA' && p.implementNow.includes('ENT-INDA')) return true;
    // New entities inherit full spine by default (scaffold bindings).
    if (!entityId.startsWith('ENT-')) return true;
    const known = ['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA'];
    if (!known.includes(entityId)) return p.scope === 'all_entities';
    return p.scope === 'all_entities';
  }).map((p) => p.key);
  return [...new Set(keys)];
}

export function partnerEnvConfigured(def: PartnerDefinition): boolean {
  if (def.envKeys.length === 0) return false;
  // At least one primary secret (skip *_LIVE flags).
  return def.envKeys.some((k) => {
    if (k.endsWith('_LIVE')) return false;
    return Boolean(process.env[k]?.trim());
  });
}

/** Whether a partner is enabled by default for an entity (inheritance plan). */
export function defaultEnabledForEntity(
  key: PartnerKey,
  entityId: string,
): boolean {
  return defaultEntityPartnerEnablement(entityId).includes(key);
}

/** Compatibility shape for env / technology UI consumers. */
export type PartnerCatalogEntry = PartnerDefinition & {
  name: string;
  ownerFunction: PartnerOwnerSs;
  liveEnvKey: string | null;
  manageHref: string;
  docsPath: string;
};

export function asCatalogEntry(def: PartnerDefinition): PartnerCatalogEntry {
  const manageHref =
    def.key === 'google_business' ||
    def.key === 'google_analytics' ||
    def.key === 'linkedin_company'
      ? '/shared-services/marketing/presence'
      : def.key === 'verified_first'
        ? '/shared-services/hr/screening'
        : def.key === 'docusign'
          ? '/shared-services/legal/docusign'
          : '/shared-services/it/technology-stack';
  return {
    ...def,
    name: def.label,
    ownerFunction: def.ownerSs,
    liveEnvKey: def.liveFlag ?? null,
    manageHref,
    docsPath: def.docsPath,
  };
}

export function listCatalogEntries(): PartnerCatalogEntry[] {
  return PARTNER_CATALOG.map(asCatalogEntry);
}
