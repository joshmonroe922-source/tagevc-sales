/**
 * Phase 66 SSC checklist + audit engine (server).
 * Additive — does not replace finance close, HR packs, IT runs, or legal cadence.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { auditItemLibrary } from './audit-library';
import { buildSscAiBriefing, draftAuditFinding, suggestTaskNextAction } from './ai';
import {
  classifyTimeNav,
  periodBounds,
  shiftPeriod,
  toDateStr,
} from './period';
import { companyName, resolveScopeEntityIds } from './scope';
import { collectSubsidiarySyncHooks } from './sync-hooks';
import { templatesFor } from './task-library';
import {
  SSC_FUNCTIONS,
  SSC_PHASE66_CONTRACT,
  functionLabel,
  periodLabel,
  type SscAiBriefing,
  type SscAuditRow,
  type SscAuditType,
  type SscChecklistInstanceRow,
  type SscChecklistTaskRow,
  type SscFunction,
  type SscMonitoringSummary,
  type SscPeriodType,
  type SscScopeMode,
  type SscSyncSnapshot,
  type SscTaskStatus,
} from './types';

export type SscOperatorQuery = {
  function: SscFunction | 'all';
  period_type: SscPeriodType;
  scope_mode: SscScopeMode;
  single_entity_id?: string | null;
  time_nav: 'past' | 'current' | 'future';
  period_offset?: number;
  status?: SscTaskStatus | 'all';
  owner_role?: string | 'all';
  company_entity_id?: string | 'all';
  risk?: 'all' | 'high_plus';
};

export type SscOperatorBundle = {
  contract_version: typeof SSC_PHASE66_CONTRACT;
  query: SscOperatorQuery;
  period_key: string;
  period_start: string;
  period_end: string;
  due_at: string;
  time_nav: 'past' | 'current' | 'future';
  instances: SscChecklistInstanceRow[];
  tasks: SscChecklistTaskRow[];
  monitoring: SscMonitoringSummary[];
  ai: SscAiBriefing;
  sync: SscSyncSnapshot[];
  audits: SscAuditRow[];
  generated: boolean;
  money_auto_approve: false;
};

function todayStr(): string {
  return toDateStr(new Date());
}

function isClosed(status: SscTaskStatus): boolean {
  return status === 'done' || status === 'waived';
}

function riskBadge(
  overdue: number,
  blocked: number,
  pct: number,
): SscMonitoringSummary['risk_badge'] {
  if (overdue > 0 || blocked > 3 || pct < 40) return 'red';
  if (blocked > 0 || pct < 75) return 'amber';
  return 'green';
}

async function ensureInstance(input: {
  function_key: SscFunction;
  period_type: SscPeriodType;
  period_key: string;
  scope_mode: SscScopeMode;
  entity_id: string | null;
  period_start: string;
  period_end: string;
  due_at: string;
}): Promise<{ id: string; created: boolean } | null> {
  try {
    const supabase = await createPersistClient();
    let existingQuery = supabase
      .from('os_ssc_checklist_instances')
      .select('id')
      .eq('function_key', input.function_key)
      .eq('period_type', input.period_type)
      .eq('period_key', input.period_key)
      .eq('scope_mode', input.scope_mode);
    existingQuery = input.entity_id
      ? existingQuery.eq('entity_id', input.entity_id)
      : existingQuery.is('entity_id', null);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing?.id) return { id: existing.id as string, created: false };

    const { data: inserted, error } = await supabase
      .from('os_ssc_checklist_instances')
      .insert({
        function_key: input.function_key,
        period_type: input.period_type,
        period_key: input.period_key,
        scope_mode: input.scope_mode,
        entity_id: input.entity_id,
        period_start: input.period_start,
        period_end: input.period_end,
        due_at: input.due_at,
        generated_by: 'auto',
      })
      .select('id')
      .single();

    if (error || !inserted?.id) {
      // unique race — re-read
      let againQuery = supabase
        .from('os_ssc_checklist_instances')
        .select('id')
        .eq('function_key', input.function_key)
        .eq('period_type', input.period_type)
        .eq('period_key', input.period_key)
        .eq('scope_mode', input.scope_mode);
      againQuery = input.entity_id
        ? againQuery.eq('entity_id', input.entity_id)
        : againQuery.is('entity_id', null);
      const { data: again } = await againQuery.maybeSingle();
      if (again?.id) return { id: again.id as string, created: false };
      return null;
    }
    return { id: inserted.id as string, created: true };
  } catch {
    return null;
  }
}

async function seedTasksForInstance(input: {
  instance_id: string;
  function_key: SscFunction;
  period_type: SscPeriodType;
  entity_ids: string[];
  due_at: string;
}): Promise<number> {
  const templates = templatesFor(input.function_key, input.period_type);
  if (!templates.length) return 0;
  try {
    const supabase = await createPersistClient();
    const rows: Record<string, unknown>[] = [];
    let sort = 0;
    for (const tmpl of templates) {
      const targets = tmpl.per_company ? input.entity_ids : [null];
      for (const entityId of targets) {
        rows.push({
          instance_id: input.instance_id,
          template_key: tmpl.key,
          title: tmpl.title,
          description: tmpl.description,
          function_key: tmpl.function,
          period_type: tmpl.period_type,
          owner_role: tmpl.owner_role,
          entity_id: entityId,
          status: 'not_started',
          due_date: input.due_at,
          automation_source: 'auto',
          risk_level: tmpl.risk_level,
          sort_order: sort++,
          ai_suggestion: null,
        });
      }
    }
    if (!rows.length) return 0;
    let n = 0;
    for (const row of rows) {
      let existsQ = supabase
        .from('os_ssc_checklist_tasks')
        .select('id')
        .eq('instance_id', input.instance_id)
        .eq('template_key', row.template_key as string);
      existsQ = row.entity_id
        ? existsQ.eq('entity_id', row.entity_id as string)
        : existsQ.is('entity_id', null);
      const { data: exists } = await existsQ.maybeSingle();
      if (exists?.id) continue;
      const { error: e2 } = await supabase
        .from('os_ssc_checklist_tasks')
        .insert(row);
      if (!e2) n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

async function refreshInstanceCounts(instanceId: string): Promise<void> {
  try {
    const supabase = await createPersistClient();
    const { data: tasks } = await supabase
      .from('os_ssc_checklist_tasks')
      .select('status, due_date')
      .eq('instance_id', instanceId);
    const list = tasks ?? [];
    const total = list.length;
    const done = list.filter((t) =>
      isClosed(t.status as SscTaskStatus),
    ).length;
    const blocked = list.filter((t) => t.status === 'blocked').length;
    const today = todayStr();
    const overdue = list.filter(
      (t) =>
        !isClosed(t.status as SscTaskStatus) &&
        t.due_date &&
        String(t.due_date) < today,
    ).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    const status =
      pct >= 100 ? 'complete' : done > 0 || blocked > 0 ? 'in_progress' : 'open';
    await supabase
      .from('os_ssc_checklist_instances')
      .update({
        completion_pct: pct,
        overdue_count: overdue,
        blocked_count: blocked,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', instanceId);
  } catch {
    // fail-soft
  }
}

export async function ensurePeriodInstances(input: {
  function: SscFunction | 'all';
  period_type: SscPeriodType;
  scope_mode: SscScopeMode;
  single_entity_id?: string | null;
  refDate?: Date;
  /** Also generate next period (future). */
  include_next?: boolean;
}): Promise<{ generated: number }> {
  const refs = [input.refDate ?? new Date()];
  if (input.include_next !== false) {
    refs.push(shiftPeriod(input.period_type, refs[0]!, 1));
  }
  const functions: SscFunction[] =
    input.function === 'all' ? [...SSC_FUNCTIONS] : [input.function];
  const entityIds = resolveScopeEntityIds(
    input.scope_mode,
    input.single_entity_id,
  );
  let generated = 0;

  for (const ref of refs) {
    const bounds = periodBounds(input.period_type, ref);
    for (const fn of functions) {
      // One instance per function × period × scope (entity_id null for multi)
      const scopeEntity =
        input.scope_mode === 'single' ? entityIds[0] ?? null : null;
      const inst = await ensureInstance({
        function_key: fn,
        period_type: input.period_type,
        period_key: bounds.period_key,
        scope_mode: input.scope_mode,
        entity_id: scopeEntity,
        period_start: bounds.period_start,
        period_end: bounds.period_end,
        due_at: bounds.due_at,
      });
      if (!inst) continue;
      if (inst.created) generated += 1;
      const seeded = await seedTasksForInstance({
        instance_id: inst.id,
        function_key: fn,
        period_type: input.period_type,
        entity_ids: entityIds,
        due_at: bounds.due_at,
      });
      if (seeded > 0) generated += 1;
      await refreshInstanceCounts(inst.id);
    }
  }
  return { generated };
}

function mapTask(row: Record<string, unknown>): SscChecklistTaskRow {
  const status = (row.status as SscTaskStatus) ?? 'not_started';
  const due = row.due_date ? String(row.due_date) : null;
  const overdue =
    !isClosed(status) && !!due && due < todayStr();
  return {
    id: String(row.id),
    instance_id: String(row.instance_id),
    template_key: String(row.template_key),
    title: String(row.title),
    description: (row.description as string) ?? null,
    function_key: row.function_key as SscFunction,
    period_type: row.period_type as SscPeriodType,
    owner_role: String(row.owner_role ?? 'service_lead'),
    entity_id: (row.entity_id as string) ?? null,
    company_name: companyName((row.entity_id as string) ?? null),
    status,
    due_date: due,
    completed_at: (row.completed_at as string) ?? null,
    completed_by: (row.completed_by as string) ?? null,
    evidence_ticket_id: (row.evidence_ticket_id as string) ?? null,
    evidence_url: (row.evidence_url as string) ?? null,
    evidence_note: (row.evidence_note as string) ?? null,
    automation_source: (row.automation_source as SscChecklistTaskRow['automation_source']) ?? 'manual',
    risk_level: (row.risk_level as SscChecklistTaskRow['risk_level']) ?? 'normal',
    sort_order: Number(row.sort_order ?? 0),
    ai_suggestion:
      (row.ai_suggestion as string) ??
      suggestTaskNextAction({
        id: String(row.id),
        instance_id: String(row.instance_id),
        template_key: String(row.template_key),
        title: String(row.title),
        description: null,
        function_key: row.function_key as SscFunction,
        period_type: row.period_type as SscPeriodType,
        owner_role: String(row.owner_role ?? 'service_lead'),
        entity_id: (row.entity_id as string) ?? null,
        company_name: companyName((row.entity_id as string) ?? null),
        status,
        due_date: due,
        completed_at: null,
        completed_by: null,
        evidence_ticket_id: null,
        evidence_url: null,
        evidence_note: null,
        automation_source: 'manual',
        risk_level: (row.risk_level as SscChecklistTaskRow['risk_level']) ?? 'normal',
        sort_order: 0,
        ai_suggestion: null,
        is_overdue: overdue,
      }),
    is_overdue: overdue,
  };
}

function buildMonitoring(tasks: SscChecklistTaskRow[]): SscMonitoringSummary[] {
  const groups: Array<SscFunction | 'all'> = ['all', ...SSC_FUNCTIONS];
  return groups.map((fn) => {
    const subset =
      fn === 'all' ? tasks : tasks.filter((t) => t.function_key === fn);
    const total = subset.length;
    const done = subset.filter((t) => isClosed(t.status)).length;
    const overdue = subset.filter((t) => t.is_overdue).length;
    const blocked = subset.filter((t) => t.status === 'blocked').length;
    const waived = subset.filter((t) => t.status === 'waived').length;
    const pct = total === 0 ? 100 : Math.round((done / total) * 100);
    return {
      function_key: fn,
      completion_pct: pct,
      total_tasks: total,
      done_tasks: done,
      overdue_tasks: overdue,
      blocked_tasks: blocked,
      waived_tasks: waived,
      audit_open_items: 0,
      risk_badge: riskBadge(overdue, blocked, pct),
      trend_label:
        overdue > 0
          ? 'Behind — overdue work'
          : pct >= 90
            ? 'On track'
            : 'In progress',
    };
  });
}

export async function ensureStartupAudit(input: {
  entity_id: string;
  actor_id?: string | null;
  generated_by?: 'auto' | 'manual' | 'seed' | 'onboarding';
}): Promise<SscAuditRow | null> {
  return ensureAudit({
    audit_type: 'startup',
    entity_id: input.entity_id,
    period_key: `startup:${input.entity_id}`,
    title: `Startup Audit — ${companyName(input.entity_id)}`,
    actor_id: input.actor_id,
    generated_by: input.generated_by ?? 'onboarding',
  });
}

export async function ensureAnnualAudit(input: {
  entity_id: string;
  year?: number;
  actor_id?: string | null;
}): Promise<SscAuditRow | null> {
  const year = input.year ?? new Date().getFullYear();
  return ensureAudit({
    audit_type: 'annual',
    entity_id: input.entity_id,
    period_key: `annual:${year}`,
    title: `Annual Compliance Audit ${year} — ${companyName(input.entity_id)}`,
    due_date: `${year}-12-31`,
    actor_id: input.actor_id,
    generated_by: 'auto',
  });
}

async function ensureAudit(input: {
  audit_type: SscAuditType;
  entity_id: string;
  period_key: string;
  title: string;
  due_date?: string;
  actor_id?: string | null;
  generated_by: 'auto' | 'manual' | 'seed' | 'onboarding';
}): Promise<SscAuditRow | null> {
  try {
    const supabase = await createPersistClient();
    let auditId: string | null = null;
    const { data: existing } = await supabase
      .from('os_ssc_audits')
      .select('*')
      .eq('audit_type', input.audit_type)
      .eq('entity_id', input.entity_id)
      .eq('period_key', input.period_key)
      .maybeSingle();

    if (existing?.id) {
      auditId = existing.id as string;
    } else {
      const { data: inserted, error } = await supabase
        .from('os_ssc_audits')
        .insert({
          audit_type: input.audit_type,
          entity_id: input.entity_id,
          period_key: input.period_key,
          title: input.title,
          due_date: input.due_date ?? null,
          generated_by: input.generated_by,
        })
        .select('*')
        .single();
      if (error || !inserted?.id) return null;
      auditId = inserted.id as string;
      await supabase.from('os_ssc_audit_events').insert({
        audit_id: auditId,
        event_kind: 'created',
        actor_id: input.actor_id ?? null,
        note: `${input.audit_type} audit generated`,
      });
    }

    const items = auditItemLibrary(input.audit_type);
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]!;
      const { data: exists } = await supabase
        .from('os_ssc_audit_items')
        .select('id')
        .eq('audit_id', auditId)
        .eq('template_key', item.key)
        .maybeSingle();
      if (exists?.id) continue;
      await supabase.from('os_ssc_audit_items').insert({
        audit_id: auditId,
        template_key: item.key,
        function_key: item.function_key,
        title: item.title,
        description: item.description,
        owner_role: item.owner_role,
        risk_level: item.risk_level,
        sort_order: idx,
        status: 'not_started',
      });
    }

    return loadAuditById(auditId!);
  } catch {
    return null;
  }
}

async function loadAuditById(id: string): Promise<SscAuditRow | null> {
  try {
    const supabase = await createPersistClient();
    const { data: audit } = await supabase
      .from('os_ssc_audits')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!audit) return null;
    const { data: items } = await supabase
      .from('os_ssc_audit_items')
      .select('*')
      .eq('audit_id', id)
      .order('sort_order', { ascending: true });
    const mapped = (items ?? []).map((row) => ({
      id: String(row.id),
      audit_id: String(row.audit_id),
      template_key: String(row.template_key),
      function_key: row.function_key as SscAuditRow['items'][number]['function_key'],
      title: String(row.title),
      description: (row.description as string) ?? null,
      status: row.status as SscTaskStatus,
      owner_role: String(row.owner_role),
      risk_level: row.risk_level as SscAuditRow['items'][number]['risk_level'],
      evidence_ticket_id: (row.evidence_ticket_id as string) ?? null,
      evidence_url: (row.evidence_url as string) ?? null,
      evidence_note: (row.evidence_note as string) ?? null,
      ai_finding_draft:
        (row.ai_finding_draft as string) ??
        draftAuditFinding({
          title: String(row.title),
          company_name: companyName(audit.entity_id as string),
          status: String(row.status),
          evidence_note: (row.evidence_note as string) ?? null,
        }),
      completed_at: (row.completed_at as string) ?? null,
      completed_by: (row.completed_by as string) ?? null,
      sort_order: Number(row.sort_order ?? 0),
    }));
    const open = mapped.filter((i) => !isClosed(i.status)).length;
    const done = mapped.filter((i) => isClosed(i.status)).length;
    const pct =
      mapped.length === 0 ? 0 : Math.round((done / mapped.length) * 100);
    await supabase
      .from('os_ssc_audits')
      .update({
        open_item_count: open,
        completion_pct: pct,
        status: pct >= 100 ? 'complete' : done > 0 ? 'in_progress' : 'open',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return {
      id: String(audit.id),
      audit_type: audit.audit_type as SscAuditType,
      entity_id: String(audit.entity_id),
      company_name: companyName(audit.entity_id as string),
      period_key: String(audit.period_key),
      title: String(audit.title),
      status: String(audit.status),
      completion_pct: pct,
      open_item_count: open,
      due_date: (audit.due_date as string) ?? null,
      generated_by: String(audit.generated_by),
      items: mapped,
    };
  } catch {
    return null;
  }
}

export async function listAuditsForScope(input: {
  scope_mode: SscScopeMode;
  single_entity_id?: string | null;
  audit_type?: SscAuditType | 'all';
}): Promise<SscAuditRow[]> {
  const entityIds = resolveScopeEntityIds(
    input.scope_mode,
    input.single_entity_id,
  );
  // Ensure startup + current annual exist
  for (const entityId of entityIds) {
    await ensureStartupAudit({ entity_id: entityId });
    await ensureAnnualAudit({ entity_id: entityId });
  }
  try {
    const supabase = await createPersistClient();
    let q = supabase
      .from('os_ssc_audits')
      .select('id')
      .in('entity_id', entityIds)
      .order('created_at', { ascending: false });
    if (input.audit_type && input.audit_type !== 'all') {
      q = q.eq('audit_type', input.audit_type);
    }
    const { data } = await q;
    const out: SscAuditRow[] = [];
    for (const row of data ?? []) {
      const full = await loadAuditById(String(row.id));
      if (full) out.push(full);
    }
    return out;
  } catch {
    return [];
  }
}

export async function getSscOperatorBundle(
  query: SscOperatorQuery,
): Promise<SscOperatorBundle> {
  const offset =
    query.time_nav === 'current'
      ? query.period_offset ?? 0
      : query.time_nav === 'past'
        ? -1 - Math.abs(query.period_offset ?? 0)
        : 1 + Math.abs(query.period_offset ?? 0);
  const ref = shiftPeriod(query.period_type, new Date(), offset);
  const bounds = periodBounds(query.period_type, ref);
  const time_nav = classifyTimeNav(bounds.period_start, bounds.period_end);

  const { generated } = await ensurePeriodInstances({
    function: query.function,
    period_type: query.period_type,
    scope_mode: query.scope_mode,
    single_entity_id: query.single_entity_id,
    refDate: ref,
    include_next: query.time_nav !== 'past',
  });

  // Mark overdue via automation
  await markOverdueTasks();

  let instances: SscChecklistInstanceRow[] = [];
  let tasks: SscChecklistTaskRow[] = [];

  try {
    const supabase = await createPersistClient();
    const functions: SscFunction[] =
      query.function === 'all' ? [...SSC_FUNCTIONS] : [query.function];

    const { data: instRows } = await supabase
      .from('os_ssc_checklist_instances')
      .select('*')
      .eq('period_type', query.period_type)
      .eq('period_key', bounds.period_key)
      .eq('scope_mode', query.scope_mode)
      .in('function_key', functions);

    instances = (instRows ?? []).map((row) => ({
      id: String(row.id),
      function_key: row.function_key as SscFunction,
      period_type: row.period_type as SscPeriodType,
      period_key: String(row.period_key),
      scope_mode: row.scope_mode as SscScopeMode,
      entity_id: (row.entity_id as string) ?? null,
      company_name: row.entity_id
        ? companyName(row.entity_id as string)
        : null,
      period_start: String(row.period_start),
      period_end: String(row.period_end),
      due_at: String(row.due_at),
      status: String(row.status),
      completion_pct: Number(row.completion_pct ?? 0),
      overdue_count: Number(row.overdue_count ?? 0),
      blocked_count: Number(row.blocked_count ?? 0),
      generated_by: String(row.generated_by),
    }));

    const instanceIds = instances.map((i) => i.id);
    if (instanceIds.length) {
      const { data: taskRows } = await supabase
        .from('os_ssc_checklist_tasks')
        .select('*')
        .in('instance_id', instanceIds)
        .order('sort_order', { ascending: true });
      tasks = (taskRows ?? []).map((r) => mapTask(r as Record<string, unknown>));
    }
  } catch {
    // fail-soft empty
  }

  // Filters
  if (query.status && query.status !== 'all') {
    tasks = tasks.filter((t) => t.status === query.status);
  }
  if (query.owner_role && query.owner_role !== 'all') {
    tasks = tasks.filter((t) => t.owner_role === query.owner_role);
  }
  if (query.company_entity_id && query.company_entity_id !== 'all') {
    tasks = tasks.filter((t) => t.entity_id === query.company_entity_id);
  }
  if (query.risk === 'high_plus') {
    tasks = tasks.filter(
      (t) => t.risk_level === 'high' || t.risk_level === 'critical',
    );
  }

  // Scope company filter for multi views when single filter not set —
  // tasks already seeded only for scope entities

  const monitoring = buildMonitoring(tasks);
  const audits = await listAuditsForScope({
    scope_mode: query.scope_mode,
    single_entity_id: query.single_entity_id,
  });
  for (const m of monitoring) {
    if (m.function_key === 'all') {
      m.audit_open_items = audits.reduce((s, a) => s + a.open_item_count, 0);
    } else {
      m.audit_open_items = audits.reduce(
        (s, a) =>
          s +
          a.items.filter(
            (i) =>
              i.function_key === m.function_key && !isClosed(i.status),
          ).length,
        0,
      );
    }
  }

  const sync = await collectSubsidiarySyncHooks({
    entityIds: resolveScopeEntityIds(
      query.scope_mode,
      query.single_entity_id,
    ),
  });

  const ai = buildSscAiBriefing({
    tasks,
    monitoring,
    periodLabel: `${periodLabel(query.period_type)} ${bounds.period_key}`,
    functionFilter: query.function,
  });

  return {
    contract_version: SSC_PHASE66_CONTRACT,
    query,
    period_key: bounds.period_key,
    period_start: bounds.period_start,
    period_end: bounds.period_end,
    due_at: bounds.due_at,
    time_nav,
    instances,
    tasks,
    monitoring,
    ai,
    sync,
    audits,
    generated: generated > 0,
    money_auto_approve: false,
  };
}

export async function updateChecklistTask(input: {
  task_id: string;
  status?: SscTaskStatus;
  evidence_note?: string | null;
  evidence_ticket_id?: string | null;
  evidence_url?: string | null;
  actor_id?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createPersistClient();
    const { data: before } = await supabase
      .from('os_ssc_checklist_tasks')
      .select('*')
      .eq('id', input.task_id)
      .maybeSingle();
    if (!before) return { ok: false, error: 'Task not found' };

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.status) {
      patch.status = input.status;
      if (input.status === 'done' || input.status === 'waived') {
        patch.completed_at = new Date().toISOString();
        patch.completed_by = input.actor_id ?? null;
      }
      if (input.status === 'not_started' || input.status === 'in_progress') {
        patch.completed_at = null;
        patch.completed_by = null;
      }
    }
    if (input.evidence_note !== undefined) {
      patch.evidence_note = input.evidence_note;
    }
    if (input.evidence_ticket_id !== undefined) {
      patch.evidence_ticket_id = input.evidence_ticket_id;
    }
    if (input.evidence_url !== undefined) {
      patch.evidence_url = input.evidence_url;
    }
    if (input.status === 'done' || input.status === 'in_progress') {
      patch.automation_source = 'manual';
    }

    const { error } = await supabase
      .from('os_ssc_checklist_tasks')
      .update(patch)
      .eq('id', input.task_id);
    if (error) return { ok: false, error: error.message };

    await supabase.from('os_ssc_checklist_task_events').insert({
      task_id: input.task_id,
      instance_id: before.instance_id,
      event_kind: input.status ? 'status_change' : 'evidence',
      from_status: before.status,
      to_status: input.status ?? before.status,
      note: input.evidence_note ?? null,
      actor_id: input.actor_id ?? null,
    });

    await refreshInstanceCounts(String(before.instance_id));
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Update failed',
    };
  }
}

export async function updateAuditItem(input: {
  item_id: string;
  status?: SscTaskStatus;
  evidence_note?: string | null;
  evidence_ticket_id?: string | null;
  evidence_url?: string | null;
  actor_id?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createPersistClient();
    const { data: before } = await supabase
      .from('os_ssc_audit_items')
      .select('*')
      .eq('id', input.item_id)
      .maybeSingle();
    if (!before) return { ok: false, error: 'Audit item not found' };

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.status) {
      patch.status = input.status;
      if (input.status === 'done' || input.status === 'waived') {
        patch.completed_at = new Date().toISOString();
        patch.completed_by = input.actor_id ?? null;
      }
    }
    if (input.evidence_note !== undefined) {
      patch.evidence_note = input.evidence_note;
      patch.ai_finding_draft = draftAuditFinding({
        title: String(before.title),
        company_name: 'company',
        status: input.status ?? String(before.status),
        evidence_note: input.evidence_note,
      });
    }
    if (input.evidence_ticket_id !== undefined) {
      patch.evidence_ticket_id = input.evidence_ticket_id;
    }
    if (input.evidence_url !== undefined) {
      patch.evidence_url = input.evidence_url;
    }

    const { error } = await supabase
      .from('os_ssc_audit_items')
      .update(patch)
      .eq('id', input.item_id);
    if (error) return { ok: false, error: error.message };

    await supabase.from('os_ssc_audit_events').insert({
      audit_id: before.audit_id,
      item_id: input.item_id,
      event_kind: input.status ? 'status_change' : 'evidence',
      from_status: before.status,
      to_status: input.status ?? before.status,
      note: input.evidence_note ?? null,
      actor_id: input.actor_id ?? null,
    });
    await loadAuditById(String(before.audit_id));
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Update failed',
    };
  }
}

async function markOverdueTasks(): Promise<void> {
  try {
    const supabase = await createPersistClient();
    const today = todayStr();
    const { data } = await supabase
      .from('os_ssc_checklist_tasks')
      .select('id, instance_id, status, due_date')
      .lt('due_date', today)
      .in('status', ['not_started', 'in_progress']);
    // Events only — status stays; UI flags overdue. Optionally attach AI suggestion.
    for (const row of data ?? []) {
      await supabase
        .from('os_ssc_checklist_tasks')
        .update({
          ai_suggestion: `Overdue since ${row.due_date}. Complete or escalate via Shared Services ticket.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    }
    const instanceIds = [
      ...new Set((data ?? []).map((r) => String(r.instance_id))),
    ];
    for (const id of instanceIds) await refreshInstanceCounts(id);
  } catch {
    // fail-soft
  }
}

export async function seedAllCompanyAudits(): Promise<void> {
  for (const entityId of resolveScopeEntityIds('parent_subs')) {
    await ensureStartupAudit({ entity_id: entityId, generated_by: 'seed' });
    await ensureAnnualAudit({ entity_id: entityId });
  }
}

export function functionHomeHref(fn: SscFunction): string {
  switch (fn) {
    case 'finance':
      return '/shared-services/finance';
    case 'hr':
      return '/shared-services/hr';
    case 'it':
      return '/shared-services/it/assets';
    case 'marketing':
      return '/shared-services/marketing';
    case 'legal':
      return '/shared-services/legal/docusign';
  }
}

export { functionLabel, periodLabel };
