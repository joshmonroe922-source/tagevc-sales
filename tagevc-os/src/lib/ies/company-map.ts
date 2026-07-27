/**
 * Authoritative IES company ↔ OS entity map (locked digit-string company IDs).
 * Display labels are exact IES company names — never raw ENT-*.
 */

export const IES_COMPANY_MAP = [
  {
    ies_company_id: '9341457251412290',
    ies_company_name: 'Tage Venture Capital',
    entity_id: 'ENT-FIRM',
    display_name: 'Tage Venture Capital',
    is_parent: true,
    sort_order: 10,
  },
  {
    ies_company_id: '9341457251406251',
    ies_company_name: 'Recruit 619',
    entity_id: 'ENT-R619',
    display_name: 'Recruit 619',
    is_parent: false,
    sort_order: 20,
  },
  {
    ies_company_id: '9341457251424506',
    ies_company_name: 'Signent HR',
    entity_id: 'ENT-SIGNENT',
    display_name: 'Signent HR',
    is_parent: false,
    sort_order: 30,
  },
  {
    ies_company_id: '9341457533727282',
    ies_company_name: 'Instant NDA',
    entity_id: 'ENT-INDA',
    display_name: 'Instant NDA',
    is_parent: false,
    sort_order: 40,
  },
] as const;

export type IesCompanyMapRow = (typeof IES_COMPANY_MAP)[number];

export function resolveIesCompanyByEntity(
  entityId: string,
): IesCompanyMapRow | undefined {
  return IES_COMPANY_MAP.find((row) => row.entity_id === entityId);
}

export function resolveIesCompanyById(
  iesCompanyId: string,
): IesCompanyMapRow | undefined {
  return IES_COMPANY_MAP.find((row) => row.ies_company_id === iesCompanyId);
}

/** UI order after Consolidated (management scope, not an IES company). */
export function iesCompanySelectOrder(): IesCompanyMapRow[] {
  return [...IES_COMPANY_MAP].sort((a, b) => a.sort_order - b.sort_order);
}
