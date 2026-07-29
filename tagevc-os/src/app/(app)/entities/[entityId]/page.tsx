import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EntityOperatingViewPanel } from '@/components/entity-os/entity-operating-view';
import { Badge } from '@/components/ui/badge';
import { getEntityOperatingView } from '@/lib/data/entity-os';
import { listBusinessCreditProfiles } from '@/lib/net-worth/credit';
import {
  canAccessPersonalSection,
  canViewBusinessCredit,
} from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';
import { onCompanyOnboardedToSsc } from '@/lib/shared-services/ssc-checklist/engine';

type Props = { params: Promise<{ entityId: string }> };

export default async function EntityOsPage({ params }: Props) {
  const { entityId } = await params;
  const view = await getEntityOperatingView(entityId);
  if (!view) notFound();

  // Additive: ensure startup + annual SSC audits when a company is opened
  try {
    await onCompanyOnboardedToSsc({ entity_id: entityId });
  } catch {
    // fail-soft
  }

  const ctx = await getSessionContext();
  let creditChip: { status: string; href: string } | null = null;
  if (
    ctx &&
    canAccessPersonalSection({
      role: ctx.profile.role,
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    }) &&
    canViewBusinessCredit(ctx.profile.role)
  ) {
    const { rows } = await listBusinessCreditProfiles({
      entityId,
      auditAccess: false,
    });
    const row = rows[0];
    creditChip = {
      status: row?.duns_status ?? 'not_started',
      href: `/personal/credit?entity=${encodeURIComponent(entityId)}`,
    };
  }

  return (
    <div className="space-y-4">
      {creditChip ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Business credit</span>
          <Badge variant="outline">DUNS {creditChip.status}</Badge>
          <Link
            href={creditChip.href}
            className="underline-offset-4 hover:underline"
          >
            Manage →
          </Link>
        </div>
      ) : null}
      <EntityOperatingViewPanel view={view} />
    </div>
  );
}
