/**
 * Verified First screening spine — shared types + permission helpers.
 * System of record: os_screening_packages / os_screening_orders on Tage UDL.
 */

export type ScreeningVendor = 'verified_first';

export type ScreeningPackageKind = 'bg' | 'drug' | 'combo';

export type ScreeningSubjectType =
  | 'employee'
  | 'placement'
  | 'candidate'
  | 'signent_client_employee';

export type ScreeningOrderStatus =
  | 'pending'
  | 'ordered'
  | 'in_progress'
  | 'clear'
  | 'review'
  | 'failed'
  | 'cancelled'
  | 'waived';

export type ScreeningPackage = {
  id: string;
  vendor: ScreeningVendor;
  code: string;
  name: string;
  kind: ScreeningPackageKind;
  description: string;
  vendor_package_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ScreeningConsumerRef = {
  application_id?: string;
  placement_id?: string;
  job_id?: string;
  account_id?: string;
  candidate_id?: string;
  hris_run_id?: string;
  hris_step_id?: string;
  employee_id?: string;
  signent_client_id?: string;
  [key: string]: unknown;
};

export type ScreeningOrder = {
  id: string;
  vendor: ScreeningVendor;
  external_order_id: string | null;
  subject_type: ScreeningSubjectType;
  subject_id: string;
  entity_id: string;
  package_id: string | null;
  package_code: string;
  kind: ScreeningPackageKind;
  status: ScreeningOrderStatus;
  ordered_by: string | null;
  ordered_at: string | null;
  completed_at: string | null;
  report_storage_path: string | null;
  raw_status: string | null;
  last_sync_at: string | null;
  consumer_ref: ScreeningConsumerRef;
  confirm_token: string | null;
  confirmed_at: string | null;
  waiver_reason: string | null;
  waived_by: string | null;
  waived_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

/** Terminal statuses that satisfy a required screening gate. */
export const SCREENING_COMPLETE_STATUSES: readonly ScreeningOrderStatus[] = [
  'clear',
  'waived',
] as const;

export function screeningSatisfiesGate(
  status: ScreeningOrderStatus | string | null | undefined,
): boolean {
  return status === 'clear' || status === 'waived';
}

/** Roles that may create / confirm / waive orders (app mirror of SQL). */
export const SCREENING_MANAGE_ROLES = [
  'visionary',
  'admin',
  'coo',
  'service_lead',
  'counsel_ops',
  'partner',
  'sub_lead',
] as const;

export function canManageScreening(role: string | null | undefined): boolean {
  if (!role) return false;
  return (SCREENING_MANAGE_ROLES as readonly string[]).includes(role);
}

/** VERIFIED_FIRST_LIVE=1 required for live vendor API. Default fail-closed. */
export function isVerifiedFirstLive(): boolean {
  return process.env.VERIFIED_FIRST_LIVE === '1';
}

export function mapVendorStatusToSpine(
  raw: string | null | undefined,
): ScreeningOrderStatus | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, '_');
  switch (s) {
    case 'pending':
    case 'ready':
    case 'draft':
      return 'pending';
    case 'ordered':
    case 'submitted':
    case 'created':
      return 'ordered';
    case 'in_progress':
    case 'inprogress':
    case 'processing':
    case 'pending_results':
      return 'in_progress';
    case 'clear':
    case 'complete':
    case 'completed':
    case 'passed':
    case 'eligible':
      return 'clear';
    case 'review':
    case 'needs_review':
    case 'consider':
    case 'adjudication':
      return 'review';
    case 'failed':
    case 'fail':
    case 'not_clear':
    case 'adverse':
    case 'rejected':
      return 'failed';
    case 'cancelled':
    case 'canceled':
    case 'void':
      return 'cancelled';
    case 'waived':
      return 'waived';
    default:
      return null;
  }
}

/** Map spine status → Recruit application.bg_screen_status vocabulary. */
export function spineStatusToBgScreen(
  status: ScreeningOrderStatus,
): 'pending' | 'clear' | 'failed' | 'waived' | 'not_required' {
  switch (status) {
    case 'clear':
      return 'clear';
    case 'failed':
      return 'failed';
    case 'waived':
      return 'waived';
    case 'cancelled':
      return 'not_required';
    default:
      return 'pending';
  }
}
