/**
 * Subsidiary completion-package intake for SSC (Tage only).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { companyName, resolveScopeEntityIds } from './scope';
import { collectSubsidiarySyncHooks } from './sync-hooks';
import type { SscSyncSnapshot } from './types';

export type CompletionPackage = {
  entity_id: string;
  company_name: string;
  package_key: string;
  period_key: string;
  status: 'ok' | 'partial' | 'missing' | 'stale' | 'error';
  freshness_at: string | null;
  captured_at: string;
  highlights: string[];
  metrics: Record<string, number | string | null>;
  stale: boolean;
};

const STALE_HOURS = 36;

function isStale(freshnessAt: string | null, capturedAt: string): boolean {
  const ref = freshnessAt ?? capturedAt;
  const ageMs = Date.now() - new Date(ref).getTime();
  return ageMs > STALE_HOURS * 3600 * 1000;
}

export async function captureCompletionPackages(opts?: {
  entityIds?: string[];
  period_key?: string;
}): Promise<{ packages: CompletionPackage[]; written: number }> {
  const entityIds =
    opts?.entityIds ?? resolveScopeEntityIds('parent_subs');
  const period_key = opts?.period_key ?? 'current';
  const sync = await collectSubsidiarySyncHooks({ entityIds });
  const packages: CompletionPackage[] = [];
  let written = 0;

  // Enrich with deeper package keys
  const supabase = await createPersistClient();

  for (const entityId of entityIds) {
    const entitySync = sync.filter((s) => s.entity_id === entityId);
    for (const s of entitySync) {
      const pkg = await upsertPackage({
        entity_id: entityId,
        package_key: s.source_key,
        period_key,
        status: s.status === 'ok' ? 'ok' : s.status === 'error' ? 'error' : 'partial',
        freshness_at: s.captured_at,
        highlights: s.highlights,
        metrics: {},
      });
      if (pkg) {
        packages.push(pkg);
        written += 1;
      }
    }

    // Dedicated SSC completion packages
    if (entityId === 'ENT-R619') {
      const rollup = await latestPayload(
        supabase,
        'os_subsidiary_rollup_phase53_snapshots',
      );
      const pkg = await upsertPackage({
        entity_id: entityId,
        package_key: 'recruit_ssc_completion',
        period_key,
        status: rollup ? 'ok' : 'partial',
        freshness_at: rollup?.captured_at ?? null,
        highlights: rollup
          ? ['Recruit rollup available for SSC completion']
          : ['Recruit rollup missing — use ticket/roster signals'],
        metrics: rollup?.metrics ?? {},
      });
      if (pkg) {
        packages.push(pkg);
        written += 1;
      }
    }

    if (entityId === 'ENT-INDA') {
      const snap = await latestPayload(
        supabase,
        'inda_saas_kpi_snapshots',
        'ENT-INDA',
      );
      const goals = await countRows(supabase, 'inda_kpi_goals', 'ENT-INDA');
      const pkg = await upsertPackage({
        entity_id: entityId,
        package_key: 'inda_ssc_completion',
        period_key,
        status: snap ? 'ok' : goals != null && goals > 0 ? 'partial' : 'missing',
        freshness_at: snap?.captured_at ?? null,
        highlights: [
          snap
            ? 'Instant NDA SaaS KPI snapshot available'
            : 'No SaaS KPI snapshot yet',
          goals != null ? `${goals} KPI goal row(s)` : 'KPI goals unavailable',
        ],
        metrics: {
          saas_snapshot: snap ? 1 : 0,
          kpi_goals: goals,
        },
      });
      if (pkg) {
        packages.push(pkg);
        written += 1;
      }
    }
  }

  return { packages, written };
}

async function countRows(
  supabase: Awaited<ReturnType<typeof createPersistClient>>,
  table: string,
  entityId?: string,
): Promise<number | null> {
  try {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (entityId) q = q.eq('entity_id', entityId);
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function latestPayload(
  supabase: Awaited<ReturnType<typeof createPersistClient>>,
  table: string,
  entityId?: string,
): Promise<{
  captured_at: string;
  metrics: Record<string, number | string | null>;
} | null> {
  try {
    let q = supabase.from(table).select('*').limit(1);
    if (entityId) q = q.eq('entity_id', entityId);
    const { data, error } = await q.order('captured_at', {
      ascending: false,
    });
    if (error || !data?.[0]) {
      // try created_at
      let q2 = supabase.from(table).select('*').limit(1);
      if (entityId) q2 = q2.eq('entity_id', entityId);
      const { data: d2 } = await q2.order('created_at', { ascending: false });
      if (!d2?.[0]) return null;
      const row = d2[0] as Record<string, unknown>;
      return {
        captured_at: String(row.created_at ?? new Date().toISOString()),
        metrics: {},
      };
    }
    const row = data[0] as Record<string, unknown>;
    return {
      captured_at: String(row.captured_at ?? row.created_at ?? new Date().toISOString()),
      metrics: {},
    };
  } catch {
    return null;
  }
}

async function upsertPackage(input: {
  entity_id: string;
  package_key: string;
  period_key: string;
  status: CompletionPackage['status'];
  freshness_at: string | null;
  highlights: string[];
  metrics: Record<string, number | string | null>;
}): Promise<CompletionPackage | null> {
  const captured_at = new Date().toISOString();
  let status = input.status;
  if (
    status === 'ok' &&
    isStale(input.freshness_at, captured_at)
  ) {
    status = 'stale';
  }
  const pkg: CompletionPackage = {
    entity_id: input.entity_id,
    company_name: companyName(input.entity_id),
    package_key: input.package_key,
    period_key: input.period_key,
    status,
    freshness_at: input.freshness_at,
    captured_at,
    highlights: input.highlights,
    metrics: input.metrics,
    stale: status === 'stale',
  };

  try {
    const supabase = await createPersistClient();
    const { data: existing } = await supabase
      .from('os_ssc_completion_packages')
      .select('id')
      .eq('entity_id', input.entity_id)
      .eq('package_key', input.package_key)
      .eq('period_key', input.period_key)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from('os_ssc_completion_packages')
        .update({
          status,
          freshness_at: input.freshness_at,
          captured_at,
          highlights: input.highlights,
          metrics: input.metrics,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('os_ssc_completion_packages').insert({
        entity_id: input.entity_id,
        package_key: input.package_key,
        period_key: input.period_key,
        status,
        freshness_at: input.freshness_at,
        captured_at,
        highlights: input.highlights,
        metrics: input.metrics,
      });
    }
  } catch {
    // still return in-memory package
  }

  return pkg;
}

export async function listCompletionPackages(opts?: {
  entityIds?: string[];
}): Promise<CompletionPackage[]> {
  try {
    const supabase = await createPersistClient();
    let q = supabase
      .from('os_ssc_completion_packages')
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(80);
    if (opts?.entityIds?.length) {
      q = q.in('entity_id', opts.entityIds);
    }
    const { data } = await q;
    return (data ?? []).map((row) => {
      const freshness = (row.freshness_at as string) ?? null;
      const captured = String(row.captured_at);
      const status = row.status as CompletionPackage['status'];
      return {
        entity_id: String(row.entity_id),
        company_name: companyName(row.entity_id as string),
        package_key: String(row.package_key),
        period_key: String(row.period_key),
        status,
        freshness_at: freshness,
        captured_at: captured,
        highlights: Array.isArray(row.highlights)
          ? (row.highlights as string[])
          : [],
        metrics: (row.metrics as Record<string, number | string | null>) ?? {},
        stale: status === 'stale' || isStale(freshness, captured),
      };
    });
  } catch {
    return [];
  }
}

/** Mark open checklist tasks with completion-package freshness in meta/evidence. */
export async function stampEvidenceFreshnessFromPackages(
  packages: CompletionPackage[],
): Promise<number> {
  let n = 0;
  try {
    const supabase = await createPersistClient();
    for (const pkg of packages) {
      if (pkg.status === 'missing' || pkg.status === 'error') continue;
      const stamp = [
        `Completion package [${pkg.package_key}] ${pkg.status}`,
        pkg.freshness_at
          ? `freshness ${pkg.freshness_at.slice(0, 19)}`
          : 'freshness unknown',
        ...pkg.highlights.slice(0, 3),
      ].join(' · ');
      const { data: tasks } = await supabase
        .from('os_ssc_checklist_tasks')
        .select('id, evidence_note, meta')
        .eq('entity_id', pkg.entity_id)
        .in('status', ['not_started', 'in_progress'])
        .limit(8);
      for (const t of tasks ?? []) {
        const meta = {
          ...((t.meta as Record<string, unknown>) ?? {}),
          completion_package: pkg.package_key,
          evidence_freshness_at: pkg.freshness_at,
          package_status: pkg.status,
        };
        const note = t.evidence_note
          ? String(t.evidence_note)
          : `Auto-evidence from ${pkg.company_name}: ${stamp}`;
        await supabase
          .from('os_ssc_checklist_tasks')
          .update({
            meta,
            evidence_note: note.includes(pkg.package_key)
              ? note
              : `${note}\n• [${pkg.package_key}] ${stamp}`,
            automation_source: 'ai_assisted',
            updated_at: new Date().toISOString(),
          })
          .eq('id', t.id);
        n += 1;
      }
    }
  } catch {
    // fail-soft
  }
  return n;
}

export type { SscSyncSnapshot };
