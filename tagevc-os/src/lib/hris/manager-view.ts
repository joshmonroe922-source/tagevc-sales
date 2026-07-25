/**
 * Manager self-service — assigned employees’ manager-owned steps only.
 * No Visionary audit, no compensation, no unrelated HR-sensitive areas.
 */

import {
  listEmployees,
  redactEmployeeComp,
} from '@/lib/hris/employees';
import { filterManagerVisibleSteps } from '@/lib/hris/access';
import { listRunsForEmployee } from '@/lib/hris/runs';
import type { HrisEmployee, HrisProcessRun, HrisProcessStep } from '@/lib/hris/types';

export type ManagerEmployeeBundle = {
  employee: HrisEmployee;
  runs: Array<
    HrisProcessRun & {
      manager_steps: HrisProcessStep[];
    }
  >;
};

export async function listManagerAssignedBundles(
  managerProfileId: string,
): Promise<{ rows: ManagerEmployeeBundle[]; error?: string }> {
  const { rows, error } = await listEmployees({
    managerProfileId,
    limit: 100,
  });
  if (error) return { rows: [], error };

  const bundles: ManagerEmployeeBundle[] = [];
  for (const emp of rows) {
    const runs = await listRunsForEmployee(emp.id);
    bundles.push({
      employee: redactEmployeeComp(emp),
      runs: runs
        .filter((r) => ['open', 'in_progress', 'blocked'].includes(r.status))
        .map((r) => ({
          ...r,
          manager_steps: filterManagerVisibleSteps(r.steps ?? []),
          // Do not expose full step list to manager client
          steps: undefined,
        })),
    });
  }
  return { rows: bundles };
}
