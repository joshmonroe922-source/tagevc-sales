/** Process run materialization, step updates, retiming. */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { appendEmployeeEvent, getEmployee, updateEmployee } from './employees';
import { completionPct, computeDueDate } from './timing';
import type {
  HrisProcessKind,
  HrisProcessRun,
  HrisProcessStep,
  HrisStepStatus,
} from './types';

function mapStep(row: Record<string, unknown>): HrisProcessStep {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    step_key: String(row.step_key),
    title: String(row.title),
    category: String(row.category ?? 'General'),
    sort_order: Number(row.sort_order ?? 0),
    owner_role: String(row.owner_role ?? 'Human Resources'),
    timing_anchor: row.timing_anchor as HrisProcessStep['timing_anchor'],
    offset_days: Number(row.offset_days ?? 0),
    due_at: row.due_at ? String(row.due_at).slice(0, 10) : null,
    status: row.status as HrisStepStatus,
    evidence_required: Boolean(row.evidence_required),
    evidence_note: String(row.evidence_note ?? ''),
    evidence_url: (row.evidence_url as string) ?? null,
    automation: row.automation as HrisProcessStep['automation'],
    destructive: Boolean(row.destructive),
    optional_for_audience: Boolean(row.optional_for_audience),
    system_hook: (row.system_hook as string) ?? null,
    blocker: Boolean(row.blocker),
    escalated_ticket_id: (row.escalated_ticket_id as string) ?? null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    notes: String(row.notes ?? ''),
  };
}

function mapRun(row: Record<string, unknown>): HrisProcessRun {
  return {
    id: String(row.id),
    run_key: String(row.run_key),
    employee_id: String(row.employee_id),
    template_id: String(row.template_id),
    kind: row.kind as HrisProcessKind,
    status: row.status as HrisProcessRun['status'],
    completion_pct: Number(row.completion_pct ?? 0),
    escalated_ticket_id: (row.escalated_ticket_id as string) ?? null,
    offer_accepted_at: row.offer_accepted_at
      ? String(row.offer_accepted_at).slice(0, 10)
      : null,
    start_date: row.start_date ? String(row.start_date).slice(0, 10) : null,
    end_date: row.end_date ? String(row.end_date).slice(0, 10) : null,
    started_at: String(row.started_at),
    completed_at: row.completed_at ? String(row.completed_at) : null,
    notes: String(row.notes ?? ''),
  };
}

export function templateSlugFor(
  kind: HrisProcessKind,
  entityId: string,
): string {
  if (kind === 'offboarding') {
    return entityId === 'ENT-R619' || entityId === 'ENT-FIRM' || entityId === 'ENT-INDA'
      ? 'r619-offboarding-v1'
      : 'r619-offboarding-v1';
  }
  return 'r619-onboarding-v1';
}

export async function listRuns(opts?: {
  kind?: HrisProcessKind;
  status?: string | null;
  entityId?: string | null;
  limit?: number;
}): Promise<{ rows: Array<HrisProcessRun & { employee_name?: string; entity_id?: string }>; error?: string }> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_hris_process_runs')
      .select(
        '*, os_hris_employees!inner(full_name, entity_id)',
      )
      .order('started_at', { ascending: false })
      .limit(opts?.limit ?? 80);
    if (opts?.kind) q = q.eq('kind', opts.kind);
    if (opts?.status) q = q.eq('status', opts.status);
    if (opts?.entityId) {
      q = q.eq('os_hris_employees.entity_id', opts.entityId);
    }
    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        const emp = r.os_hris_employees as
          | { full_name?: string; entity_id?: string }
          | null;
        return {
          ...mapRun(r),
          employee_name: emp?.full_name,
          entity_id: emp?.entity_id,
        };
      }),
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'List runs failed',
    };
  }
}

export async function getRunWithSteps(
  runId: string,
): Promise<{ run: HrisProcessRun | null; error?: string }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_hris_process_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle();
    if (error) return { run: null, error: error.message };
    if (!data) return { run: null };
    const run = mapRun(data as Record<string, unknown>);
    const { data: steps } = await sb
      .from('os_hris_process_steps')
      .select('*')
      .eq('run_id', runId)
      .order('sort_order', { ascending: true });
    run.steps = (steps ?? []).map((s) => mapStep(s as Record<string, unknown>));
    return { run };
  } catch (e) {
    return {
      run: null,
      error: e instanceof Error ? e.message : 'Get run failed',
    };
  }
}

export async function listRunsForEmployee(
  employeeId: string,
): Promise<HrisProcessRun[]> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_hris_process_runs')
      .select('*')
      .eq('employee_id', employeeId)
      .order('started_at', { ascending: false });
    const runs = (data ?? []).map((r) => mapRun(r as Record<string, unknown>));
    for (const run of runs) {
      const { data: steps } = await sb
        .from('os_hris_process_steps')
        .select('*')
        .eq('run_id', run.id)
        .order('sort_order', { ascending: true });
      run.steps = (steps ?? []).map((s) => mapStep(s as Record<string, unknown>));
    }
    return runs;
  } catch {
    return [];
  }
}

async function syncEmployeeProgress(
  employeeId: string,
  kind: HrisProcessKind,
  pct: number,
  runStatus: HrisProcessRun['status'],
): Promise<void> {
  const processStatus =
    runStatus === 'complete'
      ? 'complete'
      : runStatus === 'blocked'
        ? 'blocked'
        : runStatus === 'cancelled'
          ? 'cancelled'
          : 'in_progress';

  if (kind === 'onboarding') {
    await updateEmployee(employeeId, {
      onboarding_pct: pct,
      onboarding_status: processStatus,
      status:
        runStatus === 'complete'
          ? 'active'
          : processStatus === 'in_progress' || processStatus === 'blocked'
            ? 'onboarding'
            : undefined,
    });
  } else {
    await updateEmployee(employeeId, {
      offboarding_pct: pct,
      offboarding_status: processStatus,
      status:
        runStatus === 'complete'
          ? 'terminated'
          : processStatus === 'in_progress' || processStatus === 'blocked'
            ? 'offboarding'
            : undefined,
    });
  }
}

export async function startProcessRun(input: {
  employee_id: string;
  kind: HrisProcessKind;
  actor_id?: string | null;
  notes?: string;
}): Promise<
  { ok: true; run: HrisProcessRun } | { ok: false; error: string }
> {
  try {
    const empRes = await getEmployee(input.employee_id);
    if (!empRes.employee) {
      return { ok: false, error: empRes.error ?? 'Employee not found' };
    }
    const emp = empRes.employee;
    const sb = await createPersistClient();

    const { data: open } = await sb
      .from('os_hris_process_runs')
      .select('id')
      .eq('employee_id', emp.id)
      .eq('kind', input.kind)
      .in('status', ['open', 'in_progress', 'blocked'])
      .limit(1);
    if (open && open.length > 0) {
      const existing = await getRunWithSteps(String(open[0].id));
      if (existing.run) return { ok: true, run: existing.run };
    }

    const slug = templateSlugFor(input.kind, emp.entity_id);
    const { data: tmpl, error: tmplErr } = await sb
      .from('os_hris_process_templates')
      .select('id, slug')
      .eq('slug', slug)
      .eq('active', true)
      .maybeSingle();
    if (tmplErr || !tmpl) {
      return { ok: false, error: tmplErr?.message ?? `Template ${slug} missing` };
    }

    const { data: tmplSteps, error: stepsErr } = await sb
      .from('os_hris_process_template_steps')
      .select('*')
      .eq('template_id', tmpl.id)
      .order('sort_order', { ascending: true });
    if (stepsErr) return { ok: false, error: stepsErr.message };

    const endDate =
      input.kind === 'offboarding'
        ? emp.end_date ?? new Date().toISOString().slice(0, 10)
        : emp.end_date;
    const startDate = emp.start_date;
    const offer = emp.offer_accepted_at;

    const runKey = `${input.kind === 'onboarding' ? 'ONB' : 'OFF'}-${emp.employee_key.slice(0, 32)}-${Date.now().toString(36)}`;

    const { data: runRow, error: runErr } = await sb
      .from('os_hris_process_runs')
      .insert({
        run_key: runKey,
        employee_id: emp.id,
        template_id: tmpl.id,
        kind: input.kind,
        status: 'in_progress',
        offer_accepted_at: offer,
        start_date: startDate,
        end_date: endDate,
        notes: input.notes ?? '',
        created_by: input.actor_id ?? null,
      })
      .select('*')
      .single();
    if (runErr || !runRow) {
      return { ok: false, error: runErr?.message ?? 'Run insert failed' };
    }
    const run = mapRun(runRow as Record<string, unknown>);

    const stepRows = (tmplSteps ?? []).map((ts) => {
      const t = ts as Record<string, unknown>;
      const due = computeDueDate({
        timing_anchor: t.timing_anchor as HrisProcessStep['timing_anchor'],
        offset_days: Number(t.offset_days ?? 0),
        offer_accepted_at: offer,
        start_date: startDate,
        end_date: endDate,
      });
      return {
        run_id: run.id,
        template_step_id: t.id,
        step_key: String(t.step_key),
        title: String(t.title),
        category: String(t.category ?? 'General'),
        sort_order: Number(t.sort_order ?? 0),
        owner_role: String(t.owner_role ?? 'Human Resources'),
        timing_anchor: t.timing_anchor,
        offset_days: Number(t.offset_days ?? 0),
        due_at: due,
        status: 'pending',
        evidence_required: Boolean(t.evidence_required),
        automation: t.automation,
        destructive: Boolean(t.destructive),
        optional_for_audience: Boolean(t.optional_for_audience),
        system_hook: t.system_hook,
      };
    });

    if (stepRows.length) {
      const { error: insErr } = await sb
        .from('os_hris_process_steps')
        .insert(stepRows);
      if (insErr) return { ok: false, error: insErr.message };
    }

    await syncEmployeeProgress(emp.id, input.kind, 0, 'in_progress');
    await appendEmployeeEvent({
      employee_id: emp.id,
      event_kind: 'run_started',
      summary: `${input.kind} run started`,
      detail: { run_id: run.id, template: slug },
      actor_id: input.actor_id,
    });

    if (input.kind === 'offboarding') {
      await updateEmployee(emp.id, {
        status: 'offboarding',
        end_date: endDate,
        offboarding_status: 'in_progress',
      });
    } else {
      await updateEmployee(emp.id, {
        status: 'onboarding',
        onboarding_status: 'in_progress',
      });
    }

    // Fail-soft: link IT child run on employee_links
    try {
      const { linkItChildRun } = await import('@/lib/hris/step-assists');
      await linkItChildRun({
        employee: emp,
        kind:
          input.kind === 'offboarding' ? 'it_offboarding' : 'it_onboarding',
        actorId: input.actor_id,
      });
    } catch {
      /* keep HRIS run even if IT child link fails */
    }

    const full = await getRunWithSteps(run.id);
    return { ok: true, run: full.run ?? run };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Start run failed',
    };
  }
}

export async function retimeOpenRunsForEmployee(
  employeeId: string,
): Promise<number> {
  const empRes = await getEmployee(employeeId);
  if (!empRes.employee) return 0;
  const emp = empRes.employee;
  const sb = await createPersistClient();
  const { data: runs } = await sb
    .from('os_hris_process_runs')
    .select('*')
    .eq('employee_id', employeeId)
    .in('status', ['open', 'in_progress', 'blocked']);

  let updated = 0;
  for (const raw of runs ?? []) {
    const run = mapRun(raw as Record<string, unknown>);
    await sb
      .from('os_hris_process_runs')
      .update({
        start_date: emp.start_date,
        end_date: emp.end_date,
        offer_accepted_at: emp.offer_accepted_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id);

    const { data: steps } = await sb
      .from('os_hris_process_steps')
      .select('*')
      .eq('run_id', run.id);
    for (const s of steps ?? []) {
      const step = mapStep(s as Record<string, unknown>);
      if (['done', 'waived', 'na'].includes(step.status)) continue;
      const due = computeDueDate({
        timing_anchor: step.timing_anchor,
        offset_days: step.offset_days,
        offer_accepted_at: emp.offer_accepted_at,
        start_date: emp.start_date,
        end_date: emp.end_date,
      });
      await sb
        .from('os_hris_process_steps')
        .update({ due_at: due, updated_at: new Date().toISOString() })
        .eq('id', step.id);
      updated += 1;
    }
  }
  return updated;
}

export async function retimeAllOpenRuns(): Promise<number> {
  const sb = await createPersistClient();
  const { data: runs } = await sb
    .from('os_hris_process_runs')
    .select('employee_id')
    .in('status', ['open', 'in_progress', 'blocked']);
  const ids = [...new Set((runs ?? []).map((r) => String(r.employee_id)))];
  let total = 0;
  for (const id of ids) {
    total += await retimeOpenRunsForEmployee(id);
  }
  return total;
}

export async function updateStepStatus(input: {
  step_id: string;
  status: HrisStepStatus;
  evidence_note?: string;
  evidence_url?: string | null;
  actor_id?: string | null;
  confirm_destructive?: boolean;
}): Promise<
  { ok: true; step: HrisProcessStep; run: HrisProcessRun } | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const { data: stepRow, error } = await sb
      .from('os_hris_process_steps')
      .select('*')
      .eq('id', input.step_id)
      .maybeSingle();
    if (error || !stepRow) {
      return { ok: false, error: error?.message ?? 'Step not found' };
    }
    const step = mapStep(stepRow as Record<string, unknown>);
    if (
      step.destructive &&
      ['done', 'waived'].includes(input.status) &&
      !input.confirm_destructive
    ) {
      return {
        ok: false,
        error: 'Destructive step requires human confirmation',
      };
    }

    const patch: Record<string, unknown> = {
      status: input.status,
      updated_at: new Date().toISOString(),
      blocker: input.status === 'blocked',
    };
    if (input.evidence_note !== undefined) {
      patch.evidence_note = input.evidence_note;
    }
    if (input.evidence_url !== undefined) {
      patch.evidence_url = input.evidence_url;
    }
    if (['done', 'waived', 'na'].includes(input.status)) {
      patch.completed_at = new Date().toISOString();
      patch.completed_by = input.actor_id ?? null;
    }

    const { data: updated, error: upErr } = await sb
      .from('os_hris_process_steps')
      .update(patch)
      .eq('id', input.step_id)
      .select('*')
      .single();
    if (upErr || !updated) {
      return { ok: false, error: upErr?.message ?? 'Update failed' };
    }

    const runRes = await getRunWithSteps(step.run_id);
    if (!runRes.run?.steps) {
      return { ok: false, error: runRes.error ?? 'Run missing' };
    }
    const pct = completionPct(runRes.run.steps);
    const blocked = runRes.run.steps.some((s) => s.status === 'blocked');
    const allDone = runRes.run.steps.every((s) =>
      ['done', 'waived', 'na'].includes(s.status),
    );
    const runStatus = allDone
      ? 'complete'
      : blocked
        ? 'blocked'
        : 'in_progress';

    await sb
      .from('os_hris_process_runs')
      .update({
        completion_pct: pct,
        status: runStatus,
        completed_at: allDone ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', step.run_id);

    await syncEmployeeProgress(
      runRes.run.employee_id,
      runRes.run.kind,
      pct,
      runStatus,
    );

    const eventKind =
      input.status === 'waived'
        ? 'step_waived'
        : input.status === 'blocked'
          ? 'step_blocked'
          : input.status === 'done'
            ? 'step_done'
            : 'note';
    await appendEmployeeEvent({
      employee_id: runRes.run.employee_id,
      event_kind: eventKind,
      summary: `${step.title} → ${input.status}`,
      detail: { step_id: step.id, status: input.status },
      actor_id: input.actor_id,
    });

    if (allDone) {
      await appendEmployeeEvent({
        employee_id: runRes.run.employee_id,
        event_kind: 'run_completed',
        summary: `${runRes.run.kind} run complete`,
        detail: { run_id: runRes.run.id },
        actor_id: input.actor_id,
      });
    }

    const refreshed = await getRunWithSteps(step.run_id);
    return {
      ok: true,
      step: mapStep(updated as Record<string, unknown>),
      run: refreshed.run!,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Step update failed',
    };
  }
}
