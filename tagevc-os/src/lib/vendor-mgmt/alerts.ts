/**
 * Evaluate workbook Alert_Rules against live spine signals.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { daysToEnd, enrichVendor } from '@/lib/vendor-mgmt/math';
import { buildBudgetVsActual, buildSpendSummary } from '@/lib/vendor-mgmt/metrics';
import {
  getVmSettings,
  listAccessRequests,
  listAdminUsers,
  listAlertRules,
  listFxRates,
  listIntegrations,
  listLifecycleCases,
  listRenewals,
  listUsageSignals,
  listVendors,
} from '@/lib/vendor-mgmt/repo';

async function listVendorProfilesAll() {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.from('vm_vendor_profiles').select('*');
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

export type EvaluatedAlert = {
  rule_id: string;
  name: string;
  severity: string;
  triggered: boolean;
  message: string;
  entity_id?: string | null;
  object_type?: string;
  object_id?: string;
};

export async function evaluateAlertRules(): Promise<EvaluatedAlert[]> {
  const [
    rules,
    settings,
    vendorsRaw,
    fx,
    renewals,
    budgets,
    spend,
    usage,
    access,
    integrations,
    lifecycle,
    admins,
    profiles,
  ] = await Promise.all([
    listAlertRules(),
    getVmSettings(),
    listVendors(),
    listFxRates(),
    listRenewals(),
    buildBudgetVsActual(),
    buildSpendSummary(),
    listUsageSignals(),
    listAccessRequests(),
    listIntegrations(),
    listLifecycleCases(),
    listAdminUsers(),
    listVendorProfilesAll(),
  ]);

  const asOf = settings?.as_of_date ?? new Date().toISOString().slice(0, 10);
  const fxMap = new Map(fx.map((r) => [r.currency, Number(r.rate_to_usd)]));
  const vendors = vendorsRaw
    .filter((v) => v.status === 'Active' && !v.archived_at)
    .map((v) =>
      enrichVendor(v, { asOf, rateToUsd: fxMap.get(v.currency) ?? 1 }),
    );

  const out: EvaluatedAlert[] = [];
  const enabled = rules.filter((r) => r.enabled);

  for (const rule of enabled) {
    if (rule.id === 'AL-01') {
      const hits = vendors.filter(
        (v) =>
          v.days_to_end != null &&
          v.days_to_end <= 90 &&
          v.days_to_end > 30 &&
          !renewals.some(
            (r) => r.vendor_id === v.id && r.status === 'Approved',
          ),
      );
      for (const v of hits) {
        out.push({
          rule_id: rule.id,
          name: rule.name,
          severity: rule.severity,
          triggered: true,
          message: `${v.name} renews in ${v.days_to_end} days`,
          entity_id: v.entity_id,
          object_type: 'vendor',
          object_id: v.id,
        });
      }
    }

    if (rule.id === 'AL-02') {
      const hits = vendors.filter(
        (v) =>
          v.days_to_end != null &&
          v.days_to_end <= 30 &&
          v.days_to_end >= 0 &&
          !renewals.some(
            (r) => r.vendor_id === v.id && r.status === 'Approved',
          ),
      );
      for (const v of hits) {
        out.push({
          rule_id: rule.id,
          name: rule.name,
          severity: rule.severity,
          triggered: true,
          message: `${v.name} within 30 days of contract end`,
          entity_id: v.entity_id,
          object_type: 'vendor',
          object_id: v.id,
        });
      }
    }

    if (rule.id === 'AL-03') {
      for (const v of vendors.filter((x) => x.renewal_stage === 'EXPIRED')) {
        out.push({
          rule_id: rule.id,
          name: rule.name,
          severity: rule.severity,
          triggered: true,
          message: `${v.name} contract expired`,
          entity_id: v.entity_id,
          object_type: 'vendor',
          object_id: v.id,
        });
      }
    }

    if (rule.id === 'AL-04') {
      for (const b of budgets.filter((x) => x.over_budget)) {
        out.push({
          rule_id: rule.id,
          name: rule.name,
          severity: rule.severity,
          triggered: true,
          message: `${b.category} FY${b.fy} over budget by $${Math.abs(b.variance).toFixed(0)}`,
          entity_id: b.entity_id,
          object_type: 'budget',
          object_id: b.id,
        });
      }
    }

    if (rule.id === 'AL-05') {
      const threshold = Number(rule.threshold ?? 500);
      if (spend.wasteTotal > threshold) {
        out.push({
          rule_id: rule.id,
          name: rule.name,
          severity: rule.severity,
          triggered: true,
          message: `License waste $${spend.wasteTotal.toFixed(0)}/mo exceeds $${threshold}`,
        });
      }
    }

    if (rule.id === 'AL-06') {
      const reclaim = usage.filter((u) => {
        if (!u.assigned || !u.last_active) return false;
        const d = daysToEnd(u.last_active, asOf);
        const inactive = d == null ? 0 : -d;
        return inactive >= u.threshold_days;
      });
      if (reclaim.length > 0) {
        out.push({
          rule_id: rule.id,
          name: rule.name,
          severity: rule.severity,
          triggered: true,
          message: `${reclaim.length} reclaim candidate(s)`,
        });
      }
    }

    if (rule.id === 'AL-07') {
      const threshold = Number(rule.threshold ?? 3);
      const stale = access.filter((a) => {
        if (a.status !== 'Pending') return false;
        const age = daysToEnd(a.request_date, asOf);
        return age != null && -age > threshold;
      });
      if (stale.length > 0) {
        out.push({
          rule_id: rule.id,
          name: rule.name,
          severity: rule.severity,
          triggered: true,
          message: `${stale.length} access request(s) aging > ${threshold}d`,
        });
      }
    }

    if (rule.id === 'AL-08') {
      const scopes = new Set(
        admins
          .filter((a) => a.status === 'Active')
          .flatMap((a) =>
            a.entity_scope === 'ALL'
              ? ['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA']
              : [a.entity_scope],
          ),
      );
      for (const eid of [
        'ENT-FIRM',
        'ENT-R619',
        'ENT-SIGNENT',
        'ENT-INDA',
      ]) {
        if (!scopes.has(eid)) {
          out.push({
            rule_id: rule.id,
            name: rule.name,
            severity: rule.severity,
            triggered: true,
            message: `Vendor admin coverage gap for ${eid}`,
            entity_id: eid,
          });
        }
      }
    }

    if (rule.id === 'AL-09') {
      for (const p of profiles as Array<{
        vendor_id: string;
        entity_id: string;
        security_review: string;
        legal_name?: string | null;
      }>) {
        if (p.security_review !== 'Approved') {
          out.push({
            rule_id: rule.id,
            name: rule.name,
            severity: rule.severity,
            triggered: true,
            message: `Security review ${p.security_review} for ${p.legal_name || p.vendor_id}`,
            entity_id: p.entity_id,
            object_type: 'vendor_profile',
            object_id: p.vendor_id,
          });
        }
      }
    }

    if (rule.id === 'AL-10') {
      for (const i of integrations.filter((x) => x.status === 'Error')) {
        out.push({
          rule_id: rule.id,
          name: rule.name,
          severity: rule.severity,
          triggered: true,
          message: `Integration ${i.system_name} in Error`,
          object_type: 'integration',
          object_id: i.id,
        });
      }
    }

    if (rule.id === 'AL-11') {
      const openOff = lifecycle.filter(
        (c) => c.event === 'Offboard' && c.status !== 'Complete',
      );
      if (openOff.length > 0) {
        out.push({
          rule_id: rule.id,
          name: rule.name,
          severity: rule.severity,
          triggered: true,
          message: `${openOff.length} open offboard case(s) — review SLA`,
        });
      }
    }
  }

  return out;
}

export async function persistTriggeredAlerts(
  evaluated: EvaluatedAlert[],
): Promise<number> {
  const triggered = evaluated.filter((e) => e.triggered);
  if (!triggered.length) return 0;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('vm_alert_events')
      .insert(
        triggered.map((e) => ({
          rule_id: e.rule_id,
          entity_id: e.entity_id ?? null,
          object_type: e.object_type ?? null,
          object_id: e.object_id ?? null,
          message: e.message,
          severity: e.severity,
        })),
      )
      .select('id');
    if (error) return 0;
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}
