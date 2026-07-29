'use server';

import { revalidatePath } from 'next/cache';
import {
  setPeriodLockMode,
  snapshotClosePeriod,
  type EntityCode,
} from '@/lib/af';
import { requirePermission } from '@/lib/rbac/session';

export async function snapshotPeriodAction(input: {
  entityCode: EntityCode | 'CONSOL';
  period?: string;
}) {
  await requirePermission('write:shared_services');
  const snap = snapshotClosePeriod({
    entityCode: input.entityCode,
    period: input.period,
    actor: 'portal',
  });
  revalidatePath('/shared-services/af/accounting/close');
  revalidatePath('/shared-services/af/audit/workspace');
  return { ok: true as const, snapshotId: snap.id };
}

export async function setPeriodLockAction(input: {
  entityCode: EntityCode | 'CONSOL';
  mode: 'soft' | 'hard' | 'reopen';
  period?: string;
}) {
  await requirePermission('write:shared_services');
  setPeriodLockMode({
    entityCode: input.entityCode,
    mode: input.mode,
    period: input.period,
    actor: 'portal',
  });
  revalidatePath('/shared-services/af/accounting/close');
  return { ok: true as const };
}
