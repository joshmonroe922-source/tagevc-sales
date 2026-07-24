/**
 * Multi-period SSC trend snapshots + reads for sparklines.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { periodBounds, shiftPeriod } from './period';
import type { SscFunction, SscPeriodType, SscScopeMode } from './types';
import { SSC_FUNCTIONS } from './types';

export type SscTrendPoint = {
  period_key: string;
  completion_pct: number;
  overdue_count: number;
  blocked_count: number;
  total_tasks: number;
  done_tasks: number;
};

export type SscFunctionTrend = {
  function_key: SscFunction | 'all';
  points: SscTrendPoint[];
  /** Compact sparkline values 0–100 */
  sparkline: number[];
  delta_completion: number | null;
  delta_overdue: number | null;
};

export async function capturePeriodTrends(input: {
  period_type: SscPeriodType;
  scope_mode: SscScopeMode;
  entity_id?: string | null;
  history?: number;
}): Promise<number> {
  const history = input.history ?? 6;
  let written = 0;
  try {
    const supabase = await createPersistClient();
    for (let i = history - 1; i >= 0; i--) {
      const ref = shiftPeriod(input.period_type, new Date(), -i);
      const bounds = periodBounds(input.period_type, ref);
      let q = supabase
        .from('os_ssc_checklist_instances')
        .select(
          'id, function_key, completion_pct, overdue_count, blocked_count',
        )
        .eq('period_type', input.period_type)
        .eq('period_key', bounds.period_key)
        .eq('scope_mode', input.scope_mode);
      q = input.entity_id
        ? q.eq('entity_id', input.entity_id)
        : q.is('entity_id', null);
      const { data: instances } = await q;
      const inst = instances ?? [];
      if (!inst.length) continue;

      const ids = inst.map((r) => r.id as string);
      const { data: tasks } = await supabase
        .from('os_ssc_checklist_tasks')
        .select('function_key, status, due_date')
        .in('instance_id', ids);
      const today = new Date().toISOString().slice(0, 10);

      const rollup = (
        fn: SscFunction | 'all',
      ): {
        completion_pct: number;
        overdue_count: number;
        blocked_count: number;
        total_tasks: number;
        done_tasks: number;
      } => {
        const subset =
          fn === 'all'
            ? tasks ?? []
            : (tasks ?? []).filter((t) => t.function_key === fn);
        const total = subset.length;
        const done = subset.filter(
          (t) => t.status === 'done' || t.status === 'waived',
        ).length;
        const blocked = subset.filter((t) => t.status === 'blocked').length;
        const overdue = subset.filter(
          (t) =>
            t.status !== 'done' &&
            t.status !== 'waived' &&
            t.due_date &&
            String(t.due_date) < today,
        ).length;
        return {
          completion_pct: total === 0 ? 0 : Math.round((done / total) * 100),
          overdue_count: overdue,
          blocked_count: blocked,
          total_tasks: total,
          done_tasks: done,
        };
      };

      const keys: Array<SscFunction | 'all'> = ['all', ...SSC_FUNCTIONS];
      for (const fn of keys) {
        const m = rollup(fn);
        const { error } = await supabase.from('os_ssc_period_trends').upsert(
          {
            function_key: fn,
            period_type: input.period_type,
            period_key: bounds.period_key,
            scope_mode: input.scope_mode,
            entity_id: input.entity_id ?? null,
            completion_pct: m.completion_pct,
            overdue_count: m.overdue_count,
            blocked_count: m.blocked_count,
            total_tasks: m.total_tasks,
            done_tasks: m.done_tasks,
            captured_at: new Date().toISOString(),
          },
          {
            onConflict: 'function_key,period_type,period_key,scope_mode,entity_id',
          },
        );
        // unique index uses coalesce — upsert onConflict may fail; fallback insert/update
        if (error) {
          let existsQ = supabase
            .from('os_ssc_period_trends')
            .select('id')
            .eq('function_key', fn)
            .eq('period_type', input.period_type)
            .eq('period_key', bounds.period_key)
            .eq('scope_mode', input.scope_mode);
          existsQ = input.entity_id
            ? existsQ.eq('entity_id', input.entity_id)
            : existsQ.is('entity_id', null);
          const { data: exists } = await existsQ.maybeSingle();
          if (exists?.id) {
            await supabase
              .from('os_ssc_period_trends')
              .update({
                completion_pct: m.completion_pct,
                overdue_count: m.overdue_count,
                blocked_count: m.blocked_count,
                total_tasks: m.total_tasks,
                done_tasks: m.done_tasks,
                captured_at: new Date().toISOString(),
              })
              .eq('id', exists.id);
          } else {
            await supabase.from('os_ssc_period_trends').insert({
              function_key: fn,
              period_type: input.period_type,
              period_key: bounds.period_key,
              scope_mode: input.scope_mode,
              entity_id: input.entity_id ?? null,
              completion_pct: m.completion_pct,
              overdue_count: m.overdue_count,
              blocked_count: m.blocked_count,
              total_tasks: m.total_tasks,
              done_tasks: m.done_tasks,
            });
          }
        }
        written += 1;
      }
    }
  } catch {
    // fail-soft
  }
  return written;
}

export async function getSscPeriodTrends(input: {
  period_type: SscPeriodType;
  scope_mode: SscScopeMode;
  entity_id?: string | null;
  history?: number;
}): Promise<SscFunctionTrend[]> {
  const history = input.history ?? 6;
  // Ensure current history captured from live instances
  await capturePeriodTrends({ ...input, history });

  try {
    const supabase = await createPersistClient();
    let q = supabase
      .from('os_ssc_period_trends')
      .select('*')
      .eq('period_type', input.period_type)
      .eq('scope_mode', input.scope_mode)
      .order('period_key', { ascending: true });
    q = input.entity_id
      ? q.eq('entity_id', input.entity_id)
      : q.is('entity_id', null);
    const { data } = await q;
    const rows = data ?? [];

    // Keep last N period_keys overall
    const periodKeys = [
      ...new Set(rows.map((r) => String(r.period_key))),
    ].slice(-history);

    const out: SscFunctionTrend[] = [];
    const fns: Array<SscFunction | 'all'> = ['all', ...SSC_FUNCTIONS];
    for (const fn of fns) {
      const points: SscTrendPoint[] = periodKeys.map((pk) => {
        const row = rows.find(
          (r) => r.function_key === fn && String(r.period_key) === pk,
        );
        return {
          period_key: pk,
          completion_pct: Number(row?.completion_pct ?? 0),
          overdue_count: Number(row?.overdue_count ?? 0),
          blocked_count: Number(row?.blocked_count ?? 0),
          total_tasks: Number(row?.total_tasks ?? 0),
          done_tasks: Number(row?.done_tasks ?? 0),
        };
      });
      const sparkline = points.map((p) => p.completion_pct);
      const last = points.at(-1);
      const prev = points.at(-2);
      out.push({
        function_key: fn,
        points,
        sparkline,
        delta_completion:
          last && prev
            ? last.completion_pct - prev.completion_pct
            : null,
        delta_overdue:
          last && prev ? last.overdue_count - prev.overdue_count : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Tiny CSS-friendly bar sparkline string for UI. */
export function sparklineBars(values: number[], width = 6): string {
  if (!values.length) return '—';
  const slice = values.slice(-width);
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  return slice
    .map((v) => {
      const idx = Math.max(
        0,
        Math.min(blocks.length - 1, Math.round((v / 100) * (blocks.length - 1))),
      );
      return blocks[idx];
    })
    .join('');
}
