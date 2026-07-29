/**
 * Tage VC A&F — canonical section spine for every entity OS.
 *
 * Sibling sections under Shared Services → {Entity} A&F:
 *   1. Accounting
 *   2. Finance
 *   3. Audit
 *   4. Controls, Security & Governance
 *
 * Copy this module into subsidiary OS scaffolds (`src/lib/platform/af/`).
 * See `docs/SUBSIDIARY_OS_SHELL.md` § A&F and `docs/TAGE_VC_AF.md`.
 */

export const AF_HUB_PATH = '/shared-services/af' as const;

export type AfSectionId =
  | 'accounting'
  | 'finance'
  | 'audit'
  | 'controls';

export type AfSection = {
  id: AfSectionId;
  /** Left-nav + hub card label */
  label: string;
  /** Route under AF_HUB_PATH */
  path: string;
  /** Short description for hub / empty states */
  description: string;
};

/** Ordered siblings — do not reorder without updating all OS clones. */
export const AF_SECTIONS: readonly AfSection[] = [
  {
    id: 'accounting',
    label: 'Accounting',
    path: `${AF_HUB_PATH}/accounting`,
    description: 'GL · AR/AP · banks · commissions · close',
  },
  {
    id: 'finance',
    label: 'Finance',
    path: `${AF_HUB_PATH}/finance`,
    description: 'Forecast · buckets · loans · company NW',
  },
  {
    id: 'audit',
    label: 'Audit',
    path: `${AF_HUB_PATH}/audit`,
    description: 'Assurance · PBC · auditor packages',
  },
  {
    id: 'controls',
    label: 'Controls, Security & Governance',
    path: `${AF_HUB_PATH}/controls`,
    description: 'RBAC · SoD · policies · SOC2',
  },
] as const;

export function afHubLabel(entityDisplayName: string): string {
  return `${entityDisplayName} A&F`;
}
