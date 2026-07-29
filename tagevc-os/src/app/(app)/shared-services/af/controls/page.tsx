import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

type Props = {
  searchParams?: Promise<{ entity?: string }>;
};

/** Tage VC A&F → Controls, Security & Governance placeholder. */
export default async function TageVcAfControlsPage({ searchParams }: Props) {
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
        title="Controls, Security & Governance"
        context={entityId ? `Entity · ${entityId}` : firmWide ? 'Firm-wide' : undefined}
        description="In-portal controls, security, and governance workspace. Placeholder — frameworks and evidence will land here."
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
        title="Controls, Security & Governance coming soon"
        description="Control catalogs, security posture, and governance evidence will live here as the in-house A&F system expands."
      />
    </div>
  );
}
