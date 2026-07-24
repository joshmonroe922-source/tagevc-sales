/**
 * Lightweight SSC hub glance for firm readiness (fail-soft).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { listAuditsForScope } from './engine';
import { periodBounds } from './period';
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
  }>;
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
  };

  try {
    const supabase = await createPersistClient();
    const { data: instances } = await supabase
      .from('os_ssc_checklist_instances')
      .select(
        'id, function_key, completion_pct, overdue_count, blocked_count, period_key',
      )
      .eq('period_type', 'monthly')
      .eq('period_key', bounds.period_key)
      .eq('scope_mode', 'parent_subs');

    const inst = instances ?? [];
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
        if (
          !closed &&
          t.due_date &&
          String(t.due_date) < today
        ) {
          overdue += 1;
        }
        if (t.evidence_ticket_id && !closed) escalations += 1;
      }
    }

    const audits = await listAuditsForScope({
      scope_mode: 'parent_subs',
    });
    const auditOpen = audits.reduce((s, a) => s + a.open_item_count, 0);
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    const risk_badge =
      overdue > 0 || blocked > 3 || pct < 40
        ? 'red'
        : blocked > 0 || pct < 75
          ? 'amber'
          : 'green';

    const byFn = new Map<string, { done: number; total: number; overdue: number }>();
    for (const i of inst) {
      byFn.set(String(i.function_key), {
        done: 0,
        total: 0,
        overdue: Number(i.overdue_count ?? 0),
      });
    }
    // Prefer instance rollups when task scan empty
    const functions = inst.map((i) => ({
      function_key: String(i.function_key),
      completion_pct: Number(i.completion_pct ?? 0),
      overdue_tasks: Number(i.overdue_count ?? 0),
    }));

    return {
      period_key: bounds.period_key,
      completion_pct: pct || Math.round(
        functions.length
          ? functions.reduce((s, f) => s + f.completion_pct, 0) /
              functions.length
          : 0,
      ),
      overdue_tasks: overdue || functions.reduce((s, f) => s + f.overdue_tasks, 0),
      blocked_tasks: blocked,
      open_tasks: open,
      audit_open_items: auditOpen,
      escalations_open: escalations,
      risk_badge,
      functions,
    };
  } catch {
    return empty;
  }
}
