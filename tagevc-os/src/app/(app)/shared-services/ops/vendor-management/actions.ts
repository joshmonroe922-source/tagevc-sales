'use server';

import { revalidatePath } from 'next/cache';
import { chargebackPctValid } from '@/lib/vendor-mgmt/math';
import {
  onboardEmployee,
  terminateEmployee,
  transferEmployeeRole,
} from '@/lib/vendor-mgmt/lifecycle';
import {
  appendAuditEvent,
  archiveVendor,
  setRoleProduct,
  upsertAccessRequest,
  upsertBudget,
  upsertChargebackRule,
  upsertEmployee,
  upsertProduct,
  upsertRenewal,
  upsertRevenueInput,
  upsertRole,
  upsertVendor,
  upsertVendorProfile,
  updateVmSettings,
  upsertCostCenter,
  upsertCompBand,
} from '@/lib/vendor-mgmt/repo';
import {
  requireVmSession,
  vmCanWrite,
  vmSessionCanEntity,
} from '@/lib/vendor-mgmt/session';
import { evaluateAlertRules, persistTriggeredAlerts } from '@/lib/vendor-mgmt/alerts';
import { VM_CONNECTOR_SCAFFOLDS } from '@/lib/vendor-mgmt/connectors';
import {
  boolish,
  numOrNull,
  parseCsv,
  validateCsvHeaders,
  type CsvImportKind,
} from '@/lib/vendor-mgmt/csv-import';
import {
  clearVmStepUp,
  confirmVmStepUpChallenge,
  hasValidVmStepUp,
  issueVmStepUpChallenge,
} from '@/lib/vendor-mgmt/step-up';
import type {
  AdminRoleId,
  BillingCadence,
  PricingModel,
  VendorStatus,
  VmChargebackRule,
  VmVendorProfile,
} from '@/lib/vendor-mgmt/types';
import type { VmSession } from '@/lib/vendor-mgmt/session';

const BASE = '/shared-services/ops/vendor-management';

function revalidateVm() {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/vendors`);
  revalidatePath(`${BASE}/renewals`);
  revalidatePath(`${BASE}/employees`);
  revalidatePath(`${BASE}/products`);
  revalidatePath(`${BASE}/roles`);
  revalidatePath(`${BASE}/access`);
  revalidatePath(`${BASE}/lifecycle`);
  revalidatePath(`${BASE}/budgets`);
  revalidatePath(`${BASE}/chargeback`);
  revalidatePath(`${BASE}/hire`);
  revalidatePath(`${BASE}/alerts`);
  revalidatePath(`${BASE}/audit`);
  revalidatePath(`${BASE}/cost-centers`);
  revalidatePath(`${BASE}/settings`);
  revalidatePath(`${BASE}/admins`);
  revalidatePath(`${BASE}/integrations`);
  revalidatePath(`${BASE}/import`);
}

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

async function assertContractStepUp(
  session: VmSession,
  formData?: FormData,
): Promise<ActionResult | null> {
  if (await hasValidVmStepUp(session.email)) return null;
  if (
    formData?.get('step_up_confirm') === 'on' ||
    formData?.get('step_up_token') === '1'
  ) {
    return null;
  }
  return {
    ok: false,
    error:
      'Step-up MFA required for contract $ / renewal decisions — use the step-up gate, then retry',
  };
}

function slugId(prefix: string, name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `${prefix}-${base || 'X'}-${Date.now().toString(36).slice(-4)}`;
}

export async function saveVendorAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireVmSession('edit_vendor');
    const id = String(formData.get('id') || '').trim() || slugId('V', String(formData.get('name')));
    const entity_id = String(formData.get('entity_id') || '');
    if (!vmSessionCanEntity(session, entity_id)) {
      return { ok: false, error: 'Entity scope denied' };
    }
    const pricing_model = String(formData.get('pricing_model')) as PricingModel;
    const billing_cadence = String(formData.get('billing_cadence')) as BillingCadence;
    const invoice_amount = Number(formData.get('invoice_amount') || 0);
    const unit_priceRaw = formData.get('unit_price');
    const seats_activeRaw = formData.get('seats_active');
    const seats_contractedRaw = formData.get('seats_contracted');

    const isContractDollar =
      formData.get('invoice_amount') != null || formData.get('unit_price') != null;
    if (isContractDollar && !vmCanWrite(session, 'edit_contracts')) {
      if (!vmCanWrite(session, 'create_vendor')) {
        return { ok: false, error: 'Contract $ edit requires Finance / Vendor Admin' };
      }
    }
    if (isContractDollar && vmCanWrite(session, 'edit_contracts')) {
      const step = await assertContractStepUp(session, formData);
      if (step) return step;
    }

    const row = await upsertVendor({
      id,
      name: String(formData.get('name') || '').trim(),
      entity_id,
      category: String(formData.get('category') || '') || null,
      product: String(formData.get('product') || '') || null,
      pricing_model,
      billing_cadence,
      invoice_amount,
      currency: String(formData.get('currency') || 'USD'),
      seats_contracted:
        seats_contractedRaw === '' || seats_contractedRaw == null
          ? null
          : Number(seats_contractedRaw),
      seats_active:
        seats_activeRaw === '' || seats_activeRaw == null
          ? null
          : Number(seats_activeRaw),
      unit_price:
        unit_priceRaw === '' || unit_priceRaw == null
          ? null
          : Number(unit_priceRaw),
      contract_start: String(formData.get('contract_start') || '') || null,
      contract_end: String(formData.get('contract_end') || '') || null,
      auto_renew: formData.get('auto_renew') === 'on',
      status: (String(formData.get('status') || 'Active') as VendorStatus) || 'Active',
      owner: String(formData.get('owner') || '') || null,
      notes: String(formData.get('notes') || '') || null,
      partner_key: String(formData.get('partner_key') || '') || null,
    });
    if (!row) return { ok: false, error: 'Save failed — apply phase90 SQL?' };
    await appendAuditEvent({
      actor_email: session.email,
      action: formData.get('id') ? 'vendor.update' : 'vendor.create',
      entity_id,
      object_type: 'vendor',
      object_id: id,
    });
    revalidateVm();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function archiveVendorAction(vendorId: string): Promise<ActionResult> {
  try {
    const session = await requireVmSession('archive_vendor');
    const ok = await archiveVendor(vendorId);
    if (!ok) return { ok: false, error: 'Archive failed' };
    await appendAuditEvent({
      actor_email: session.email,
      action: 'vendor.archive',
      object_type: 'vendor',
      object_id: vendorId,
    });
    revalidateVm();
    return { ok: true, id: vendorId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveVendorProfileAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const session = await requireVmSession('edit_vendor');
    const vendor_id = String(formData.get('vendor_id'));
    const entity_id = String(formData.get('entity_id'));
    if (!vmSessionCanEntity(session, entity_id)) {
      return { ok: false, error: 'Entity scope denied' };
    }
    const row: VmVendorProfile = {
      vendor_id,
      legal_name: String(formData.get('legal_name') || '') || null,
      entity_id,
      category: String(formData.get('category') || '') || null,
      primary_contact: String(formData.get('primary_contact') || '') || null,
      email: String(formData.get('email') || '') || null,
      phone: String(formData.get('phone') || '') || null,
      support_url: String(formData.get('support_url') || '') || null,
      sla_tier: String(formData.get('sla_tier') || '') || null,
      security_review: (String(formData.get('security_review') || 'Review Due') as
        | 'Approved'
        | 'Review Due'
        | 'Rejected') || 'Review Due',
      dpa: formData.get('dpa') === 'on',
      contract_url: String(formData.get('contract_url') || '') || null,
      renewal_notice_days: Number(formData.get('renewal_notice_days') || 90),
      notes: String(formData.get('notes') || '') || null,
    };
    const saved = await upsertVendorProfile(row);
    if (!saved) return { ok: false, error: 'Profile save failed' };
    revalidateVm();
    return { ok: true, id: vendor_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveProductAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireVmSession('manage_products');
    const id = String(formData.get('id') || '').trim() || slugId('P', String(formData.get('name')));
    const row = await upsertProduct({
      id,
      name: String(formData.get('name') || '').trim(),
      vendor_id: String(formData.get('vendor_id') || '') || null,
      entity_scope: String(formData.get('entity_scope') || 'ALL'),
      license_type: String(formData.get('license_type') || '') || null,
      cost_seat_mo: Number(formData.get('cost_seat_mo') || 0),
      fixed_cost_mo: Number(formData.get('fixed_cost_mo') || 0),
      requires_sso: formData.get('requires_sso') === 'on',
      sensitivity: String(formData.get('sensitivity') || '') || null,
      offboard_action:
        formData.get('offboard_action') === 'Keep org' ? 'Keep org' : 'Revoke',
      active: formData.get('active') !== 'off',
      notes: String(formData.get('notes') || '') || null,
    });
    if (!row) return { ok: false, error: 'Product save failed' };
    revalidateVm();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveRoleAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireVmSession('manage_role_rules');
    const id = String(formData.get('id') || '').trim() || slugId('R', String(formData.get('name')));
    const row = await upsertRole({
      id,
      name: String(formData.get('name') || '').trim(),
      entity_id: String(formData.get('entity_id')),
      dept: String(formData.get('dept') || '') || null,
      level: String(formData.get('level') || '') || null,
    });
    if (!row) return { ok: false, error: 'Role save failed' };
    revalidateVm();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function setBirthrightAction(
  roleId: string,
  productId: string,
  on: boolean,
): Promise<ActionResult> {
  try {
    await requireVmSession('manage_role_rules');
    const ok = await setRoleProduct(roleId, productId, on);
    if (!ok) return { ok: false, error: 'Update failed' };
    revalidateVm();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveEmployeeAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireVmSession('manage_employees');
    const id = String(formData.get('id') || '').trim() || slugId('E', String(formData.get('name')));
    const entity_id = String(formData.get('entity_id'));
    if (!vmSessionCanEntity(session, entity_id)) {
      return { ok: false, error: 'Entity scope denied' };
    }
    const isNew = !String(formData.get('id') || '').trim();
    const row = await upsertEmployee({
      id,
      name: String(formData.get('name') || '').trim(),
      entity_id,
      role_id: String(formData.get('role_id') || '') || null,
      dept: String(formData.get('dept') || '') || null,
      status: formData.get('status') === 'Terminated' ? 'Terminated' : 'Active',
      fte: Number(formData.get('fte') || 1),
      base_salary_annual: Number(formData.get('base_salary_annual') || 0),
      commission_target_annual: Number(formData.get('commission_target_annual') || 0),
      start_date: String(formData.get('start_date') || '') || null,
      work_location: String(formData.get('work_location') || '') || null,
      manager_emp_id: String(formData.get('manager_emp_id') || '') || null,
      notes: String(formData.get('notes') || '') || null,
    });
    if (!row) return { ok: false, error: 'Employee save failed' };
    if (isNew && row.status === 'Active') {
      await onboardEmployee(row, session.email);
    }
    revalidateVm();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function terminateEmployeeAction(empId: string): Promise<ActionResult> {
  try {
    const session = await requireVmSession('manage_employees');
    const result = await terminateEmployee(empId, session.email);
    if (!result.ok) return { ok: false, error: 'Terminate failed' };
    revalidateVm();
    return { ok: true, id: empId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function transferRoleAction(
  empId: string,
  newRoleId: string,
): Promise<ActionResult> {
  try {
    const session = await requireVmSession('manage_employees');
    await transferEmployeeRole(empId, newRoleId, session.email);
    revalidateVm();
    return { ok: true, id: empId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveRenewalAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireVmSession('edit_contracts');
    const id = String(formData.get('id') || '').trim() || slugId('RN', String(formData.get('vendor_id')));
    const decision = String(formData.get('decision') || '') || null;
    if (decision && !vmCanWrite(session, 'approve_renewal')) {
      return { ok: false, error: 'Approve/reject requires Finance or Super' };
    }
    const needsStep =
      Boolean(decision) ||
      (formData.get('proposed_annual') != null &&
        String(formData.get('proposed_annual')) !== '');
    if (needsStep) {
      const step = await assertContractStepUp(session, formData);
      if (step) return step;
    }
    const row = await upsertRenewal({
      id,
      vendor_id: String(formData.get('vendor_id')),
      entity_id: String(formData.get('entity_id')),
      contract_end: String(formData.get('contract_end')),
      notice_days: Number(formData.get('notice_days') || 90),
      proposed_annual:
        formData.get('proposed_annual') === '' || formData.get('proposed_annual') == null
          ? null
          : Number(formData.get('proposed_annual')),
      status: (String(formData.get('status') || 'Draft') as
        | 'Draft'
        | 'Watch'
        | 'In Review'
        | 'Pending Approval'
        | 'Pending Finance'
        | 'Approved'
        | 'Rejected'
        | 'At Risk') || 'Draft',
      decision: decision as 'Approve' | 'Reject' | 'Renegotiate' | null,
      approval_date: decision ? new Date().toISOString().slice(0, 10) : null,
      notes: String(formData.get('notes') || '') || null,
      owner_emp_id: String(formData.get('owner_emp_id') || '') || null,
      approver_admin_id: session.email,
    });
    if (!row) return { ok: false, error: 'Renewal save failed' };
    await appendAuditEvent({
      actor_email: session.email,
      action: decision ? `renewal.${String(decision).toLowerCase()}` : 'renewal.submit',
      entity_id: row.entity_id,
      object_type: 'renewal',
      object_id: id,
    });
    revalidateVm();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveBudgetAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireVmSession('edit_contracts');
    const id = String(formData.get('id') || '').trim() || slugId('B', String(formData.get('category')));
    const row = await upsertBudget({
      id,
      entity_id: String(formData.get('entity_id')),
      category: String(formData.get('category')),
      fy: Number(formData.get('fy') || new Date().getFullYear()),
      annual_budget: Number(formData.get('annual_budget') || 0),
      notes: String(formData.get('notes') || '') || null,
    });
    if (!row) return { ok: false, error: 'Budget save failed' };
    revalidateVm();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveAccessRequestAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireVmSession('manage_seats');
    const id = String(formData.get('id') || '').trim() || slugId('AR', String(formData.get('emp_id')));
    const row = await upsertAccessRequest({
      id,
      emp_id: String(formData.get('emp_id')),
      product_id: String(formData.get('product_id')),
      request_date:
        String(formData.get('request_date') || '') ||
        new Date().toISOString().slice(0, 10),
      needed_until: String(formData.get('needed_until') || '') || null,
      status: (String(formData.get('status') || 'Pending') as
        | 'Pending'
        | 'Approved'
        | 'Rejected'
        | 'Expired') || 'Pending',
      business_justification:
        String(formData.get('business_justification') || '') || null,
      approver: String(formData.get('approver') || '') || null,
      decision_date: String(formData.get('decision_date') || '') || null,
    });
    if (!row) return { ok: false, error: 'Request save failed' };
    revalidateVm();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveChargebackAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireVmSession('edit_contracts');
    const rule: VmChargebackRule = {
      id: String(formData.get('id') || '').trim() || slugId('CB', String(formData.get('vendor_id'))),
      vendor_id: String(formData.get('vendor_id')),
      method: formData.get('method') === 'Seats' ? 'Seats' : 'Fixed %',
      pct_tage: Number(formData.get('pct_tage') || 0),
      pct_r619: Number(formData.get('pct_r619') || 0),
      pct_shr: Number(formData.get('pct_shr') || 0),
      pct_inda: Number(formData.get('pct_inda') || 0),
      notes: String(formData.get('notes') || '') || null,
    };
    if (!chargebackPctValid(rule)) {
      return { ok: false, error: 'Fixed % weights must sum to 100%' };
    }
    const saved = await upsertChargebackRule(rule);
    if (!saved) return { ok: false, error: 'Chargeback save failed' };
    revalidateVm();
    return { ok: true, id: rule.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireVmSession('edit_contracts');
    const saved = await updateVmSettings({
      scenario: (String(formData.get('scenario') || 'Base') as 'Base' | 'Bear' | 'Bull') || 'Base',
      as_of_date: String(formData.get('as_of_date') || new Date().toISOString().slice(0, 10)),
      currency: String(formData.get('currency') || 'USD'),
      burden_pct: Number(formData.get('burden_pct') || 0.28),
      benefits_monthly: Number(formData.get('benefits_monthly') || 450),
      recruiting_pct: Number(formData.get('recruiting_pct') || 0.15),
      equipment_onetime: Number(formData.get('equipment_onetime') || 2500),
      training_90d: Number(formData.get('training_90d') || 1500),
      facilities_monthly: Number(formData.get('facilities_monthly') || 200),
      mgmt_overhead_pct: Number(formData.get('mgmt_overhead_pct') || 0.08),
    });
    if (!saved) return { ok: false, error: 'Settings save failed' };
    revalidateVm();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveRevenueAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireVmSession('edit_contracts');
    const entity_id = String(formData.get('entity_id'));
    const ttm = Number(formData.get('ttm_revenue') || 0);
    const ok = await upsertRevenueInput(entity_id, ttm);
    if (!ok) return { ok: false, error: 'Revenue save failed' };
    revalidateVm();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function runAlertEvalAction(): Promise<ActionResult> {
  try {
    await requireVmSession('view_audit_log');
    const evaluated = await evaluateAlertRules();
    const n = await persistTriggeredAlerts(evaluated);
    revalidateVm();
    return { ok: true, id: String(n) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function inviteAdminAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireVmSession('manage_admins');
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const display_name = String(formData.get('display_name') || '').trim();
    const admin_role_id = String(
      formData.get('admin_role_id') || 'AR-VIEW',
    ) as AdminRoleId;
    const entity_scope = String(formData.get('entity_scope') || 'ALL');
    const emp_id = String(formData.get('emp_id') || '').trim() || null;
    const mfa_enrolled = formData.get('mfa_enrolled') === 'on';
    if (!email || !display_name) {
      return { ok: false, error: 'Name and email required' };
    }
    const id =
      String(formData.get('id') || '').trim() ||
      `AU-${email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)}`;
    const { createPersistClient } = await import('@/lib/supabase/persist-client');
    const sb = await createPersistClient();
    const { error } = await sb.from('vm_admin_users').upsert({
      id,
      display_name,
      email,
      emp_id,
      admin_role_id,
      entity_scope,
      status: 'Active',
      mfa_enrolled,
      notes:
        String(formData.get('notes') || '').trim() ||
        'Invited via OS — bind SSO on first login',
      updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    await appendAuditEvent({
      actor_email: session.email,
      action: formData.get('id') ? 'admin.update' : 'admin.invite',
      object_type: 'admin_user',
      object_id: id,
      new_value: email,
    });
    revalidateVm();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}


export async function saveCostCenterAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireVmSession('edit_contracts');
    const entity_id = String(formData.get('entity_id') || session.filterEntityId || 'ENT-FIRM');
    if (!vmSessionCanEntity(session, entity_id)) {
      return { ok: false, error: 'Entity out of scope' };
    }
    const name = String(formData.get('name') || '').trim();
    if (!name) return { ok: false, error: 'Name required' };
    const row = await upsertCostCenter({
      id: String(formData.get('id') || '') || undefined,
      name,
      entity_id,
      dept_code: String(formData.get('dept_code') || '') || null,
      cc_type: String(formData.get('cc_type') || '') || null,
      status: (String(formData.get('status') || 'Active') as 'Active' | 'Inactive') || 'Active',
      notes: String(formData.get('notes') || '') || null,
    });
    if (!row) return { ok: false, error: 'Cost center save failed' };
    await appendAuditEvent({
      actor_email: session.email,
      action: 'cost_center.upsert',
      object_type: 'cost_center',
      object_id: row.id,
      new_value: name,
    });
    revalidateVm();
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function saveCompBandAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireVmSession('edit_contracts');
    const entity_id = String(formData.get('entity_id') || session.filterEntityId || 'ENT-FIRM');
    if (!vmSessionCanEntity(session, entity_id)) {
      return { ok: false, error: 'Entity out of scope' };
    }
    const role_id = String(formData.get('role_id') || '').trim();
    if (!role_id) return { ok: false, error: 'Role required' };
    const num = (k: string) => {
      const raw = formData.get(k);
      if (raw === '' || raw == null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    const row = await upsertCompBand({
      id: String(formData.get('id') || '') || undefined,
      role_id,
      entity_id,
      level: String(formData.get('level') || '') || null,
      base_min: num('base_min'),
      base_mid: num('base_mid'),
      base_max: num('base_max'),
      comm_target_mid: num('comm_target_mid'),
      equity_note: String(formData.get('equity_note') || '') || null,
    });
    if (!row) return { ok: false, error: 'Comp band save failed' };
    await appendAuditEvent({
      actor_email: session.email,
      action: 'comp_band.upsert',
      object_type: 'comp_band',
      object_id: row.id,
      new_value: role_id,
    });
    revalidateVm();
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function setAdminStatusAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireVmSession('manage_admins');
    const id = String(formData.get('id') || '').trim();
    const status = String(formData.get('status') || '') as 'Active' | 'Inactive';
    if (!id || (status !== 'Active' && status !== 'Inactive')) {
      return { ok: false, error: 'id and status required' };
    }
    const { createPersistClient } = await import('@/lib/supabase/persist-client');
    const sb = await createPersistClient();
    const { error } = await sb
      .from('vm_admin_users')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    await appendAuditEvent({
      actor_email: session.email,
      action: status === 'Inactive' ? 'admin.deactivate' : 'admin.activate',
      object_type: 'admin_user',
      object_id: id,
      new_value: status,
    });
    revalidateVm();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function issueVmStepUpAction(): Promise<
  | { ok: true; code: string; ttlSec: number }
  | { ok: false; error: string }
> {
  try {
    const session = await requireVmSession('view_vendors');
    if (!session.email) return { ok: false, error: 'SSO email required for step-up' };
    const issued = await issueVmStepUpChallenge(session.email);
    await appendAuditEvent({
      actor_email: session.email,
      action: 'auth.stepup_issue',
      object_type: 'session',
      object_id: session.email,
    });
    return { ok: true, code: issued.code, ttlSec: issued.ttlSec };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function confirmVmStepUpAction(input: {
  email: string;
  code: string;
}): Promise<{ ok: true; expiresAt: number } | { ok: false; error: string }> {
  try {
    const session = await requireVmSession('view_vendors');
    if (!session.email) return { ok: false, error: 'SSO email required' };
    const result = await confirmVmStepUpChallenge({
      email: input.email || session.email,
      code: input.code,
    });
    if (!result.ok) return result;
    await appendAuditEvent({
      actor_email: session.email,
      action: 'auth.stepup_confirm',
      object_type: 'session',
      object_id: session.email,
    });
    return result;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function clearVmStepUpAction(): Promise<{ ok: true }> {
  await clearVmStepUp();
  return { ok: true };
}

export async function seedIntegrationsAction(): Promise<ActionResult> {
  try {
    const session = await requireVmSession('manage_admins');
    const { createPersistClient } = await import('@/lib/supabase/persist-client');
    const sb = await createPersistClient();
    const rows = VM_CONNECTOR_SCAFFOLDS.map(({ env_keys: _e, ...row }) => ({
      ...row,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb.from('vm_integrations').upsert(rows);
    if (error) return { ok: false, error: error.message };
    await appendAuditEvent({
      actor_email: session.email,
      action: 'integrations.seed_scaffolds',
      object_type: 'integration',
      object_id: 'registry',
      new_value: String(rows.length),
    });
    revalidateVm();
    return { ok: true, id: String(rows.length) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}

export async function importCsvAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireVmSession('view_vendors');
    const canImport =
      vmCanWrite(session, 'create_vendor') ||
      vmCanWrite(session, 'edit_contracts') ||
      vmCanWrite(session, 'manage_employees') ||
      vmCanWrite(session, 'manage_admins');
    if (!canImport) {
      return { ok: false, error: 'Import requires Vendor/Finance/HR/Super write role' };
    }
    const kind = String(formData.get('kind') || '') as CsvImportKind;
    const text = String(formData.get('csv') || '');
    if (!kind || !text.trim()) return { ok: false, error: 'kind and csv required' };
    const parsed = parseCsv(text);
    // Accept display_name alias for employees
    const headers = parsed.headers.map((h) =>
      kind === 'employees' && h === 'display_name' ? 'name' : h,
    );
    const rows = parsed.rows.map((row) => {
      if (kind === 'employees' && row.display_name && !row.name) {
        return { ...row, name: row.display_name };
      }
      return row;
    });
    const headerCheck = validateCsvHeaders(kind, headers);
    if (!headerCheck.ok) return { ok: false, error: headerCheck.error };

    let upserted = 0;
    for (const row of rows) {
      if (kind === 'vendors') {
        const entity_id = row.entity_id;
        if (!entity_id || !vmSessionCanEntity(session, entity_id)) continue;
        const saved = await upsertVendor({
          id: row.vendor_id,
          name: row.name,
          entity_id,
          category: row.category || null,
          product: row.product || null,
          pricing_model: (row.pricing_model as PricingModel) || 'Fixed',
          billing_cadence: (row.billing_cadence as BillingCadence) || 'Monthly',
          invoice_amount: Number(row.invoice_amount || 0),
          currency: row.currency || 'USD',
          seats_contracted: numOrNull(row.seats_contracted),
          seats_active: numOrNull(row.seats_active),
          unit_price: numOrNull(row.unit_price),
          contract_start: row.contract_start || null,
          contract_end: row.contract_end || null,
          auto_renew: boolish(row.auto_renew),
          status: (row.status as VendorStatus) || 'Active',
          owner: row.owner || null,
          notes: row.notes || null,
        });
        if (saved) upserted++;
      } else if (kind === 'employees') {
        if (!row.entity_id || !vmSessionCanEntity(session, row.entity_id)) continue;
        const saved = await upsertEmployee({
          id: row.emp_id,
          name: row.name || row.display_name,
          entity_id: row.entity_id,
          role_id: row.role_id || null,
          status: (row.status as 'Active' | 'Terminated') || 'Active',
          start_date: row.start_date || null,
          manager_emp_id: row.manager_emp_id || null,
          notes: row.notes || null,
          fte: 1,
          base_salary_annual: 0,
          commission_target_annual: 0,
          dept: null,
          work_location: null,
        });
        if (saved) upserted++;
      } else if (kind === 'products') {
        const saved = await upsertProduct({
          id: row.product_id,
          name: row.name,
          vendor_id: row.vendor_id || null,
          entity_scope: row.entity_scope || 'ALL',
          license_type: row.license_type || null,
          cost_seat_mo: numOrNull(row.cost_seat_mo) ?? 0,
          fixed_cost_mo: numOrNull(row.fixed_cost_mo) ?? 0,
          requires_sso: boolish(row.requires_sso),
          sensitivity: row.sensitivity || null,
          offboard_action:
            row.offboard_action === 'Keep org' ? 'Keep org' : 'Revoke',
          active: row.active === '' ? true : boolish(row.active),
          notes: row.notes || null,
        });
        if (saved) upserted++;
      } else if (kind === 'roles') {
        if (!row.entity_id || !vmSessionCanEntity(session, row.entity_id)) continue;
        const saved = await upsertRole({
          id: row.role_id,
          name: row.name,
          entity_id: row.entity_id,
          level: row.level || null,
          dept: row.dept || row.department || null,
        });
        if (saved) upserted++;
      } else if (kind === 'cost_centers') {
        if (!row.entity_id || !vmSessionCanEntity(session, row.entity_id)) continue;
        const saved = await upsertCostCenter({
          id: row.cost_center_id,
          name: row.name,
          entity_id: row.entity_id,
          dept_code: row.dept_code || null,
          cc_type: row.cc_type || null,
          status: (row.status as 'Active' | 'Inactive') || 'Active',
          notes: row.notes || null,
        });
        if (saved) upserted++;
      } else if (kind === 'admin_users') {
        if (!vmCanWrite(session, 'manage_admins')) continue;
        const { createPersistClient } = await import('@/lib/supabase/persist-client');
        const sb = await createPersistClient();
        const { error } = await sb.from('vm_admin_users').upsert({
          id: row.admin_user_id,
          display_name: row.display_name,
          email: row.email.toLowerCase(),
          emp_id: row.emp_id || null,
          admin_role_id: row.admin_role_id,
          entity_scope: row.entity_scope || 'ALL',
          status: row.status === 'Inactive' ? 'Inactive' : 'Active',
          mfa_enrolled: boolish(row.mfa_enrolled),
          notes: row.notes || null,
          updated_at: new Date().toISOString(),
        });
        if (!error) upserted++;
      }
    }

    await appendAuditEvent({
      actor_email: session.email,
      action: 'csv.import',
      object_type: kind,
      object_id: 'bulk',
      new_value: String(upserted),
    });
    revalidateVm();
    return { ok: true, id: String(upserted) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Denied' };
  }
}
