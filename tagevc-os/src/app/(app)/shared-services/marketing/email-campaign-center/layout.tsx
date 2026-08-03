import { EccShell } from '@/components/campaign/ecc-shell';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { entityDisplayName } from '@/lib/entities/display-name';

export default async function EccLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <EccShell entityLabel={entityDisplayName(entityId)}>{children}</EccShell>
    </div>
  );
}
