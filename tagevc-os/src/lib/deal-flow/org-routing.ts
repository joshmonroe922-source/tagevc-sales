/**
 * Map website / subsidiary intake → spine org slug (C2/C11).
 */

export type IntakeEntityKey =
  | 'tage'
  | 'recruit619'
  | 'signent'
  | 'instant_nda';

export const INTAKE_ENTITIES: Array<{
  key: IntakeEntityKey;
  label: string;
  orgSlug: string;
  defaultSource: string;
  websiteHint: string;
}> = [
  {
    key: 'tage',
    label: 'Tage VC',
    orgSlug: 'tage',
    defaultSource: 'website',
    websiteHint: 'tagevc.com',
  },
  {
    key: 'recruit619',
    label: 'Recruit 619',
    orgSlug: 'recruit619',
    defaultSource: 'recruit619_website',
    websiteHint: 'recruit619.com',
  },
  {
    key: 'signent',
    label: 'Signent',
    orgSlug: 'signent',
    defaultSource: 'signent_website',
    websiteHint: 'signenthr.com',
  },
  {
    key: 'instant_nda',
    label: 'Instant NDA',
    orgSlug: 'instant_nda',
    defaultSource: 'instantnda_website',
    websiteHint: 'instantnda.com',
  },
];

export function resolveIntakeOrgSlug(input: {
  entity?: string | null;
  org_slug?: string | null;
  source?: string | null;
  deal_path?: string | null;
}): IntakeEntityKey {
  const raw = (
    input.entity ||
    input.org_slug ||
    ''
  )
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

  if (
    raw === 'tage' ||
    raw === 'recruit619' ||
    raw === 'signent' ||
    raw === 'instant_nda'
  ) {
    return raw;
  }

  const source = (input.source || '').toLowerCase();
  if (source.includes('recruit') || source.includes('r619')) {
    return 'recruit619';
  }
  if (source.includes('signent')) return 'signent';
  if (source.includes('instant') || source.includes('inda') || source.includes('nda')) {
    return 'instant_nda';
  }

  // deal_path alone stays on Tage VC parent (launch/partner/exit)
  return 'tage';
}
