import Link from 'next/link';
import { DataCleanupClient } from '@/components/settings/data-cleanup-client';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';

export default async function DataCleanupPage() {
  await requirePermission('write:shared_services');
  const ctx = await getSessionContext();
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/settings/notifications"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Settings
        </Link>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Data cleanup
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Inventory and safely remove demo/test rows so real data connections
          can begin. Destructive actions need explicit confirmation.
        </p>
      </header>
      <DataCleanupClient canWrite={canWrite} />
    </div>
  );
}
