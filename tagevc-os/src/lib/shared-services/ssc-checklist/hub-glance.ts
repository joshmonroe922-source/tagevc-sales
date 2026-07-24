/**
 * Lightweight SSC hub glance for firm readiness (fail-soft).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { getLatestCadenceRun } from './cadence-runner';
import { listAuditsForScope } from './engine';
import { periodBounds } from './period';
import {
  getSscPeriodTrends,
  sparklineBars,
  type SscFunctionTrend,
} from './trends';
import type { SscMonitoringSummary } from './types';

export type SscHubGlance = {
  period_key: string;
  completion_pct: number;
  overdue_tasks: number;
  blocked_tasks: number;
  open_tasks: number;
  audit_open_items: number;
  escalations_open: number;
  risk_badge: SscMonitoringSummary['risk_badge'];
  functions: Array<{
    function_key: string;
    completion_pct: number;
    overdue_tasks: number;
    sparkline: string;
    delta_completion: number | null;
  }>;
  trends: SscFunctionTrend[];
  last_cadence: {
    started_at: string;
    finished_at: string | null;
    ok: boolean;
    run_kind: string;
    periods_generated: number;
    escalations_created: number;
  } | null;
};

export async function getSscHubGlance(): Promise<SscHubGlance> {
  const bounds = periodBounds('monthly', new Date());
  const empty: SscHubGlance = {
    period_key: bounds.period_key,
    completion_pct: 0,
    overdue_tasks: 0,
    blocked_tasks: 0,
    open_tasks: 0,
    audit_open_items: 0,
    escalations_open: 0,
    risk_badge: 'amber',
    functions: [],
    trends: [],
    last_cadence: null,
  };

  try {
    const supabase = await createPersistClient();
    const [instancesRes, trends, lastCadence, audits] = await Promise.all([
      supabase
        .from('os_ssc_checklist_instances')
        .select(
          'id, function_key, completion_pct, overdue_count, blocked_count, period_key',
        )
        .eq('period_type', 'monthly')
        .eq('period_key', bounds.period_key)
        .eq('scope_mode', 'parent_subs'),
      getSscPeriodTrends({
        period_type: 'monthly',
        scope_mode: 'parent_subs',
        history: 6,
      }),
      getLatestCadenceRun(),
      listAuditsForScope({ scope_mode: 'parent_subs' }),
    ]);

    const inst = instancesRes.data ?? [];
    const ids = inst.map((i) => i.id as string);
    let open = 0;
    let overdue = 0;
    let blocked = 0;
    let done = 0;
    let total = 0;
    let escalations = 0;

    if (ids.length) {
      const { data: tasks } = await supabase
        .from('os_ssc_checklist_tasks')
        .select('status, due_date, evidence_ticket_id, risk_level')
        .in('instance_id', ids);
      const today = new Date().toISOString().slice(0, 10);
      for (const t of tasks ?? []) {
        total += 1;
        const closed = t.status === 'done' || t.status === 'waived';
        if (closed) done += 1;
        else open += 1;
        if (t.status === 'blocked') blocked += 1;
        if (!closed && t.due_date && String(t.due_date) < today) {
          overdue += 1;
        }
        if (t.evidence_ticket_id && !closed) escalations += 1;
      }
    }

    const auditOpen = audits.reduce((s, a) => s + a.open_item_count, 0);
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    const risk_badge =
      overdue > 0 || blocked > 3 || pct < 40
        ? 'red'
        : blocked > 0 || pct < 75
          ? 'amber'
          : 'green';

    const functions = inst.map((i) => {
      const trend = trends.find(
        (t) => t.function_key === String(i.function_key),
      );
      return {
        function_key: String(i.function_key),
        completion_pct: Number(i.completion_pct ?? 0),
        overdue_tasks: Number(i.overdue_count ?? 0),
        sparkline: sparklineBars(trend?.sparkline ?? []),
        delta_completion: trend?.delta_completion ?? null,
      };
    });

    return {
      period_key: bounds.period_key,
      completion_pct:
        pct ||
        Math.round(
          functions.length
            ? functions.reduce((s, f) => s + f.completion_pct, 0) /
                functions.length
            : 0,
        ),
      overdue_tasks:
        overdue || functions.reduce((s, f) => s + f.overdue_tasks, 0),
      blocked_tasks: blocked,
      open_tasks: open,
      audit_open_items: auditOpen,
      escalations_open: escalations,
      risk_badge,
      functions,
      trends,
      last_cadence: lastCadence
        ? {
            started_at: lastCadence.started_at,
            finished_at: lastCadence.finished_at,
            ok: lastCadence.ok,
            run_kind: lastCadence.run_kind,
            periods_generated: lastCadence.periods_generated,
            escalations_created: lastCadence.escalations_created,
          }
        : null,
    };
  } catch {
    return empty;
  }
}
