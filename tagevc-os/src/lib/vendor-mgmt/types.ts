/** Vendor Management spine types — workbook Data_Dictionary contract. */

export const VM_SPINE_VERSION = 'vendor-mgmt-v1' as const;

export type VmEntityCode = 'TAGE' | 'R619' | 'SHR' | 'INDA';
export type VmEntityScope = 'ALL' | string;

export type BillingCadence = 'Monthly' | 'Quarterly' | 'Semi-Annual' | 'Annual';
export type PricingModel = 'Per User' | 'Fixed' | 'Usage' | 'Hybrid';
export type VendorStatus = 'Active' | 'Ended' | 'Replaced';
export type EmpStatus = 'Active' | 'Terminated';
export type RenewalStatus =
  | 'Draft'
  | 'Watch'
  | 'In Review'
  | 'Pending Approval'
  | 'Pending Finance'
  | 'Approved'
  | 'Rejected'
  | 'At Risk';
export type RenewalDecision = 'Approve' | 'Reject' | 'Renegotiate';
export type RequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Expired';
export type SecurityReview = 'Approved' | 'Review Due' | 'Rejected';
export type LifecycleEvent = 'Onboard' | 'Offboard' | 'Transfer';
export type CaseStatus = 'Planned' | 'In Progress' | 'Complete';
export type ChargeMethod = 'Seats' | 'Fixed %';
export type Scenario = 'Base' | 'Bear' | 'Bull';
export type IntegStatus = 'Planned' | 'Live' | 'Paused' | 'Error';
export type AdminRoleId =
  | 'AR-SUPER'
  | 'AR-VEND'
  | 'AR-FIN'
  | 'AR-IT'
  | 'AR-HR'
  | 'AR-VIEW'
  | 'AR-ENT';

export type VmPermissionKey =
  | 'login_portal'
  | 'view_vendors'
  | 'create_vendor'
  | 'edit_vendor'
  | 'archive_vendor'
  | 'edit_contracts'
  | 'manage_seats'
  | 'approve_renewal'
  | 'manage_products'
  | 'manage_role_rules'
  | 'manage_employees'
  | 'manage_admins'
  | 'view_audit_log'
  | 'export_data';

export type RenewalAlertStage =
  | 'OK'
  | '90-DAY'
  | '60-DAY'
  | '30-DAY'
  | 'EXPIRED';

export type VmEntityCodeRow = {
  code: string;
  entity_id: string;
  legal_name: string;
  entity_type: 'Parent' | 'Subsidiary';
  parent_code: string | null;
  status: 'Active' | 'Inactive';
  currency: string;
  fy_start_month: number;
  shared_services_pct: number;
  notes: string | null;
};

export type VmSettings = {
  id: string;
  scenario: Scenario;
  as_of_date: string;
  currency: string;
  burden_pct: number;
  benefits_monthly: number;
  recruiting_pct: number;
  equipment_onetime: number;
  training_90d: number;
  facilities_monthly: number;
  mgmt_overhead_pct: number;
  hc_growth_bear: number;
  hc_growth_base: number;
  hc_growth_bull: number;
  rev_growth_bear: number;
  rev_growth_base: number;
  rev_growth_bull: number;
  seat_inflation_bear: number;
  seat_inflation_base: number;
  seat_inflation_bull: number;
};

export type VmFxRate = {
  currency: string;
  rate_to_usd: number;
  as_of_date: string;
  source: string | null;
  active: boolean;
  notes: string | null;
};

export type VmVendor = {
  id: string;
  name: string;
  entity_id: string;
  category: string | null;
  product: string | null;
  pricing_model: PricingModel;
  billing_cadence: BillingCadence;
  invoice_amount: number;
  currency: string;
  seats_contracted: number | null;
  seats_active: number | null;
  unit_price: number | null;
  contract_start: string | null;
  contract_end: string | null;
  auto_renew: boolean;
  status: VendorStatus;
  owner: string | null;
  notes: string | null;
  partner_key: string | null;
  cost_center_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VmVendorComputed = VmVendor & {
  monthly_usd: number;
  annual_usd: number;
  utilization_pct: number | null;
  waste_monthly: number;
  renewal_stage: RenewalAlertStage;
  days_to_end: number | null;
};

export type VmVendorProfile = {
  vendor_id: string;
  legal_name: string | null;
  entity_id: string;
  category: string | null;
  primary_contact: string | null;
  email: string | null;
  phone: string | null;
  support_url: string | null;
  sla_tier: string | null;
  security_review: SecurityReview;
  dpa: boolean;
  contract_url: string | null;
  renewal_notice_days: number;
  notes: string | null;
};

export type VmProduct = {
  id: string;
  name: string;
  vendor_id: string | null;
  entity_scope: string;
  license_type: string | null;
  cost_seat_mo: number;
  fixed_cost_mo: number;
  requires_sso: boolean;
  sensitivity: string | null;
  offboard_action: 'Revoke' | 'Keep org';
  active: boolean;
  notes: string | null;
};

export type VmRole = {
  id: string;
  name: string;
  entity_id: string;
  dept: string | null;
  level: string | null;
};

export type VmRoleProduct = {
  role_id: string;
  product_id: string;
  is_birthright: boolean;
};

export type VmEmployee = {
  id: string;
  name: string;
  entity_id: string;
  role_id: string | null;
  dept: string | null;
  status: EmpStatus;
  fte: number;
  base_salary_annual: number;
  commission_target_annual: number;
  start_date: string | null;
  work_location: string | null;
  manager_emp_id: string | null;
  notes: string | null;
  archived_at: string | null;
};

export type VmEntitlement = {
  emp_id: string;
  product_id: string;
  assigned: boolean;
  source: 'birthright' | 'request' | 'exception';
};

export type VmAccessRequest = {
  id: string;
  emp_id: string;
  product_id: string;
  request_date: string;
  needed_until: string | null;
  status: RequestStatus;
  approver: string | null;
  decision_date: string | null;
  business_justification: string | null;
};

export type VmRenewal = {
  id: string;
  vendor_id: string;
  entity_id: string;
  contract_end: string;
  notice_days: number;
  proposed_annual: number | null;
  status: RenewalStatus;
  approver_admin_id: string | null;
  approval_date: string | null;
  decision: RenewalDecision | null;
  owner_emp_id: string | null;
  notes: string | null;
};

export type VmBudget = {
  id: string;
  entity_id: string;
  category: string;
  fy: number;
  annual_budget: number;
  notes: string | null;
};

export type VmCostCenter = {
  id: string;
  name: string;
  entity_id: string;
  dept_code: string | null;
  cc_type: string | null;
  status: 'Active' | 'Inactive';
  owner_emp_id: string | null;
  notes: string | null;
};

export type VmCompBand = {
  id: string;
  role_id: string;
  level: string | null;
  entity_id: string;
  base_min: number | null;
  base_mid: number | null;
  base_max: number | null;
  comm_target_mid: number | null;
  equity_note: string | null;
};

export type VmLifecycleTemplate = {
  id: string;
  event: LifecycleEvent;
  phase: string;
  task: string;
  owner_role: string | null;
  sla_hours: number;
  sort_order: number;
};

export type VmLifecycleCase = {
  id: string;
  emp_id: string;
  event: LifecycleEvent;
  role_id: string | null;
  entity_id: string;
  start_date: string;
  target_complete: string | null;
  status: CaseStatus;
  notes: string | null;
};

export type VmUsageSignal = {
  id: string;
  emp_id: string;
  product_id: string;
  assigned: boolean;
  last_active: string | null;
  threshold_days: number;
  action: string | null;
};

export type VmChargebackRule = {
  id: string;
  vendor_id: string;
  method: ChargeMethod;
  pct_tage: number;
  pct_r619: number;
  pct_shr: number;
  pct_inda: number;
  notes: string | null;
};

export type VmAlertRule = {
  id: string;
  name: string;
  category: string;
  condition_logic: string;
  threshold: number | null;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  channel: string;
  audience: string | null;
  enabled: boolean;
  last_eval_at: string | null;
};

export type VmAlertEvent = {
  id: string;
  rule_id: string;
  entity_id: string | null;
  object_type: string | null;
  object_id: string | null;
  message: string;
  severity: string;
  triggered_at: string;
  acknowledged_at: string | null;
};

export type VmIntegration = {
  id: string;
  system_name: string;
  category: string | null;
  direction: string | null;
  entities: string | null;
  auth_type: string | null;
  status: IntegStatus;
  sync_cadence: string | null;
  owner_emp_id: string | null;
  primary_objects: string | null;
  env: string | null;
  notes: string | null;
};

export type VmAdminUser = {
  id: string;
  display_name: string;
  email: string;
  emp_id: string | null;
  admin_role_id: AdminRoleId;
  entity_scope: string;
  status: 'Active' | 'Inactive';
  mfa_enrolled: boolean;
  last_login_at: string | null;
  notes: string | null;
  os_user_id: string | null;
};

export type VmAuditEvent = {
  id: string;
  ts_utc: string;
  actor_admin_id: string | null;
  actor_email: string | null;
  action: string;
  entity_id: string | null;
  object_type: string;
  object_id: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  ip_hash: string | null;
};

export type VmRevenueInput = {
  entity_id: string;
  ttm_revenue: number;
};

export type VendorInput = {
  id?: string;
  name: string;
  entity_id: string;
  category?: string | null;
  product?: string | null;
  pricing_model: PricingModel;
  billing_cadence: BillingCadence;
  invoice_amount: number;
  currency?: string;
  seats_contracted?: number | null;
  seats_active?: number | null;
  unit_price?: number | null;
  contract_start?: string | null;
  contract_end?: string | null;
  auto_renew?: boolean;
  status?: VendorStatus;
  owner?: string | null;
  notes?: string | null;
  partner_key?: string | null;
  cost_center_id?: string | null;
};
