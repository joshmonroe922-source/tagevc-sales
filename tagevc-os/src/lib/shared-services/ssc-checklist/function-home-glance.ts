/**
 * Lightweight per-function home glance — needs-attention + open tasks.
 * Fail-soft; no heavy HTML bodies.
 * Active view = past + current monthly periods, urgency-sorted.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { ensurePeriodInstances } from './engine';
import {
  classifySscAttention,
  compareSscTaskUrgency,
  periodBounds,
  shiftPeriod,
  toDateStr,
  type SscAttentionKind,
} from './period';
import type { SscFunction } from './types';
import { entityDisplayNameFromId } from '@/lib/entities/display-name';

export type SscFunctionHomeTask = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  entity_id: string | null;
  company_name: string;
  is_overdue: boolean;
  due_today: boolean;
  due_soon: boolean;
  due_this_period: boolean;
  attention_kind: SscAttentionKind | null;
};

export type SscFunctionHomeGlance = {
  function_key: SscFunction;
  period_key: string;
  needs_attention: SscFunctionHomeTask[];
  open_tasks: SscFunctionHomeTask[];
  overdue_count: number;
  due_today_count: number;
  due_soon_count: number;
  open_count: number;
  error?: string;
};

type GlanceRawTask = {
  id: string;
  title?: string | null;
  template_key?: string | null;
  status?: string | null;
  due_date?: string | null;
  entity_id?: string | null;
};

/**
 * Pure glance partition — Needs attention = all open unfinished period work
 * (overdue, due today/soon, due this period, and remaining open/at-risk).
 */
export function partitionFunctionHomeGlance(opts: {
  tasks: GlanceRawTask[];
  today: string;
  period_end: string;
  limit?: number;
  companyName?: (entityId: string | null) => string;
}): Omit<SscFunctionHomeGlance, 'function_key' | 'period_key' | 'error'> {
  const limit = opts.limit ?? 40;
  const nameOf =
    opts.companyName ??
    ((entityId: string | null) =>
      entityId ? entityDisplayNameFromId(entityId) : 'Firm-wide');

  const mapped: SscFunctionHomeTask[] = opts.tasks.map((t) => {
    const due = t.due_date ? String(t.due_date).slice(0, 10) : null;
    const status = String(t.status ?? 'not_started');
    const attn = classifySscAttention({
      status,
      due_date: due,
      today: opts.today,
      period_end: opts.period_end,
    });
    const entityId = t.entity_id ? String(t.entity_id) : null;
    return {
      id: String(t.id),
      title: String(t.title ?? t.template_key ?? 'Task'),
      status,
      due_date: due,
      entity_id: entityId,
      company_name: nameOf(entityId),
      is_overdue: attn.is_overdue,
      due_today: attn.due_today,
      due_soon: attn.due_soon,
      due_this_period: attn.due_this_period,
      attention_kind: attn.attention_kind,
    };
  });

  const open = mapped
    .filter((t) => t.status !== 'done' && t.status !== 'waived')
    .sort(compareSscTaskUrgency);
  // Every open unfinished task belongs in Needs attention (broader than
  // overdue/due-today only).
  const needs = open.filter((t) => t.attention_kind != null);

  return {
    needs_attention: needs.slice(0, limit),
    open_tasks: open.slice(0, limit),
    overdue_count: open.filter((t) => t.is_overdue).length,
    due_today_count: open.filter((t) => t.due_today).length,
    due_soon_count: open.filter((t) => t.due_soon || t.due_today).length,
    open_count: open.length,
  };
}

export async function getSscFunctionHomeGlance(opts: {
  functionKey: SscFunction;
  entityId?: string | null;
  limit?: number;
}): Promise<SscFunctionHomeGlance> {
  const now = new Date();
  const currentBounds = periodBounds('monthly', now);
  const pastBounds = periodBounds('monthly', shiftPeriod('monthly', now, -1));
  const periodKeys = [pastBounds.period_key, currentBounds.period_key];
  const periodKeyLabel = `${pastBounds.period_key} · ${currentBounds.period_key}`;
  const limit = opts.limit ?? 40;
  const empty: SscFunctionHomeGlance = {
    function_key: opts.functionKey,
    period_key: periodKeyLabel,
    needs_attention: [],
    open_tasks: [],
    overdue_count: 0,
    due_today_count: 0,
    due_soon_count: 0,
    open_count: 0,
  };

  try {
    // Soft-seed past+current like Active checklists so homes aren't empty
    // until someone opens /shared-services/checklists.
    await ensurePeriodInstances({
      function: opts.functionKey,
      period_type: 'monthly',
      scope_mode: opts.entityId ? 'single' : 'parent_subs',
      single_entity_id: opts.entityId ?? null,
      refDate: now,
      include_next: false,
    }).catch(() => ({ generated: 0 }));
    // Also seed prior month (Active = past + current).
    await ensurePeriodInstances({
      function: opts.functionKey,
      period_type: 'monthly',
      scope_mode: opts.entityId ? 'single' : 'parent_subs',
      single_entity_id: opts.entityId ?? null,
      refDate: shiftPeriod('monthly', now, -1),
      include_next: false,
    }).catch(() => ({ generated: 0 }));

    const supabase = await createPersistClient();
    let instQuery = supabase
      .from('os_ssc_checklist_instances')
      .select('id, entity_id, function_key, period_key')
      .eq('period_type', 'monthly')
      .in('period_key', periodKeys)
      .eq('function_key', opts.functionKey);

    if (opts.entityId) {
      instQuery = instQuery.eq('entity_id', opts.entityId);
    }

    const { data: instances, error: instErr } = await instQuery.limit(40);
    if (instErr) return { ...empty, error: instErr.message };
    const ids = (instances ?? []).map((i) => i.id as string);
    if (!ids.length) return empty;

    const { data: tasks, error: taskErr } = await supabase
      .from('os_ssc_checklist_tasks')
      .select(
        'id, instance_id, template_key, title, status, due_date, owner_role, entity_id, function_key, risk_level, evidence_ticket_id',
      )
      .in('instance_id', ids)
      .limit(400);

    if (taskErr) return { ...empty, error: taskErr.message };

    // Local calendar day — match periodBounds / engine (not UTC ISO).
    const partitioned = partitionFunctionHomeGlance({
      tasks: (tasks ?? []) as GlanceRawTask[],
      today: toDateStr(now),
      period_end: currentBounds.period_end,
      limit,
    });

    return {
      function_key: opts.functionKey,
      period_key: periodKeyLabel,
      ...partitioned,
    };
  } catch (e) {
    return {
      ...empty,
      error: e instanceof Error ? e.message : 'Glance unavailable',
    };
  }
}
