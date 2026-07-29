import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

type Props = {
  searchParams?: Promise<{ entity?: string }>;
};

/**
 * Tage VC A&F hub — in-portal accounting & finance scaffold
 * (replacing / moving off Intuit Enterprise Suites dependency).
 */
export default async function TageVcAfHubPage({ searchParams }: Props) {
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
        title="Tage VC A&F"
        context={entityId ? `Entity · ${entityId}` : firmWide ? 'Firm-wide' : undefined}
        description="In-house accounting and finance for Tage VC — scaffold only. Modules land under Accounting and Finance."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`/shared-services/af/accounting${qs}`}
          className="rounded-lg border border-border px-4 py-5 transition-colors hover:bg-muted/40"
        >
          <p className="font-heading text-lg font-semibold text-[#3a414f]">
            Accounting
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Books · close · GL · subsidiary ledgers (coming soon).
          </p>
        </Link>
        <Link
          href={`/shared-services/af/finance${qs}`}
          className="rounded-lg border border-border px-4 py-5 transition-colors hover:bg-muted/40"
        >
          <p className="font-heading text-lg font-semibold text-[#3a414f]">
            Finance
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cash · planning · KPIs · capital (coming soon).
          </p>
        </Link>
      </div>

      <EmptyState
        title="Scaffold only"
        description="This is the starting nav for the in-portal A&F system. Existing IES Finance desk remains under Shared Services → Finance until cutover."
      />
    </div>
  );
}
