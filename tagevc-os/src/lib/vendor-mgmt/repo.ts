/**
 * Vendor Management repository — fail-soft when phase90 tables not applied.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { enrichVendor } from '@/lib/vendor-mgmt/math';
import type {
  VmAccessRequest,
  VmAdminUser,
  VmAlertEvent,
  VmAlertRule,
  VmAuditEvent,
  VmBudget,
  VmChargebackRule,
  VmCompBand,
  VmCostCenter,
  VmEmployee,
  VmEntitlement,
  VmEntityCodeRow,
  VmFxRate,
  VmIntegration,
  VmLifecycleCase,
  VmLifecycleTemplate,
  VmProduct,
  VmRenewal,
  VmRevenueInput,
  VmRole,
  VmRoleProduct,
  VmSettings,
  VmUsageSignal,
  VmVendor,
  VmVendorComputed,
  VmVendorProfile,
} from '@/lib/vendor-mgmt/types';

async function sb() {
  return createPersistClient();
}

export async function listVmEntityCodes(): Promise<VmEntityCodeRow[]> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_entity_codes')
      .select('*')
      .order('code');
    if (error) return [];
    return (data ?? []) as VmEntityCodeRow[];
  } catch {
    return [];
  }
}

export async function getVmSettings(): Promise<VmSettings | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();
    if (error || !data) return null;
    return data as VmSettings;
  } catch {
    return null;
  }
}

export async function updateVmSettings(
  patch: Partial<VmSettings>,
): Promise<VmSettings | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_settings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', 'default')
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmSettings;
  } catch {
    return null;
  }
}

export async function listFxRates(): Promise<VmFxRate[]> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_fx_rates')
      .select('*')
      .eq('active', true)
      .order('currency');
    if (error) return [];
    return (data ?? []) as VmFxRate[];
  } catch {
    return [];
  }
}

export async function listVendors(
  entityId?: string | null,
): Promise<VmVendor[]> {
  try {
    const client = await sb();
    let q = client
      .from('vm_vendors')
      .select('*')
      .is('archived_at', null)
      .order('name');
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmVendor[];
  } catch {
    return [];
  }
}

export async function listVendorsComputed(
  entityId?: string | null,
  asOf?: string,
): Promise<VmVendorComputed[]> {
  const [vendors, settings, fx] = await Promise.all([
    listVendors(entityId),
    getVmSettings(),
    listFxRates(),
  ]);
  const asOfDate = asOf ?? settings?.as_of_date ?? new Date().toISOString().slice(0, 10);
  const fxMap = new Map(fx.map((r) => [r.currency, Number(r.rate_to_usd)]));
  return vendors.map((v) =>
    enrichVendor(v, {
      asOf: asOfDate,
      rateToUsd: fxMap.get(v.currency) ?? 1,
    }),
  );
}

export async function getVendor(id: string): Promise<VmVendor | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_vendors')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return data as VmVendor;
  } catch {
    return null;
  }
}

export async function upsertVendor(
  row: Partial<VmVendor> & { id: string; name: string; entity_id: string },
): Promise<VmVendor | null> {
  try {
    const client = await sb();
    const payload = {
      ...row,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from('vm_vendors')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmVendor;
  } catch {
    return null;
  }
}

export async function archiveVendor(id: string): Promise<boolean> {
  try {
    const client = await sb();
    const { error } = await client
      .from('vm_vendors')
      .update({
        archived_at: new Date().toISOString(),
        status: 'Ended',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export async function getVendorProfile(
  vendorId: string,
): Promise<VmVendorProfile | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_vendor_profiles')
      .select('*')
      .eq('vendor_id', vendorId)
      .maybeSingle();
    if (error || !data) return null;
    return data as VmVendorProfile;
  } catch {
    return null;
  }
}

export async function upsertVendorProfile(
  row: VmVendorProfile,
): Promise<VmVendorProfile | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_vendor_profiles')
      .upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: 'vendor_id' },
      )
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmVendorProfile;
  } catch {
    return null;
  }
}

export async function listProducts(
  entityScope?: string | null,
): Promise<VmProduct[]> {
  try {
    const client = await sb();
    let q = client.from('vm_products').select('*').eq('active', true).order('name');
    if (entityScope && entityScope !== 'ALL') {
      q = q.or(`entity_scope.eq.ALL,entity_scope.eq.${entityScope}`);
    }
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmProduct[];
  } catch {
    return [];
  }
}

export async function upsertProduct(
  row: Partial<VmProduct> & { id: string; name: string },
): Promise<VmProduct | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_products')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmProduct;
  } catch {
    return null;
  }
}

export async function listRoles(entityId?: string | null): Promise<VmRole[]> {
  try {
    const client = await sb();
    let q = client.from('vm_roles').select('*').order('name');
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmRole[];
  } catch {
    return [];
  }
}

export async function upsertRole(
  row: Partial<VmRole> & { id: string; name: string; entity_id: string },
): Promise<VmRole | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_roles')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmRole;
  } catch {
    return null;
  }
}

export async function listRoleProducts(
  roleId?: string | null,
): Promise<VmRoleProduct[]> {
  try {
    const client = await sb();
    let q = client.from('vm_role_products').select('*');
    if (roleId) q = q.eq('role_id', roleId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmRoleProduct[];
  } catch {
    return [];
  }
}

export async function setRoleProduct(
  roleId: string,
  productId: string,
  isBirthright: boolean,
): Promise<boolean> {
  try {
    const client = await sb();
    if (!isBirthright) {
      const { error } = await client
        .from('vm_role_products')
        .delete()
        .eq('role_id', roleId)
        .eq('product_id', productId);
      return !error;
    }
    const { error } = await client.from('vm_role_products').upsert({
      role_id: roleId,
      product_id: productId,
      is_birthright: true,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function listEmployees(
  entityId?: string | null,
): Promise<VmEmployee[]> {
  try {
    const client = await sb();
    let q = client
      .from('vm_employees')
      .select('*')
      .is('archived_at', null)
      .order('name');
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmEmployee[];
  } catch {
    return [];
  }
}

export async function upsertEmployee(
  row: Partial<VmEmployee> & { id: string; name: string; entity_id: string },
): Promise<VmEmployee | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_employees')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmEmployee;
  } catch {
    return null;
  }
}

export async function listEntitlements(
  empId?: string | null,
): Promise<VmEntitlement[]> {
  try {
    const client = await sb();
    let q = client.from('vm_entitlements').select('*');
    if (empId) q = q.eq('emp_id', empId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmEntitlement[];
  } catch {
    return [];
  }
}

export async function setEntitlement(
  empId: string,
  productId: string,
  assigned: boolean,
  source: VmEntitlement['source'] = 'exception',
): Promise<boolean> {
  try {
    const client = await sb();
    if (!assigned) {
      const { error } = await client
        .from('vm_entitlements')
        .delete()
        .eq('emp_id', empId)
        .eq('product_id', productId);
      return !error;
    }
    const { error } = await client.from('vm_entitlements').upsert({
      emp_id: empId,
      product_id: productId,
      assigned: true,
      source,
      updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

export async function revokeAllEntitlements(empId: string): Promise<number> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_entitlements')
      .delete()
      .eq('emp_id', empId)
      .select('product_id');
    if (error) return 0;
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}

export async function listAccessRequests(
  entityId?: string | null,
): Promise<VmAccessRequest[]> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_access_requests')
      .select('*, vm_employees!inner(entity_id)')
      .order('request_date', { ascending: false });
    if (error) {
      // fallback without join
      const plain = await client
        .from('vm_access_requests')
        .select('*')
        .order('request_date', { ascending: false });
      if (plain.error) return [];
      return (plain.data ?? []) as VmAccessRequest[];
    }
    const rows = (data ?? []) as Array<
      VmAccessRequest & { vm_employees?: { entity_id: string } }
    >;
    if (!entityId) return rows;
    return rows.filter((r) => r.vm_employees?.entity_id === entityId);
  } catch {
    return [];
  }
}

export async function upsertAccessRequest(
  row: Partial<VmAccessRequest> & {
    id: string;
    emp_id: string;
    product_id: string;
  },
): Promise<VmAccessRequest | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_access_requests')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmAccessRequest;
  } catch {
    return null;
  }
}

export async function listRenewals(
  entityId?: string | null,
): Promise<VmRenewal[]> {
  try {
    const client = await sb();
    let q = client
      .from('vm_renewals')
      .select('*')
      .order('contract_end', { ascending: true });
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmRenewal[];
  } catch {
    return [];
  }
}

export async function upsertRenewal(
  row: Partial<VmRenewal> & {
    id: string;
    vendor_id: string;
    entity_id: string;
    contract_end: string;
  },
): Promise<VmRenewal | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_renewals')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmRenewal;
  } catch {
    return null;
  }
}

export async function listBudgets(
  entityId?: string | null,
): Promise<VmBudget[]> {
  try {
    const client = await sb();
    let q = client.from('vm_budgets').select('*').order('fy', { ascending: false });
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmBudget[];
  } catch {
    return [];
  }
}

export async function upsertBudget(
  row: Partial<VmBudget> & {
    id: string;
    entity_id: string;
    category: string;
    fy: number;
  },
): Promise<VmBudget | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_budgets')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmBudget;
  } catch {
    return null;
  }
}

export async function listCostCenters(
  entityId?: string | null,
): Promise<VmCostCenter[]> {
  try {
    const client = await sb();
    let q = client.from('vm_cost_centers').select('*').order('name');
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmCostCenter[];
  } catch {
    return [];
  }
}

export async function listCompBands(
  entityId?: string | null,
): Promise<VmCompBand[]> {
  try {
    const client = await sb();
    let q = client.from('vm_comp_bands').select('*');
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmCompBand[];
  } catch {
    return [];
  }
}

export async function listLifecycleTemplates(): Promise<VmLifecycleTemplate[]> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_lifecycle_templates')
      .select('*')
      .order('sort_order');
    if (error) return [];
    return (data ?? []) as VmLifecycleTemplate[];
  } catch {
    return [];
  }
}

export async function listLifecycleCases(
  entityId?: string | null,
): Promise<VmLifecycleCase[]> {
  try {
    const client = await sb();
    let q = client
      .from('vm_lifecycle_cases')
      .select('*')
      .order('start_date', { ascending: false });
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as VmLifecycleCase[];
  } catch {
    return [];
  }
}

export async function createLifecycleCase(input: {
  id: string;
  emp_id: string;
  event: VmLifecycleCase['event'];
  role_id?: string | null;
  entity_id: string;
  notes?: string | null;
}): Promise<VmLifecycleCase | null> {
  try {
    const client = await sb();
    const templates = await listLifecycleTemplates();
    const forEvent = templates.filter((t) => t.event === input.event);
    const { data, error } = await client
      .from('vm_lifecycle_cases')
      .insert({
        id: input.id,
        emp_id: input.emp_id,
        event: input.event,
        role_id: input.role_id ?? null,
        entity_id: input.entity_id,
        status: 'In Progress',
        notes: input.notes ?? null,
      })
      .select('*')
      .maybeSingle();
    if (error || !data) return null;
    if (forEvent.length) {
      await client.from('vm_lifecycle_case_tasks').insert(
        forEvent.map((t) => ({
          case_id: input.id,
          template_id: t.id,
          task: t.task,
          owner_role: t.owner_role,
          sla_hours: t.sla_hours,
          sort_order: t.sort_order,
          done: false,
        })),
      );
    }
    return data as VmLifecycleCase;
  } catch {
    return null;
  }
}

export async function listUsageSignals(): Promise<VmUsageSignal[]> {
  try {
    const client = await sb();
    const { data, error } = await client.from('vm_usage_signals').select('*');
    if (error) return [];
    return (data ?? []) as VmUsageSignal[];
  } catch {
    return [];
  }
}

export async function listChargebackRules(): Promise<VmChargebackRule[]> {
  try {
    const client = await sb();
    const { data, error } = await client.from('vm_chargeback_rules').select('*');
    if (error) return [];
    return (data ?? []) as VmChargebackRule[];
  } catch {
    return [];
  }
}

export async function upsertChargebackRule(
  row: VmChargebackRule,
): Promise<VmChargebackRule | null> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_chargeback_rules')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) return null;
    return data as VmChargebackRule;
  } catch {
    return null;
  }
}

export async function listRevenueInputs(): Promise<VmRevenueInput[]> {
  try {
    const client = await sb();
    const { data, error } = await client.from('vm_revenue_inputs').select('*');
    if (error) return [];
    return (data ?? []) as VmRevenueInput[];
  } catch {
    return [];
  }
}

export async function upsertRevenueInput(
  entityId: string,
  ttmRevenue: number,
): Promise<boolean> {
  try {
    const client = await sb();
    const { error } = await client.from('vm_revenue_inputs').upsert({
      entity_id: entityId,
      ttm_revenue: ttmRevenue,
      updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

export async function listAlertRules(): Promise<VmAlertRule[]> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_alert_rules')
      .select('*')
      .order('id');
    if (error) return [];
    return (data ?? []) as VmAlertRule[];
  } catch {
    return [];
  }
}

export async function listAlertEvents(limit = 50): Promise<VmAlertEvent[]> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_alert_events')
      .select('*')
      .order('triggered_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []) as VmAlertEvent[];
  } catch {
    return [];
  }
}

export async function listIntegrations(): Promise<VmIntegration[]> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_integrations')
      .select('*')
      .order('system_name');
    if (error) return [];
    return (data ?? []) as VmIntegration[];
  } catch {
    return [];
  }
}

export async function listAdminUsers(): Promise<VmAdminUser[]> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_admin_users')
      .select('*')
      .order('display_name');
    if (error) return [];
    return (data ?? []) as VmAdminUser[];
  } catch {
    return [];
  }
}

export async function deactivateAdminByEmpId(empId: string): Promise<number> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_admin_users')
      .update({
        status: 'Inactive',
        updated_at: new Date().toISOString(),
      })
      .eq('emp_id', empId)
      .eq('status', 'Active')
      .select('id');
    if (error) return 0;
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}

export async function listAuditEvents(limit = 100): Promise<VmAuditEvent[]> {
  try {
    const client = await sb();
    const { data, error } = await client
      .from('vm_audit_events')
      .select('*')
      .order('ts_utc', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []) as VmAuditEvent[];
  } catch {
    return [];
  }
}

export async function appendAuditEvent(input: {
  actor_admin_id?: string | null;
  actor_email?: string | null;
  action: string;
  entity_id?: string | null;
  object_type: string;
  object_id?: string | null;
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
}): Promise<void> {
  try {
    const client = await sb();
    await client.from('vm_audit_events').insert({
      actor_admin_id: input.actor_admin_id ?? null,
      actor_email: input.actor_email ?? null,
      action: input.action,
      entity_id: input.entity_id ?? null,
      object_type: input.object_type,
      object_id: input.object_id ?? null,
      field: input.field ?? null,
      old_value: input.old_value ?? null,
      new_value: input.new_value ?? null,
    });
  } catch {
    // fail-soft
  }
}

export async function ensureVmEntityEnablement(
  entityId: string,
  code: string,
): Promise<boolean> {
  try {
    const client = await sb();
    const { error } = await client.from('vm_entity_module_enablement').upsert({
      entity_id: entityId,
      enabled: true,
      code,
      provisioned_at: new Date().toISOString(),
      meta: { spine: 'vendor-mgmt-v1' },
    });
    return !error;
  } catch {
    return false;
  }
}
