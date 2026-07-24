import Link from 'next/link';
import { HrisRunsQueueClient } from '@/components/shared-services/hris-runs-queue-client';
import { listRuns } from '@/lib/hris/runs';
import { requirePermission } from '@/lib/rbac/session';

export default async function HrisOnboardingQueuePage() {
  await requirePermission('read:shared_services');
  const { rows, error } = await listRuns({
    kind: 'onboarding',
    limit: 80,
  });
  const open = rows.filter((r) =>
    ['open', 'in_progress', 'blocked'].includes(r.status),
  );

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
          Onboarding
        </h1>
      </header>
      <HrisRunsQueueClient kind="onboarding" runs={open} error={error} />
    </div>
  );
}
