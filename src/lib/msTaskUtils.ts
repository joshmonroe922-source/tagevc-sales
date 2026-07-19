import type { TodoTask } from './calendarApi';
import { formatDateTime } from './types';

export const PLAN_STORAGE_KEY = 'ms_planner_plan_id';

export function dueDateInputValue(due: string | null | undefined): string {
  if (!due) return '';
  const m = due.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? '';
}

const TODO_IMPORTANCE_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

/** Day buckets first (overdue → today → later → no due), then importance within day, then title / created. */
export function sortTodoTasks(tasks: TodoTask[]): TodoTask[] {
  return [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;

    const aDue = a.due ? dueDateInputValue(a.due) || a.due : '';
    const bDue = b.due ? dueDateInputValue(b.due) || b.due : '';
    if (aDue !== bDue) {
      if (!aDue) return 1;
      if (!bDue) return -1;
      return aDue < bDue ? -1 : aDue > bDue ? 1 : 0;
    }

    const ai = TODO_IMPORTANCE_RANK[(a.importance ?? 'normal').toLowerCase()] ?? 1;
    const bi = TODO_IMPORTANCE_RANK[(b.importance ?? 'normal').toLowerCase()] ?? 1;
    if (ai !== bi) return ai - bi;

    const titleCmp = (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
    if (titleCmp !== 0) return titleCmp;

    const aCreated = a.created_at ?? '';
    const bCreated = b.created_at ?? '';
    if (aCreated !== bCreated) return aCreated < bCreated ? -1 : aCreated > bCreated ? 1 : 0;

    return a.id.localeCompare(b.id);
  });
}

export function formatTodoDue(due: string | null | undefined): string {
  if (!due) return '';
  const day = dueDateInputValue(due);
  if (!day) return formatDateTime(due);
  try {
    return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return formatDateTime(due);
  }
}

export function importanceLabel(importance: string | null | undefined): string {
  const v = (importance ?? 'normal').toLowerCase();
  if (v === 'high') return 'High';
  if (v === 'low') return 'Low';
  return 'Normal';
}

export function loadStoredPlanId(): string {
  try {
    return localStorage.getItem(PLAN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveStoredPlanId(id: string): void {
  try {
    localStorage.setItem(PLAN_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
