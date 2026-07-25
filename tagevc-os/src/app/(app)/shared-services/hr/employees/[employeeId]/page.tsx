import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HrisEmployeeDetailClient } from '@/components/shared-services/hris-employee-detail-client';
import { canViewHrisCompensation } from '@/lib/hris/access';
import { listEmployeeDocuments } from '@/lib/hris/documents';
import {
  getEmployee,
  listEmployeeEvents,
  listEmployeeLinks,
  redactEmployeeComp,
} from '@/lib/hris/employees';
import { getActiveManagerProfile } from '@/lib/hris/people';
import { listRunsForEmployee } from '@/lib/hris/runs';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';

type Props = { params: Promise<{ employeeId: string }> };

export default async function HrisEmployeePage({ params }: Props) {
  await requirePermission('read:shared_services');
  const { employeeId } = await params;
  const ctx = await getSessionContext();
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;
  const canViewComp = ctx
    ? canViewHrisCompensation(ctx.profile.role)
    : false;

  const { employee: raw, error } = await getEmployee(employeeId);
  if (!raw) notFound();
  const employee = canViewComp ? raw : redactEmployeeComp(raw);

  const [runs, events, links, docs, managerProfile] = await Promise.all([
    listRunsForEmployee(employee.id),
    listEmployeeEvents(employee.id),
    listEmployeeLinks(employee.id),
    listEmployeeDocuments(employee.id),
    employee.manager_profile_id
      ? getActiveManagerProfile(employee.manager_profile_id)
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/shared-services/hr/employees"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Employees
        </Link>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {employee.full_name}
        </h1>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
      </header>
      <HrisEmployeeDetailClient
        employee={employee}
        runs={runs}
        events={events}
        links={links}
        documents={docs.rows}
        canWrite={canWrite}
        canViewComp={canViewComp}
        managerProfile={managerProfile}
      />
    </div>
  );
}
