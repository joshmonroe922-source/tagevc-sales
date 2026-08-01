/**
 * Read models: spend rollups, CPE, RPE, chargeback, hire sim, dashboard KPIs.
 */

import {
  chargebackPctValid,
  enrichVendor,
  fullyLoadedMonthly,
  hireCostTimeline,
} from '@/lib/vendor-mgmt/math';
import {
  listAlertEvents,
  listAlertRules,
  listBudgets,
  listChargebackRules,
  listEmployees,
  listEntitlements,
  listProducts,
  listRenewals,
  listRevenueInputs,
  listRoleProducts,
  listRoles,
  listUsageSignals,
  listVendors,
  getVmSettings,
  listFxRates,
  listAccessRequests,
  listLifecycleCases,
  listAdminUsers,
  listVmEntityCodes,
  listCompBands,
} from '@/lib/vendor-mgmt/repo';
import { VM_CORE_ENTITY_IDS, vmEntityLabel } from '@/lib/vendor-mgmt/entities';
import type { VmSettings, VmVendorComputed } from '@/lib/vendor-mgmt/types';

export type SpendByEntity = {
  entity_id: string;
  label: string;
  monthly: number;
  annual: number;
  waste_monthly: number;
  vendor_count: number;
};

export async function buildSpendSummary(entityId?: string | null): Promise<{
  vendors: VmVendorComputed[];
  byEntity: SpendByEntity[];
  monthlyTotal: number;
  annualTotal: number;
  wasteTotal: number;
  byCategory: Array<{ category: string; monthly: number }>;
  byPricing: Array<{ model: string; monthly: number; count: number }>;
}> {
  const [raw, settings, fx] = await Promise.all([
    listVendors(entityId),
    getVmSettings(),
    listFxRates(),
  ]);
  const asOf = settings?.as_of_date ?? new Date().toISOString().slice(0, 10);
  const fxMap = new Map(fx.map((r) => [r.currency, Number(r.rate_to_usd)]));
  const vendors = raw
    .filter((v) => v.status === 'Active')
    .map((v) =>
      enrichVendor(v, { asOf, rateToUsd: fxMap.get(v.currency) ?? 1 }),
    );

  const entityIds = entityId ? [entityId] : [...VM_CORE_ENTITY_IDS];
  const byEntity: SpendByEntity[] = entityIds.map((eid) => {
    const rows = vendors.filter((v) => v.entity_id === eid);
    const monthly = rows.reduce((s, v) => s + v.monthly_usd, 0);
    return {
      entity_id: eid,
      label: vmEntityLabel(eid),
      monthly,
      annual: monthly * 12,
      waste_monthly: rows.reduce((s, v) => s + v.waste_monthly, 0),
      vendor_count: rows.length,
    };
  });

  const catMap = new Map<string, number>();
  const priceMap = new Map<string, { monthly: number; count: number }>();
  for (const v of vendors) {
    const cat = v.category || 'Uncategorized';
    catMap.set(cat, (catMap.get(cat) ?? 0) + v.monthly_usd);
    const pm = v.pricing_model;
    const cur = priceMap.get(pm) ?? { monthly: 0, count: 0 };
    cur.monthly += v.monthly_usd;
    cur.count += 1;
    priceMap.set(pm, cur);
  }

  const monthlyTotal = vendors.reduce((s, v) => s + v.monthly_usd, 0);
  return {
    vendors,
    byEntity,
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    wasteTotal: vendors.reduce((s, v) => s + v.waste_monthly, 0),
    byCategory: [...catMap.entries()]
      .map(([category, monthly]) => ({ category, monthly }))
      .sort((a, b) => b.monthly - a.monthly),
    byPricing: [...priceMap.entries()].map(([model, v]) => ({
      model,
      monthly: v.monthly,
      count: v.count,
    })),
  };
}

export async function buildBudgetVsActual(entityId?: string | null) {
  const [budgets, spend] = await Promise.all([
    listBudgets(entityId),
    buildSpendSummary(entityId),
  ]);
  const actualByKey = new Map<string, number>();
  for (const v of spend.vendors) {
    const key = `${v.entity_id}::${v.category || 'Uncategorized'}`;
    actualByKey.set(key, (actualByKey.get(key) ?? 0) + v.annual_usd);
  }
  return budgets.map((b) => {
    const actual =
      actualByKey.get(`${b.entity_id}::${b.category}`) ?? 0;
    const variance = b.annual_budget - actual;
    return {
      ...b,
      actual_annual: actual,
      variance,
      variance_pct: b.annual_budget
        ? variance / b.annual_budget
        : null,
      over_budget: variance < 0,
    };
  });
}

export async function buildCpeReport(entityId?: string | null) {
  const [employees, entitlements, products, settings] = await Promise.all([
    listEmployees(entityId),
    listEntitlements(),
    listProducts(),
    getVmSettings(),
  ]);
  const s =
    settings ??
    ({
      burden_pct: 0.28,
      benefits_monthly: 450,
      facilities_monthly: 200,
      mgmt_overhead_pct: 0.08,
    } as VmSettings);

  const productCost = new Map(products.map((p) => [p.id, Number(p.cost_seat_mo)]));
  const techByEmp = new Map<string, number>();
  for (const e of entitlements) {
    if (!e.assigned) continue;
    techByEmp.set(
      e.emp_id,
      (techByEmp.get(e.emp_id) ?? 0) + (productCost.get(e.product_id) ?? 0),
    );
  }

  const active = employees.filter((e) => e.status === 'Active');
  const rows = active.map((emp) => {
    const tech = techByEmp.get(emp.id) ?? 0;
    const fl = fullyLoadedMonthly({
      baseAnnual: Number(emp.base_salary_annual),
      commissionAnnual: Number(emp.commission_target_annual),
      fte: Number(emp.fte),
      techLicMonthly: tech,
      settings: s,
    });
    return {
      emp_id: emp.id,
      name: emp.name,
      entity_id: emp.entity_id,
      role_id: emp.role_id,
      tech_lic_mo: tech,
      fully_loaded_mo: fl,
      fully_loaded_yr: fl * 12,
    };
  });

  const byEntity = VM_CORE_ENTITY_IDS.filter(
    (eid) => !entityId || eid === entityId,
  ).map((eid) => {
    const er = rows.filter((r) => r.entity_id === eid);
    const hc = er.length;
    const avgMo =
      hc === 0 ? 0 : er.reduce((s, r) => s + r.fully_loaded_mo, 0) / hc;
    return {
      entity_id: eid,
      label: vmEntityLabel(eid),
      hc,
      avg_cpe_mo: avgMo,
      avg_cpe_yr: avgMo * 12,
    };
  });

  return { rows, byEntity, settings: s };
}

export async function buildRpeReport() {
  const [revenue, cpe, spend] = await Promise.all([
    listRevenueInputs(),
    buildCpeReport(),
    buildSpendSummary(),
  ]);
  const revMap = new Map(revenue.map((r) => [r.entity_id, Number(r.ttm_revenue)]));
  const entityRows = cpe.byEntity.map((e) => {
    const ttm = revMap.get(e.entity_id) ?? 0;
    const rpe = e.hc > 0 ? ttm / e.hc : 0;
    const ratio = e.avg_cpe_yr > 0 ? rpe / e.avg_cpe_yr : 0;
    return {
      ...e,
      ttm_revenue: ttm,
      rpe,
      rpe_cpe_ratio: ratio,
      spread: rpe - e.avg_cpe_yr,
    };
  });
  const groupHc = entityRows.reduce((s, e) => s + e.hc, 0);
  const groupRev = entityRows.reduce((s, e) => s + e.ttm_revenue, 0);
  return {
    entities: entityRows,
    group: {
      hc: groupHc,
      revenue: groupRev,
      rpe: groupHc > 0 ? groupRev / groupHc : 0,
      tech_pct_of_rev:
        groupRev > 0 ? spend.annualTotal / groupRev : 0,
      tech_per_emp_yr: groupHc > 0 ? spend.annualTotal / groupHc : 0,
    },
  };
}

export async function buildChargebackAllocations() {
  const [rules, vendors, employees] = await Promise.all([
    listChargebackRules(),
    listVendorsComputedAll(),
    listEmployees(),
  ]);
  const hc = {
    'ENT-FIRM': employees.filter(
      (e) => e.entity_id === 'ENT-FIRM' && e.status === 'Active',
    ).length,
    'ENT-R619': employees.filter(
      (e) => e.entity_id === 'ENT-R619' && e.status === 'Active',
    ).length,
    'ENT-SIGNENT': employees.filter(
      (e) => e.entity_id === 'ENT-SIGNENT' && e.status === 'Active',
    ).length,
    'ENT-INDA': employees.filter(
      (e) => e.entity_id === 'ENT-INDA' && e.status === 'Active',
    ).length,
  };
  const totalHc =
    hc['ENT-FIRM'] + hc['ENT-R619'] + hc['ENT-SIGNENT'] + hc['ENT-INDA'] || 1;

  return rules.map((rule) => {
    const vendor = vendors.find((v) => v.id === rule.vendor_id);
    const monthly = vendor?.monthly_usd ?? 0;
    const valid = chargebackPctValid(rule);
    let weights = {
      tage: Number(rule.pct_tage),
      r619: Number(rule.pct_r619),
      shr: Number(rule.pct_shr),
      inda: Number(rule.pct_inda),
    };
    if (rule.method === 'Seats') {
      weights = {
        tage: hc['ENT-FIRM'] / totalHc,
        r619: hc['ENT-R619'] / totalHc,
        shr: hc['ENT-SIGNENT'] / totalHc,
        inda: hc['ENT-INDA'] / totalHc,
      };
    }
    return {
      rule,
      vendor_name: vendor?.name ?? rule.vendor_id,
      monthly,
      valid,
      alloc: {
        TAGE: monthly * weights.tage,
        R619: monthly * weights.r619,
        SHR: monthly * weights.shr,
        INDA: monthly * weights.inda,
      },
    };
  });
}

async function listVendorsComputedAll() {
  const [raw, settings, fx] = await Promise.all([
    listVendors(),
    getVmSettings(),
    listFxRates(),
  ]);
  const asOf = settings?.as_of_date ?? new Date().toISOString().slice(0, 10);
  const fxMap = new Map(fx.map((r) => [r.currency, Number(r.rate_to_usd)]));
  return raw.map((v) =>
    enrichVendor(v, { asOf, rateToUsd: fxMap.get(v.currency) ?? 1 }),
  );
}

export async function simulateHire(input: {
  roleId: string;
  baseAnnual: number;
  commissionAnnual?: number;
  fte?: number;
  techOverride?: number | null;
}) {
  const [roles, roleProducts, products, settings, bands] = await Promise.all([
    listRoles(),
    listRoleProducts(input.roleId),
    listProducts(),
    getVmSettings(),
    listCompBands(),
  ]);
  const role = roles.find((r) => r.id === input.roleId);
  const productCost = new Map(products.map((p) => [p.id, Number(p.cost_seat_mo)]));
  const techFromRole = roleProducts
    .filter((r) => r.is_birthright)
    .reduce((s, r) => s + (productCost.get(r.product_id) ?? 0), 0);
  const tech =
    input.techOverride != null && input.techOverride !== undefined
      ? Number(input.techOverride)
      : techFromRole;
  const s = settings!;
  const timeline = hireCostTimeline({
    baseAnnual: input.baseAnnual,
    commissionAnnual: input.commissionAnnual ?? 0,
    fte: input.fte ?? 1,
    techLicMonthly: tech,
    settings: s,
  });
  const band = bands.find((b) => b.role_id === input.roleId);
  const aboveBand =
    band?.base_max != null ? input.baseAnnual > Number(band.base_max) : false;
  return {
    role,
    tech_lic_mo: tech,
    timeline,
    band,
    above_band: aboveBand,
    settings: s,
  };
}

export async function buildDashboard(entityId?: string | null) {
  const [
    spend,
    employees,
    renewals,
    budgets,
    access,
    lifecycle,
    alerts,
    alertRules,
    admins,
    usage,
    entities,
  ] = await Promise.all([
    buildSpendSummary(entityId),
    listEmployees(entityId),
    listRenewals(entityId),
    buildBudgetVsActual(entityId),
    listAccessRequests(entityId),
    listLifecycleCases(entityId),
    listAlertEvents(20),
    listAlertRules(),
    listAdminUsers(),
    listUsageSignals(),
    listVmEntityCodes(),
  ]);

  const activeHc = employees.filter((e) => e.status === 'Active').length;
  const openRenewals = renewals.filter(
    (r) => !['Approved', 'Rejected'].includes(r.status),
  );
  const inWindow = spend.vendors.filter(
    (v) =>
      v.days_to_end != null && v.days_to_end <= 90 && v.status === 'Active',
  );
  const pendingAccess = access.filter((a) => a.status === 'Pending');
  const openCases = lifecycle.filter((c) => c.status !== 'Complete');
  const reclaim = usage.filter((u) => {
    if (!u.last_active || !u.assigned) return false;
    const days = Math.round(
      (Date.now() - new Date(`${u.last_active}T00:00:00Z`).getTime()) /
        86_400_000,
    );
    return days >= u.threshold_days;
  });

  return {
    entities,
    kpis: {
      monthly_tech: spend.monthlyTotal,
      annual_tech: spend.annualTotal,
      active_hc: activeHc,
      waste_monthly: spend.wasteTotal,
      open_renewals: openRenewals.length,
      in_renewal_window: inWindow.length,
      budget_overruns: budgets.filter((b) => b.over_budget).length,
      pending_access: pendingAccess.length,
      open_lifecycle: openCases.length,
      reclaim_candidates: reclaim.length,
      active_admins: admins.filter((a) => a.status === 'Active').length,
      active_alerts: alerts.filter((a) => !a.acknowledged_at).length,
      alert_rules_enabled: alertRules.filter((r) => r.enabled).length,
    },
    spend,
    renewals: openRenewals.slice(0, 10),
    alerts: alerts.slice(0, 10),
    budgets: budgets.filter((b) => b.over_budget).slice(0, 8),
  };
}
