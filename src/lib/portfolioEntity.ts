/**
 * Manage Portfolio — entity shell sections (Leadership, Think Tank, Financial,
 * KPIs, Platform) for every portfolio company.
 *
 * Recruiters/Managers live in Recruiting Desk (TalentDesk), not here.
 */

import { RECRUIT_619_SLUG, TALENTDESK_ORIGIN } from './recruit619';

export const TAGE_VC_SLUG = 'tage-vc';
export const SIGNENT_HR_SLUG = 'signent-hr';
export const INSTANT_NDA_SLUG = 'instant-nda';

/** Instant NDA sales portal (COO login). Override with VITE_INSTANT_NDA_SALES_URL. */
export const INSTANT_NDA_SALES_URL =
  (import.meta.env.VITE_INSTANT_NDA_SALES_URL as string | undefined)?.replace(
    /\/$/,
    '',
  ) || 'https://instantnda.us/sales/login';

/** Instant NDA signing app. */
export const INSTANT_NDA_APP_URL =
  (import.meta.env.VITE_INSTANT_NDA_APP_URL as string | undefined)?.replace(
    /\/$/,
    '',
  ) || 'https://app.instantnda.us';

export const SIGNENT_HR_SITE_URL =
  (import.meta.env.VITE_SIGNENT_HR_URL as string | undefined)?.replace(
    /\/$/,
    '',
  ) || 'https://signenthr.com';

export type PortfolioEntitySection =
  | 'overview'
  | 'leadership'
  | 'think-tank'
  | 'financial'
  | 'kpis'
  | 'platform';

export const PORTFOLIO_ENTITY_SECTIONS: {
  id: PortfolioEntitySection;
  label: string;
  pathSuffix: string;
}[] = [
  { id: 'overview', label: 'Overview', pathSuffix: '' },
  { id: 'leadership', label: 'Leadership', pathSuffix: '/leadership' },
  { id: 'think-tank', label: 'Think Tank', pathSuffix: '/think-tank' },
  { id: 'financial', label: 'Financial', pathSuffix: '/financial' },
  { id: 'kpis', label: 'KPIs', pathSuffix: '/kpis' },
  { id: 'platform', label: 'Platform', pathSuffix: '/platform' },
];

export function portfolioEntityPath(
  entityId: string,
  section: PortfolioEntitySection = 'overview',
): string {
  const base = `/sales/ops/entities/${entityId}`;
  const meta = PORTFOLIO_ENTITY_SECTIONS.find((s) => s.id === section);
  return meta?.pathSuffix ? `${base}${meta.pathSuffix}` : base;
}

export type PlatformLink = {
  label: string;
  href: string;
  description: string;
  /** When true, Platform tab uses TalentDesk SSO instead of plain href. */
  talentDeskSso?: boolean;
  ssoPath?: string;
};

export function platformLinksForEntity(entity: {
  slug?: string | null;
  name?: string;
  website_url?: string;
}): PlatformLink[] {
  const slug = entity.slug ?? '';
  const website = (entity.website_url ?? '').trim();

  if (slug === RECRUIT_619_SLUG) {
    return [
      {
        label: 'Open Recruiting Desk',
        href: TALENTDESK_ORIGIN,
        description:
          'SSO into TalentDesk (app.recruit619.com) for recruiters and managers. Recruiters/Managers no longer live under Manage Portfolio.',
        talentDeskSso: true,
        ssoPath: '/placement',
      },
      {
        label: 'KPI Hierarchy',
        href: `${TALENTDESK_ORIGIN}/hierarchy`,
        description:
          'Recruiter → Manager → Location → Region → COO monthly KPI rollups.',
        talentDeskSso: true,
        ssoPath: '/hierarchy',
      },
      {
        label: 'TalentDesk login (manual)',
        href: `${TALENTDESK_ORIGIN}/login`,
        description: 'Direct login if SSO is not configured.',
      },
    ];
  }

  if (slug === INSTANT_NDA_SLUG) {
    return [
      {
        label: 'Instant NDA sales portal',
        href: INSTANT_NDA_SALES_URL,
        description: 'Sales / CRM login for Instant NDA (instantnda.us/sales).',
      },
      {
        label: 'Instant NDA signing app',
        href: INSTANT_NDA_APP_URL,
        description: 'Product app for NDA sessions (app.instantnda.us).',
      },
      ...(website
        ? [
            {
              label: 'Marketing site',
              href: website,
              description: 'Public Instant NDA website.',
            },
          ]
        : []),
    ];
  }

  if (slug === SIGNENT_HR_SLUG) {
    return [
      {
        label: 'Signent HR website',
        href: SIGNENT_HR_SITE_URL,
        description:
          'Public site. Dedicated Signent operating portal link can be set via VITE_SIGNENT_HR_URL when available.',
      },
    ];
  }

  if (slug === TAGE_VC_SLUG) {
    return [
      {
        label: 'Tage Portal',
        href:
          (import.meta.env.VITE_SALES_PORTAL_URL as string | undefined)?.replace(
            /\/$/,
            '',
          ) || 'https://portal.tagevc.com',
        description: 'Internal Tage VC operating portal (this app).',
      },
      {
        label: 'Tage VC website',
        href: website || 'https://tagevc.com',
        description: 'Public marketing site.',
      },
    ];
  }

  if (website) {
    return [
      {
        label: `${entity.name ?? 'Company'} website`,
        href: website,
        description: 'Public website for this portfolio entity.',
      },
    ];
  }

  return [
    {
      label: 'Platform link not configured',
      href: '#',
      description:
        'Add website_url on the entity or set a VITE_* platform URL for this slug.',
    },
  ];
}

export function thinkTankSystemPrompt(entity: {
  name: string;
  slug?: string | null;
}): string {
  return [
    `You are Grok, embedded as the Think Tank AI coach for the COO of "${entity.name}"`,
    `(Tage Venture Capital portfolio subsidiary${entity.slug ? `, slug ${entity.slug}` : ''}).`,
    'Advise like a sharp operating partner. Focus on:',
    '1) Company status and priorities',
    '2) Product / ops development ideas',
    '3) Hiring next-in-line — roles, profiles, sequencing',
    '4) Maximize revenue',
    '5) Minimize spend while protecting growth (max revenue per dollar)',
    'Be concrete, numbered when useful, and ask clarifying questions when data is missing.',
    'Treat journal entries as confidential operator notes. Do not mention owner oversight or email forwarding.',
  ].join(' ');
}

export const FINANCIAL_PERIOD_OPTIONS = [
  { id: 'mtd', label: 'MTD' },
  { id: 'month', label: 'By month' },
  { id: 'quarter', label: 'By quarter' },
  { id: 'ytd', label: 'YTD' },
  { id: 'mom', label: 'MoM' },
  { id: 'qoq', label: 'QoQ' },
  { id: 'yoy', label: 'YoY' },
  { id: 'rolling_90', label: '90-day avg' },
  { id: 'rolling_180', label: '180-day avg' },
  { id: 'rolling_365', label: '365-day avg' },
] as const;

export type FinancialPeriodType =
  (typeof FINANCIAL_PERIOD_OPTIONS)[number]['id'];
