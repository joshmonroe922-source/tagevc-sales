/**
 * Richer auto-evidence drafts from live Tage signals (draft only).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import type { SscFunction } from './types';

export type EvidenceHint = {
  source: string;
  note: string;
  href?: string;
  freshness_at?: string | null;
};

async function countFiltered(
  table: string,
  filters: Array<{ column: string; value: string | string[]; op?: 'eq' | 'in' | 'neq' }>,
): Promise<number | null> {
  try {
    const sb = await createPersistClient();
    let q = sb.from(table).select('*', { count: 'exact', head: true });
    for (const f of filters) {
      if (f.op === 'in' && Array.isArray(f.value)) {
        q = q.in(f.column, f.value);
      } else if (f.op === 'neq') {
        q = q.neq(f.column, f.value as string);
      } else {
        q = q.eq(f.column, f.value as string);
      }
    }
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function latestSample(
  table: string,
  columns: string,
  filters: Array<{ column: string; value: string }>,
  orderCol = 'created_at',
): Promise<Record<string, unknown> | null> {
  try {
    const sb = await createPersistClient();
    let q = sb.from(table).select(columns).limit(1);
    for (const f of filters) q = q.eq(f.column, f.value);
    const { data, error } = await q.order(orderCol, { ascending: false });
    if (error || !data?.[0]) return null;
    return data[0] as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function collectEvidenceHints(input: {
  function_key: SscFunction;
  entity_id: string | null;
}): Promise<EvidenceHint[]> {
  const entityId = input.entity_id ?? 'ENT-FIRM';
  const hints: EvidenceHint[] = [];
  const now = new Date().toISOString();

  try {
    if (input.function_key === 'finance') {
      const openAnomalies = await countFiltered(
        'os_finance_anomaly_phase55_alerts',
        [{ column: 'entity_id', value: entityId }],
      );
      if (openAnomalies != null) {
        hints.push({
          source: 'finance_anomalies',
          note: `${openAnomalies} finance anomaly alert row(s)`,
          href: '/shared-services/finance',
          freshness_at: now,
        });
      }
      const sample = await latestSample(
        'os_finance_anomaly_phase55_alerts',
        'id, created_at, detail',
        [{ column: 'entity_id', value: entityId }],
      );
      if (sample?.created_at) {
        hints.push({
          source: 'finance_anomaly_latest',
          note: `Latest anomaly signal at ${String(sample.created_at).slice(0, 16)}`,
          href: '/shared-services/finance',
          freshness_at: String(sample.created_at),
        });
      }
      const closeEvents = await countFiltered(
        'os_finance_close_checklist_phase55_events',
        [],
      );
      if (closeEvents != null) {
        hints.push({
          source: 'finance_close_events',
          note: `${closeEvents} close checklist event(s) firm-wide`,
          href: '/shared-services/finance',
          freshness_at: now,
        });
      }
    }

    if (input.function_key === 'hr') {
      const profiles = await countFiltered('profiles', [
        { column: 'entity_id', value: entityId },
      ]);
      if (profiles != null) {
        hints.push({
          source: 'hr_roster',
          note: `${profiles} roster/profile row(s)`,
          href: '/shared-services/hr',
          freshness_at: now,
        });
      }
      const onboarding = await countFiltered('os_it_onboarding_runs', [
        { column: 'entity_id', value: entityId },
      ]);
      if (onboarding != null) {
        hints.push({
          source: 'hr_onboarding_runs',
          note: `${onboarding} onboarding run row(s) (lifecycle signal)`,
          href: '/shared-services/hr',
          freshness_at: now,
        });
      }
    }

    if (input.function_key === 'it') {
      const hardware = await countFiltered('os_it_hardware_assets', [
        { column: 'entity_id', value: entityId },
      ]);
      if (hardware != null) {
        hints.push({
          source: 'it_assets',
          note: `${hardware} hardware asset row(s)`,
          href: '/shared-services/it/assets',
          freshness_at: now,
        });
      }
      const offboarding = await countFiltered('os_it_offboarding_runs', [
        { column: 'entity_id', value: entityId },
      ]);
      if (offboarding != null) {
        hints.push({
          source: 'it_offboarding',
          note: `${offboarding} offboarding run row(s)`,
          href: '/shared-services/it/assets',
          freshness_at: now,
        });
      }
      const licenses = await countFiltered('os_it_software_licenses', [
        { column: 'entity_id', value: entityId },
      ]);
      if (licenses != null) {
        hints.push({
          source: 'it_licenses',
          note: `${licenses} software license row(s)`,
          href: '/shared-services/it/assets',
          freshness_at: now,
        });
      }
    }

    if (input.function_key === 'marketing') {
      const campaigns = await countFiltered('os_marketing_campaigns', [
        { column: 'entity_id', value: entityId },
      ]);
      if (campaigns != null) {
        hints.push({
          source: 'campaigns',
          note: `${campaigns} campaign row(s)`,
          href: '/shared-services/marketing',
          freshness_at: now,
        });
      }
      const pending = await countFiltered('os_marketing_content', [
        { column: 'entity_id', value: entityId },
        { column: 'status', value: 'pending_approval' },
      ]);
      if (pending != null) {
        hints.push({
          source: 'publish_approvals',
          note: `${pending} content item(s) pending approval`,
          href: '/shared-services/marketing',
          freshness_at: now,
        });
      }
      const scheduled = await countFiltered('os_marketing_schedule_jobs', [
        { column: 'status', value: 'pending' },
      ]);
      if (scheduled != null) {
        hints.push({
          source: 'schedule_jobs',
          note: `${scheduled} pending schedule job(s) firm-wide`,
          href: '/shared-services/marketing',
          freshness_at: now,
        });
      }
    }

    if (input.function_key === 'legal') {
      const envelopes = await countFiltered('os_docusign_envelopes', []);
      if (envelopes != null) {
        hints.push({
          source: 'docusign_envelopes',
          note: `${envelopes} DocuSign envelope row(s)`,
          href: '/shared-services/legal/docusign',
          freshness_at: now,
        });
      }
      const latest = await latestSample(
        'os_docusign_envelopes',
        'envelope_id, status, updated_at, created_at',
        [],
        'created_at',
      );
      if (latest) {
        hints.push({
          source: 'docusign_latest',
          note: `Latest envelope status: ${String(latest.status ?? 'unknown')}`,
          href: '/shared-services/legal/docusign',
          freshness_at: String(latest.updated_at ?? latest.created_at ?? now),
        });
      }
    }

    const openTickets = await countFiltered('os_tickets', [
      { column: 'entity_id', value: entityId },
      {
        column: 'status',
        value: ['Open', 'In Progress', 'Waiting', 'Escalated'],
        op: 'in',
      },
    ]);
    if (openTickets != null) {
      hints.push({
        source: 'open_tickets',
        note: `${openTickets} open/active ticket(s)`,
        href: '/shared-services',
        freshness_at: now,
      });
    } else {
      const allTickets = await countFiltered('os_tickets', [
        { column: 'entity_id', value: entityId },
      ]);
      if (allTickets != null) {
        hints.push({
          source: 'tickets',
          note: `${allTickets} ticket row(s)`,
          href: '/shared-services',
          freshness_at: now,
        });
      }
    }
  } catch {
    // fail-soft
  }

  return hints;
}

export function formatEvidenceNote(hints: EvidenceHint[]): string {
  if (!hints.length) return '';
  const freshest = hints
    .map((h) => h.freshness_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  return [
    'Auto-evidence (draft — confirm before closing):',
    freshest ? `Freshness: ${String(freshest).slice(0, 19)}` : null,
    ...hints.map(
      (h) =>
        `• [${h.source}] ${h.note}${h.href ? ` → ${h.href}` : ''}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');
}

export function evidenceFreshnessIso(hints: EvidenceHint[]): string | null {
  const times = hints
    .map((h) => h.freshness_at)
    .filter((t): t is string => Boolean(t))
    .sort();
  return times.at(-1) ?? null;
}
