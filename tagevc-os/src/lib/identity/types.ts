/** Identity + Device Lifecycle — spreadsheet SoT contracts (sheets 04/07b/17/18). */

export const IDENTITY_CONTRACT_VERSION = 'identity-device-v1' as const;

export type DeviceOwnership = 'unset' | 'company_owned' | 'personal_byod';
export type DevicePreference =
  | 'windows'
  | 'macos'
  | 'ios'
  | 'android'
  | 'none';
export type DevicePath = 'company_mdm' | 'byod_mam' | 'byod_mam_mdm' | 'none';
export type ByodEnforcement =
  | 'mam_only'
  | 'mam_plus_optional_mdm'
  | 'mdm_required_exception';
export type IdentityStatus =
  | 'not_provisioned'
  | 'pending'
  | 'enabled'
  | 'disabled'
  | 'pending_delete';
export type CaseType =
  | 'joiner'
  | 'mover'
  | 'leaver'
  | 'device_recover'
  | 'app_request'
  | 'cancelled_hire';
export type StepStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'needs_human'
  | 'blocked';

export type HrisEventType =
  | 'hris.employee.hired'
  | 'hris.employee.updated'
  | 'hris.employee.role_changed'
  | 'hris.employee.terminated'
  | 'hris.employee.rehire'
  | 'hris.employee.cancelled_hire';

export type HrisEventEnvelope = {
  event_id: string;
  event_type: HrisEventType;
  event_time: string;
  correlation_id: string;
  entity_id: string;
  producer: 'hris';
  schema_version: string;
  idempotency_key: string;
};

export type HrisHiredBody = {
  employee_id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_name?: string | null;
  work_email?: string | null;
  personal_email: string;
  start_date: string;
  primary_role_id: string;
  secondary_role_ids?: string[];
  manager_employee_id?: string | null;
  location?: string | null;
  country?: string | null;
  employment_type: 'FTE' | 'intern' | 'contractor';
  device_preference?: DevicePreference | null;
  device_ownership: 'company_owned' | 'personal_byod';
  entity_id: string;
  cost_center?: string | null;
  job_title: string;
};

export type HrisTerminatedBody = {
  employee_id: string;
  entity_id: string;
  effective_at: string;
  last_working_day?: string | null;
  termination_type: 'voluntary' | 'involuntary' | 'immediate';
  retain_mailbox_days?: number;
  device_ownership?: DeviceOwnership;
};

export type WorkerCommand =
  | 'entra.user.upsert'
  | 'entra.user.disable'
  | 'entra.user.enable'
  | 'entra.group.member.set'
  | 'entra.tap.create'
  | 'intune.device.assign_user'
  | 'intune.device.wipe'
  | 'intune.device.retire'
  | 'intune.byod.ensure_mam'
  | 'intune.byod.selective_wipe'
  | 'intune.byod.retire'
  | 'scim.user.set'
  | 'notify.send'
  | 'entitlement.materialize'
  | 'entitlement.revoke_all';

export type IdentityAuditAction =
  | 'case_created'
  | 'case_closed'
  | 'kit_resolved'
  | 'device_path_resolved'
  | 'entra_user_create'
  | 'entra_user_update'
  | 'account_enable'
  | 'account_disable'
  | 'session_revoke'
  | 'group_add'
  | 'group_remove'
  | 'entitlement_assign'
  | 'entitlement_revoke'
  | 'byod_mam_target'
  | 'byod_status_sync'
  | 'byod_selective_wipe'
  | 'byod_retire'
  | 'byod_wipe_blocked'
  | 'byod_offboard_start'
  | 'byod_offboard_complete'
  | 'device_reserve'
  | 'device_wipe'
  | 'notify'
  | 'it_offboard_gate'
  | 'ai_action_blocked'
  | 'fo24_bootstrap'
  | 'needs_human';

export function caseTypeToVmEvent(
  caseType: CaseType,
): 'Onboard' | 'Offboard' | 'Transfer' | CaseType {
  if (caseType === 'joiner') return 'Onboard';
  if (caseType === 'leaver') return 'Offboard';
  if (caseType === 'mover') return 'Transfer';
  return caseType;
}
