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
} from '@/lib/vendor-mgmt/repo';
import {
  requireVmSession,
  vmCanWrite,
  vmSessionCanEntity,
} from '@/lib/vendor-mgmt/session';
import { evaluateAlertRules, persistTriggeredAlerts } from '@/lib/vendor-mgmt/alerts';
import type {
  BillingCadence,
  PricingModel,
  VendorStatus,
  VmChargebackRule,
  VmVendorProfile,
} from '@/lib/vendor-mgmt/types';

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
}

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

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
    if (
      isContractDollar &&
      vmCanWrite(session, 'edit_contracts') &&
      formData.get('step_up_confirm') !== 'on'
    ) {
      return {
        ok: false,
        error: 'Step-up required: confirm re-auth checkbox for contract $ changes',
      };
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
    const admin_role_id = String(formData.get('admin_role_id') || 'AR-VIEW');
    const entity_scope = String(formData.get('entity_scope') || 'ALL');
    if (!email || !display_name) {
      return { ok: false, error: 'Name and email required' };
    }
    const id = `AU-${email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)}`;
    const { createPersistClient } = await import('@/lib/supabase/persist-client');
    const sb = await createPersistClient();
    const { error } = await sb.from('vm_admin_users').upsert({
      id,
      display_name,
      email,
      admin_role_id,
      entity_scope,
      status: 'Active',
      mfa_enrolled: false,
      notes: 'Invited via OS — bind SSO on first login',
      updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    await appendAuditEvent({
      actor_email: session.email,
      action: 'admin.invite',
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
