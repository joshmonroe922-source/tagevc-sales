import Link from 'next/link';
import { HrisDirectoryClient } from '@/components/shared-services/hris-directory-client';
import { listEmployees } from '@/lib/hris/employees';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';

export default async function HrisEmployeesPage() {
  await requirePermission('read:shared_services');
  const ctx = await getSessionContext();
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;
  const { rows, error } = await listEmployees({ limit: 200 });

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
          Employees
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          HRIS directory — profiles, company assignment, onboarding and
          offboarding progress.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/shared-services/hr/onboarding"
            className="underline-offset-4 hover:underline"
          >
            Onboarding queue
          </Link>
          <Link
            href="/shared-services/hr/offboarding"
            className="underline-offset-4 hover:underline"
          >
            Offboarding queue
          </Link>
        </div>
      </header>
      <HrisDirectoryClient
        employees={rows}
        canWrite={canWrite}
        error={error}
      />
    </div>
  );
}
