import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

type Props = {
  searchParams?: Promise<{ entity?: string }>;
};

/** Tage VC A&F → Accounting placeholder. */
export default async function TageVcAfAccountingPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');

  const params = (await searchParams) ?? {};
  const entityParam = params.entity?.trim() ?? '';
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  const entityId = firmWide
    ? entityParam || null
    : (ctx?.profile.entity_id ?? (entityParam || null));
  const qs = entityId ? `?entity=${encodeURIComponent(entityId)}` : '';

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Shared Services · Tage VC A&F"
        title="Accounting"
        context={entityId ? `Entity · ${entityId}` : firmWide ? 'Firm-wide' : undefined}
        description="In-portal accounting workspace. Placeholder — modules will land here."
        secondaryActions={
          <Link
            href={`/shared-services/af${qs}`}
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            ← Tage VC A&F
          </Link>
        }
      />

      <EmptyState
        title="Accounting coming soon"
        description="GL, close, and subsidiary books will live here as the in-house A&F system replaces IES."
      />
    </div>
  );
}
