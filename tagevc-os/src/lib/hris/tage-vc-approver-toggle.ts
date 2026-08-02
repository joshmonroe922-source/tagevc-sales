/**
 * D08 — Deal → Entity Master / Portfolio Active approver.
 * Tage VC employee onboarding toggle only; default Visionary; expandable later.
 */

export const TAGE_VC_ENTITY_ID = 'ENT-FIRM';

export type PortfolioApproverRole = 'visionary' | 'think_tank' | 'custom';

export type TageVcApproverToggle = {
  enabled: boolean;
  /** Who must approve deal→entity/portfolio go-live */
  approverRole: PortfolioApproverRole;
  /** Future: additional profile ids */
  additionalApproverIds: string[];
  label: string;
};

/** Default until HRIS onboarding template step stores per-employee preference. */
export const DEFAULT_TAGE_VC_APPROVER_TOGGLE: TageVcApproverToggle = {
  enabled: true,
  approverRole: 'visionary',
  additionalApproverIds: [],
  label: 'Visionary approves deal → entity / portfolio Active (Tage VC only)',
};

export function isTageVcOnboardingEntity(
  entityId: string | null | undefined,
): boolean {
  return entityId === TAGE_VC_ENTITY_ID;
}

export function resolvePortfolioApproverLabel(
  toggle: TageVcApproverToggle = DEFAULT_TAGE_VC_APPROVER_TOGGLE,
): string {
  if (!toggle.enabled) return 'Approver step off for this joiner';
  if (toggle.approverRole === 'visionary') return 'Visionary';
  if (toggle.approverRole === 'think_tank') return 'Think Tank';
  return 'Custom approver list';
}
