import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext } from '@/lib/rbac/session';

/** Resolve entity query for A&F pages (firm-wide can switch). */
export async function resolveAfEntityParam(
  searchParams?: Promise<{ entity?: string }> | { entity?: string },
) {
  const params = (await searchParams) ?? {};
  const entityParam =
    typeof params.entity === 'string' ? params.entity.trim() : '';
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  const entityId = firmWide
    ? entityParam || null
    : (ctx?.profile.entity_id ?? (entityParam || null));
  const qs = entityId ? `?entity=${encodeURIComponent(entityId)}` : '';
  return { entityId, firmWide, qs, entityParam };
}
