/**
 * Entity theme defaults for digital cards.
 * Tage navy + gold; entity logo from brand SoT.
 */

import { getEntityLogo } from '@/lib/entities/logo';
import { entityDisplayName } from '@/lib/entities/display-name';
import type { DigitalCardCta, DigitalCardTheme } from './types';

export const TAGE_NAVY = '#3B4559';
export const TAGE_GOLD = '#B2A384';
export const TAGE_SURFACE = '#F7F5F1';
export const TAGE_INK = '#1E2430';

const DEFAULT_CTAS: Record<string, DigitalCardCta> = {
  'ENT-FIRM': {
    label: 'Explore our companies',
    url: 'https://tagevc.com',
  },
  'ENT-R619': {
    label: 'Request talent / Find work',
    url: 'https://recruit619.com',
  },
  'ENT-SIGNENT': {
    label: 'Talk to HR',
    url: 'https://signenthr.com',
  },
  'ENT-INDA': {
    label: 'Send an NDA',
    url: 'https://instantnda.us',
  },
};

const COMPANY_SITES: Record<string, string> = {
  'ENT-FIRM': 'https://tagevc.com',
  'ENT-R619': 'https://recruit619.com',
  'ENT-SIGNENT': 'https://signenthr.com',
  'ENT-INDA': 'https://instantnda.us',
};

export function defaultThemeForEntity(entityId: string): DigitalCardTheme {
  // Public card header is navy — prefer dark-surface logos (no CSS invert).
  const logo = getEntityLogo(entityId, 'primary', { surface: 'dark' });
  return {
    primary: TAGE_NAVY,
    accent: TAGE_GOLD,
    surface: TAGE_SURFACE,
    logo_url: logo?.publicUrl || logo?.localPublicPath || undefined,
  };
}

export function defaultCtaForEntity(entityId: string): DigitalCardCta {
  return (
    DEFAULT_CTAS[entityId] ?? {
      label: `Visit ${entityDisplayName(entityId)}`,
      url: COMPANY_SITES[entityId] ?? 'https://tagevc.com',
    }
  );
}

export function companyWebsiteForEntity(entityId: string): string {
  return COMPANY_SITES[entityId] ?? 'https://tagevc.com';
}

export function mergeTheme(
  entityId: string,
  locked?: DigitalCardTheme | null,
  persona?: DigitalCardTheme | null,
): DigitalCardTheme {
  const base = defaultThemeForEntity(entityId);
  return {
    ...base,
    ...(persona ?? {}),
    // Admin-locked theme wins for brand colors
    primary: locked?.primary || base.primary,
    accent: locked?.accent || base.accent,
    surface: locked?.surface || base.surface,
    logo_url: locked?.logo_url || persona?.logo_url || base.logo_url,
  };
}
