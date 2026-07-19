import {
  completeTodoTask,
  createTodoTask,
  fetchCalendarStatus,
  type TodoImportance,
} from './calendarApi';
import { PERSONAL_TODO_SLUG, resolveTodoPortalSlug } from './portalTodo';
import { requireSupabase } from './supabase';
import type { SalesTask, TaskStatus } from './types';

export type FollowUpSyncResult = {
  task: SalesTask;
  synced: boolean;
  syncError?: string;
};

function normalizeImportance(
  raw: string | null | undefined,
): TodoImportance {
  const v = (raw ?? 'normal').toLowerCase();
  if (v === 'low' || v === 'high' || v === 'normal') return v;
  return 'normal';
}

/** Push a sales follow-up into the matching Tage · {Portal|Personal} To Do list. */
export async function syncFollowUpCreatedToMs(
  task: SalesTask,
): Promise<FollowUpSyncResult> {
  try {
    const status = await fetchCalendarStatus();
    if (!status.connected || !status.capabilities?.todo) {
      return {
        task,
        synced: false,
        syncError: 'Microsoft To Do not connected — task saved locally only.',
      };
    }

    const portalSlug = resolveTodoPortalSlug(task.portal_slug);
    const leadHint = task.sales_leads
      ? `\n\nDeal: ${task.sales_leads.name}${
          task.sales_leads.company ? ` · ${task.sales_leads.company}` : ''
        }`
      : '';
    const body = `${task.notes || ''}${leadHint}`.trim() || undefined;

    const res = await createTodoTask({
      title: task.title,
      body,
      due: task.due_at ?? undefined,
      importance: normalizeImportance(task.importance),
      portal_slug: portalSlug,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });

    const { data, error } = await requireSupabase()
      .from('sales_tasks')
      .update({
        portal_slug: portalSlug === PERSONAL_TODO_SLUG ? PERSONAL_TODO_SLUG : portalSlug,
        ms_todo_list_id: res.list_id,
        ms_todo_task_id: res.task.id,
      })
      .eq('id', task.id)
      .select('*, sales_leads(id, name, company)')
      .single();

    if (error || !data) {
      return {
        task,
        synced: false,
        syncError:
          error?.message ??
          'Created in Microsoft To Do but failed to store sync ids locally.',
      };
    }
    return { task: data as SalesTask, synced: true };
  } catch (err) {
    return {
      task,
      synced: false,
      syncError: err instanceof Error ? err.message : 'To Do sync failed',
    };
  }
}

/** Soft-complete the Graph task linked to a follow-up. */
export async function syncFollowUpStatusToMs(
  task: Pick<SalesTask, 'ms_todo_list_id' | 'ms_todo_task_id' | 'portal_slug'>,
  status: TaskStatus,
): Promise<void> {
  if (!task.ms_todo_list_id || !task.ms_todo_task_id) return;
  if (status !== 'done') return;
  try {
    const cal = await fetchCalendarStatus();
    if (!cal.connected || !cal.capabilities?.todo) return;
    const portalSlug = resolveTodoPortalSlug(task.portal_slug);
    await completeTodoTask(task.ms_todo_list_id, task.ms_todo_task_id, portalSlug);
  } catch {
    /* soft-fail complete */
  }
}
