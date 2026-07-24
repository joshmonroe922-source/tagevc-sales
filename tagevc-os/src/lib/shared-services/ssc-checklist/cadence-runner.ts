/**
 * SSC cadence automation runner — generate periods, escalate, sync, trends.
 * Invoked by cron (/api/ssc/cadence-worker) — does not rely on page load.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  ensurePeriodInstances,
  seedAllCompanyAudits,
} from './engine';
import { escalateOverdueSscTasks } from './escalate';
import {
  captureCompletionPackages,
  stampEvidenceFreshnessFromPackages,
} from './completion-packages';
import { writeSscNotifications } from './notify';
import { capturePeriodTrends } from './trends';
import type { SscPeriodType, SscScopeMode } from './types';
import { SSC_PERIOD_TYPES } from './types';

export const SSC_PHASE67_CONTRACT = 'ssc-cadence-automation-phase67-v1' as const;

export type CadenceRunKind = 'full' | 'generate' | 'escalate' | 'sync' | 'trends';

export type CadenceRunResult = {
  ok: boolean;
  contract_version: typeof SSC_PHASE67_CONTRACT;
  run_kind: CadenceRunKind;
  trigger_source: 'cron' | 'manual' | 'hub' | 'api';
  run_id: string | null;
  periods_generated: number;
  escalations_created: number;
  notifications_written: number;
  packages_captured: number;
  trends_written: number;
  evidence_stamped: number;
  detail: Record<string, unknown>;
  money_auto_approve: false;
};

const GENERATE_SCOPES: SscScopeMode[] = [
  'parent',
  'parent_subs',
  'subs',
];

export async function runSscCadenceAutomation(input?: {
  run_kind?: CadenceRunKind;
  trigger_source?: CadenceRunResult['trigger_source'];
  actor_id?: string | null;
}): Promise<CadenceRunResult> {
  const run_kind = input?.run_kind ?? 'full';
  const trigger_source = input?.trigger_source ?? 'cron';
  const result: CadenceRunResult = {
    ok: true,
    contract_version: SSC_PHASE67_CONTRACT,
    run_kind,
    trigger_source,
    run_id: null,
    periods_generated: 0,
    escalations_created: 0,
    notifications_written: 0,
    packages_captured: 0,
    trends_written: 0,
    evidence_stamped: 0,
    detail: {},
    money_auto_approve: false,
  };

  const supabase = await createPersistClient();
  try {
    const { data: runRow } = await supabase
      .from('os_ssc_cadence_runs')
      .insert({
        run_kind,
        trigger_source,
        actor_id: input?.actor_id ?? null,
        started_at: new Date().toISOString(),
      })
      .select('run_id')
      .single();
    result.run_id = (runRow?.run_id as string) ?? null;
  } catch {
    // table may not exist yet — continue
  }

  try {
    if (run_kind === 'full' || run_kind === 'generate') {
      for (const period_type of SSC_PERIOD_TYPES as readonly SscPeriodType[]) {
        for (const scope_mode of GENERATE_SCOPES) {
          const gen = await ensurePeriodInstances({
            function: 'all',
            period_type,
            scope_mode,
            include_next: true,
          });
          result.periods_generated += gen.generated;
        }
      }
      // Single-company coverage for registry companies
      for (const entityId of ['ENT-FIRM', 'ENT-R619', 'ENT-INDA']) {
        for (const period_type of ['monthly', 'weekly', 'quarterly', 'annual'] as SscPeriodType[]) {
          const gen = await ensurePeriodInstances({
            function: 'all',
            period_type,
            scope_mode: 'single',
            single_entity_id: entityId,
            include_next: true,
          });
          result.periods_generated += gen.generated;
        }
      }
      await seedAllCompanyAudits();
      result.detail.audits_seeded = true;
    }

    if (run_kind === 'full' || run_kind === 'escalate') {
      const esc = await escalateOverdueSscTasks({
        actorId: input?.actor_id ?? null,
        limit: 60,
      });
      result.escalations_created = esc.created;
      result.notifications_written = esc.notifications;
      result.detail.escalate = esc;
    }

    if (run_kind === 'full' || run_kind === 'sync') {
      const { packages, written } = await captureCompletionPackages();
      result.packages_captured = written;
      result.evidence_stamped = await stampEvidenceFreshnessFromPackages(
        packages,
      );
      result.detail.package_statuses = packages.map((p) => ({
        entity: p.company_name,
        key: p.package_key,
        status: p.status,
      }));
    }

    if (run_kind === 'full' || run_kind === 'trends') {
      for (const period_type of [
        'weekly',
        'monthly',
        'quarterly',
      ] as SscPeriodType[]) {
        for (const scope_mode of [
          'parent_subs',
          'parent',
          'subs',
        ] as SscScopeMode[]) {
          result.trends_written += await capturePeriodTrends({
            period_type,
            scope_mode,
            history: period_type === 'weekly' ? 8 : 6,
          });
        }
      }
    }
  } catch (e) {
    result.ok = false;
    result.detail.error = e instanceof Error ? e.message : 'cadence failed';
    try {
      await writeSscNotifications({
        entity_id: 'ENT-FIRM',
        alert_kind: 'ssc_cadence_failed',
        severity: 'warning',
        title: 'SSC cadence run failed',
        body: String(result.detail.error),
        href: '/shared-services',
        window_key: `ssc-cadence-fail:${new Date().toISOString().slice(0, 13)}`,
      });
    } catch {
      // ignore
    }
  }

  if (result.run_id) {
    try {
      await supabase
        .from('os_ssc_cadence_runs')
        .update({
          finished_at: new Date().toISOString(),
          ok: result.ok,
          periods_generated: result.periods_generated,
          escalations_created: result.escalations_created,
          notifications_written: result.notifications_written,
          packages_captured: result.packages_captured,
          trends_written: result.trends_written,
          detail: result.detail,
        })
        .eq('run_id', result.run_id);
    } catch {
      // ignore
    }
  }

  return result;
}

export async function getLatestCadenceRun(): Promise<{
  run_id: string;
  run_kind: string;
  trigger_source: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  periods_generated: number;
  escalations_created: number;
  notifications_written: number;
  packages_captured: number;
  trends_written: number;
} | null> {
  try {
    const supabase = await createPersistClient();
    const { data } = await supabase
      .from('os_ssc_cadence_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      run_id: String(data.run_id),
      run_kind: String(data.run_kind),
      trigger_source: String(data.trigger_source),
      started_at: String(data.started_at),
      finished_at: (data.finished_at as string) ?? null,
      ok: Boolean(data.ok),
      periods_generated: Number(data.periods_generated ?? 0),
      escalations_created: Number(data.escalations_created ?? 0),
      notifications_written: Number(data.notifications_written ?? 0),
      packages_captured: Number(data.packages_captured ?? 0),
      trends_written: Number(data.trends_written ?? 0),
    };
  } catch {
    return null;
  }
}
