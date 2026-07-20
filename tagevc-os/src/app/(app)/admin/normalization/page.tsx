import Link from 'next/link';
import { NormalizationHealthPanel } from '@/components/admin/normalization-health';
import { getNormalizationStatus } from '@/lib/data/normalization-status';
import { requirePermission } from '@/lib/rbac/session';

export default async function NormalizationAdminPage() {
  await requirePermission('admin:users');
  const status = await getNormalizationStatus();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Admin
        </Link>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Normalization health
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Write cutover gates, sync health, snapshot archive status. Visionary /
          Admin only.
        </p>
      </header>

      <NormalizationHealthPanel status={status} />
    </div>
  );
}
