import Link from 'next/link';
import { HrisManagerClient } from '@/components/shared-services/hris-manager-client';
import { listManagerAssignedBundles } from '@/lib/hris/manager-view';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

export default async function HrisManagerPage() {
  await requirePermission('read:shared_services');
  const ctx = await getSessionContext();
  const profileId = ctx?.profile.id;
  const { rows, error } = profileId
    ? await listManagerAssignedBundles(profileId)
    : { rows: [], error: 'Not authenticated' };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/shared-services/hr"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← HR operations
        </Link>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Manager self-service
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Complete manager-owned onboarding and offboarding steps for your
          assigned employees. Compensation, Visionary audit, and unrelated HR
          areas are not shown here.
        </p>
      </header>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <HrisManagerClient bundles={rows} />
    </div>
  );
}
