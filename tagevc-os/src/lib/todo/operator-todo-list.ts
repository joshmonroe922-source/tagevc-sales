/**
 * Operator To Do List — aggregates SSC checklist work + deal/lead follow-ups.
 * Explicitly excludes Help Desk / Shared Services ticket queues.
 */

import {
  listTasksForDeal,
  listOpenLeadTasks,
} from '@/lib/data/deal-flow-store';
import { listTasksForMa } from '@/lib/data/ma-store';
import {
  listScopedActiveDeals,
  listScopedActiveLeads,
  listScopedActiveMaTargets,
  listScopedActiveReDeals,
  listScopedOpenLeadTasks,
} from '@/lib/data/pipeline-scope';
import { listTasksForRe } from '@/lib/data/re-store';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import {
  isSscScopedRole,
  SSC_ROLE_PRIMARY_NAV_LABEL,
  type SscNavFunctionLabel,
} from '@/lib/rbac/ssc-roles';
import type { SessionContext } from '@/lib/rbac/session';
import { getSscFunctionHomeGlance } from '@/lib/shared-services/ssc-checklist/function-home-glance';
import {
  SSC_FUNCTIONS,
  type SscFunction,
} from '@/lib/shared-services/ssc-checklist/types';
import { roleHasPermission, type AppRole } from '@/lib/types/roles';

export type OperatorTodoSource =
  | 'ssc_checklist'
  | 'lead_task'
  | 'deal_task'
  | 'ma_task'
  | 're_task'
  | 'lead_followup'
  | 'deal_followup'
  | 'ma_followup'
  | 're_followup';

export type OperatorTodoItem = {
  id: string;
  source: OperatorTodoSource;
  source_label: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  due_date: string | null;
  href: string;
  is_overdue: boolean;
};

export type OperatorTodoList = {
  items: OperatorTodoItem[];
  counts: {
    total: number;
    ssc: number;
    pipeline: number;
    followups: number;
  };
};

const SOURCE_LABEL: Record<OperatorTodoSource, string> = {
  ssc_checklist: 'SSC checklist',
  lead_task: 'Lead task',
  deal_task: 'Deal task',
  ma_task: 'M&A task',
  re_task: 'RE task',
  lead_followup: 'Lead follow-up',
  deal_followup: 'Deal follow-up',
  ma_followup: 'M&A follow-up',
  re_followup: 'RE follow-up',
};

const NAV_LABEL_TO_FUNCTION: Record<SscNavFunctionLabel, SscFunction> = {
  Finance: 'finance',
  HR: 'hr',
  IT: 'it',
  Marketing: 'marketing',
  Legal: 'legal',
};

function openTaskStatus(status: string): boolean {
  return (
    status !== 'Completed' &&
    status !== 'Resolved' &&
    status !== 'Closed' &&
    status !== 'done' &&
    status !== 'waived'
  );
}

function todayStr(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isOverdue(due: string | null | undefined, today: string): boolean {
  if (!due) return false;
  return due.slice(0, 10) < today;
}

/** Urgency: overdue first, then earliest due, then title. */
export function compareOperatorTodos(
  a: Pick<OperatorTodoItem, 'is_overdue' | 'due_date' | 'title'>,
  b: Pick<OperatorTodoItem, 'is_overdue' | 'due_date' | 'title'>,
): number {
  if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
  const ad = a.due_date?.slice(0, 10) || '9999-12-31';
  const bd = b.due_date?.slice(0, 10) || '9999-12-31';
  if (ad !== bd) return ad.localeCompare(bd);
  return a.title.localeCompare(b.title);
}

export function sscFunctionsForRole(role: AppRole): SscFunction[] {
  if (isSscScopedRole(role)) {
    const label = SSC_ROLE_PRIMARY_NAV_LABEL[role];
    if (!label) return [];
    return [NAV_LABEL_TO_FUNCTION[label]];
  }
  return [...SSC_FUNCTIONS];
}

function checklistHref(functionKey: SscFunction, entityId: string | null) {
  const qs = new URLSearchParams({
    function: functionKey,
    scope: entityId ? 'single' : 'parent_subs',
    period: 'monthly',
    time: 'active',
  });
  if (entityId) qs.set('entity', entityId);
  return `/shared-services/checklists?${qs.toString()}`;
}

async function collectSscTodos(
  session: SessionContext,
  today: string,
): Promise<OperatorTodoItem[]> {
  const role = session.profile.role;
  if (!roleHasPermission(role, 'read:shared_services')) return [];

  const firmWide = isFirmWideAccess(role, session.profile.entity_id);
  const entityId = firmWide ? null : (session.profile.entity_id ?? null);
  const functions = sscFunctionsForRole(role);
  const out: OperatorTodoItem[] = [];

  await Promise.all(
    functions.map(async (fn) => {
      const glance = await getSscFunctionHomeGlance({
        functionKey: fn,
        entityId,
        limit: 50,
      });
      for (const t of glance.open_tasks) {
        out.push({
          id: `ssc:${t.id}`,
          source: 'ssc_checklist',
          source_label: SOURCE_LABEL.ssc_checklist,
          title: t.title,
          subtitle: `${fn.toUpperCase()} · ${t.company_name}`,
          status: t.status,
          due_date: t.due_date,
          href: checklistHref(fn, t.entity_id),
          is_overdue: t.is_overdue || isOverdue(t.due_date, today),
        });
      }
    }),
  );

  return out;
}

async function collectPipelineTodos(
  session: SessionContext,
  today: string,
): Promise<OperatorTodoItem[]> {
  const role = session.profile.role;
  const out: OperatorTodoItem[] = [];

  if (roleHasPermission(role, 'read:vc_pipeline')) {
    const [leadTasks, leads, deals] = await Promise.all([
      listScopedOpenLeadTasks().catch(() => listOpenLeadTasks()),
      listScopedActiveLeads().catch(() => []),
      listScopedActiveDeals().catch(() => []),
    ]);

    for (const t of leadTasks) {
      if (!openTaskStatus(t.status)) continue;
      out.push({
        id: `lead-task:${t.task_id}`,
        source: 'lead_task',
        source_label: SOURCE_LABEL.lead_task,
        title: t.title,
        subtitle: t.company_name,
        status: t.status,
        due_date: t.due_date,
        href: `/deal-flow/vc/leads/${t.lead_id}`,
        is_overdue: isOverdue(t.due_date, today),
      });
    }

    for (const lead of leads) {
      if (!lead.next_action) continue;
      out.push({
        id: `lead-fu:${lead.lead_id}`,
        source: 'lead_followup',
        source_label: SOURCE_LABEL.lead_followup,
        title: lead.next_action,
        subtitle: `${lead.company_name} · ${lead.stage}`,
        status: lead.stage,
        due_date: lead.next_action_date,
        href: `/deal-flow/vc/leads/${lead.lead_id}`,
        is_overdue: isOverdue(lead.next_action_date, today),
      });
    }

    for (const deal of deals) {
      for (const t of listTasksForDeal(deal.deal_id)) {
        if (!openTaskStatus(t.status)) continue;
        out.push({
          id: `deal-task:${t.task_id}`,
          source: 'deal_task',
          source_label: SOURCE_LABEL.deal_task,
          title: t.title,
          subtitle: deal.company_name,
          status: t.status,
          due_date: t.due_date,
          href: `/deal-flow/vc/deals/${deal.deal_id}`,
          is_overdue: isOverdue(t.due_date, today),
        });
      }
      if (deal.next_action) {
        out.push({
          id: `deal-fu:${deal.deal_id}`,
          source: 'deal_followup',
          source_label: SOURCE_LABEL.deal_followup,
          title: deal.next_action,
          subtitle: `${deal.company_name} · ${deal.exec_stage}`,
          status: deal.exec_stage,
          due_date: null,
          href: `/deal-flow/vc/deals/${deal.deal_id}`,
          is_overdue: false,
        });
      }
    }
  }

  if (roleHasPermission(role, 'read:ma_pipeline')) {
    const targets = await listScopedActiveMaTargets().catch(() => []);
    for (const target of targets) {
      for (const t of listTasksForMa(target.ma_id)) {
        if (!openTaskStatus(t.status)) continue;
        out.push({
          id: `ma-task:${t.task_id}`,
          source: 'ma_task',
          source_label: SOURCE_LABEL.ma_task,
          title: t.title,
          subtitle: target.company_name,
          status: t.status,
          due_date: t.due_date,
          href: `/deal-flow/ma/${target.ma_id}`,
          is_overdue: isOverdue(t.due_date, today),
        });
      }
      if (target.next_action) {
        out.push({
          id: `ma-fu:${target.ma_id}`,
          source: 'ma_followup',
          source_label: SOURCE_LABEL.ma_followup,
          title: target.next_action,
          subtitle: `${target.company_name} · ${target.stage}`,
          status: target.stage,
          due_date: target.next_action_date,
          href: `/deal-flow/ma/${target.ma_id}`,
          is_overdue: isOverdue(target.next_action_date, today),
        });
      }
    }
  }

  if (roleHasPermission(role, 'read:re_pipeline')) {
    const deals = await listScopedActiveReDeals().catch(() => []);
    for (const deal of deals) {
      for (const t of listTasksForRe(deal.re_id)) {
        if (!openTaskStatus(t.status)) continue;
        out.push({
          id: `re-task:${t.task_id}`,
          source: 're_task',
          source_label: SOURCE_LABEL.re_task,
          title: t.title,
          subtitle: deal.asset_name,
          status: t.status,
          due_date: t.due_date,
          href: `/deal-flow/re/${deal.re_id}`,
          is_overdue: isOverdue(t.due_date, today),
        });
      }
      if (deal.next_action) {
        out.push({
          id: `re-fu:${deal.re_id}`,
          source: 're_followup',
          source_label: SOURCE_LABEL.re_followup,
          title: deal.next_action,
          subtitle: `${deal.asset_name} · ${deal.stage}`,
          status: deal.stage,
          due_date: deal.next_action_date,
          href: `/deal-flow/re/${deal.re_id}`,
          is_overdue: isOverdue(deal.next_action_date, today),
        });
      }
    }
  }

  return out;
}

export function summarizeOperatorTodos(
  items: OperatorTodoItem[],
): OperatorTodoList {
  const sorted = items.slice().sort(compareOperatorTodos);
  const ssc = sorted.filter((i) => i.source === 'ssc_checklist').length;
  const followups = sorted.filter((i) =>
    i.source.endsWith('_followup'),
  ).length;
  const pipeline = sorted.length - ssc - followups;
  return {
    items: sorted,
    counts: {
      total: sorted.length,
      ssc,
      pipeline,
      followups,
    },
  };
}

/**
 * Build the operator To Do List. Never includes Help Desk tickets.
 */
export async function loadOperatorTodoList(
  session: SessionContext,
): Promise<OperatorTodoList> {
  const today = todayStr();
  const [ssc, pipeline] = await Promise.all([
    collectSscTodos(session, today),
    collectPipelineTodos(session, today),
  ]);
  return summarizeOperatorTodos([...ssc, ...pipeline]);
}
