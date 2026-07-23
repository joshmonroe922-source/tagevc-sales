'use server';

import { revalidatePath } from 'next/cache';
import {
  PHASE61_FIRM_OPS_CONTRACT_VERSION,
  type FirmOpsCommandPhase61Report,
} from '@/lib/firm-ops/firm-ops-command-phase61';
import {
  getFirmOpsCommandPhase61Report,
  refreshFirmOpsCommandPhase61,
} from '@/lib/firm-ops/firm-ops-command-phase61-server';
import { guardPermission } from '@/lib/rbac/session';

export type FirmOpsCommandPhase61ActionResult =
  | {
      ok: true;
      report: FirmOpsCommandPhase61Report;
      summary?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
      report: FirmOpsCommandPhase61Report;
    };

export async function refreshFirmOpsCommandPhase61Action(
  entityId?: string | null,
): Promise<FirmOpsCommandPhase61ActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) {
    return {
      ok: false,
      error: gate.error,
      report: await getFirmOpsCommandPhase61Report({
        entityId: entityId ?? null,
      }),
    };
  }

  const result = await refreshFirmOpsCommandPhase61({
    actorId: gate.profile.id,
    entityId: entityId ?? null,
  });

  revalidatePath('/command-center');
  revalidatePath('/shared-services');
  revalidatePath('/portfolio');

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      report: result.report,
    };
  }

  return {
    ok: true,
    report: result.report,
    summary: {
      ...result.summary,
      contract_version: PHASE61_FIRM_OPS_CONTRACT_VERSION,
      money_auto_approve: false,
    },
  };
}
