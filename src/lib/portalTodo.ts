import type { PortalSlug } from './types';
import { PORTAL_DEFINITIONS, getPortalDefinition } from './portals';

/** Unscoped / general tasks — Microsoft list “Tage · Personal”; not filtered into portal panels. */
export const PERSONAL_TODO_SLUG = 'personal' as const;

/** Shared capture list for header Add To Do + master /sales/todo. */
export const MASTER_TODO_SLUG = 'master' as const;

export type TodoListSlug = PortalSlug | typeof PERSONAL_TODO_SLUG | typeof MASTER_TODO_SLUG;

/** Display name for the Microsoft To Do list scoped to a portal or Personal. */
export function portalTodoListName(slug: TodoListSlug | string): string {
  if (slug === MASTER_TODO_SLUG || slug === 'master') {
    return 'Tage · Master';
  }
  if (slug === PERSONAL_TODO_SLUG || slug === 'personal') {
    return 'Tage · Personal';
  }
  const def = getPortalDefinition(slug);
  return `Tage · ${def?.name ?? slug}`;
}

export function todoListDisplayLabel(slug: TodoListSlug | string): string {
  if (slug === MASTER_TODO_SLUG || slug === 'master') return 'Master';
  if (slug === PERSONAL_TODO_SLUG || slug === 'personal') return 'Personal';
  return getPortalDefinition(slug)?.name ?? slug;
}

export function isPortalTodoListName(displayName: string): boolean {
  return displayName.trim().startsWith('Tage · ');
}

export function portalSlugFromTodoListName(
  displayName: string,
): TodoListSlug | null {
  const name = displayName.trim();
  if (!name.startsWith('Tage · ')) return null;
  const portalName = name.slice('Tage · '.length).trim();
  if (portalName.toLowerCase() === 'personal') return PERSONAL_TODO_SLUG;
  if (portalName.toLowerCase() === 'master') return MASTER_TODO_SLUG;
  const match = PORTAL_DEFINITIONS.find((p) => p.name === portalName);
  return match?.slug ?? null;
}

/** Normalize DB null / empty to personal for Graph list routing. */
export function resolveTodoPortalSlug(
  portalSlug: string | null | undefined,
): TodoListSlug {
  const s = (portalSlug ?? '').trim();
  if (!s || s === 'personal') return PERSONAL_TODO_SLUG;
  return s as TodoListSlug;
}

export const ALL_PORTAL_TODO_SLUGS: PortalSlug[] = PORTAL_DEFINITIONS.map((p) => p.slug);

/** Master To Do always includes Personal plus assigned portal lists. */
export function masterTodoSlugs(assignedPortalSlugs: PortalSlug[]): string[] {
  return [PERSONAL_TODO_SLUG, ...assignedPortalSlugs];
}
