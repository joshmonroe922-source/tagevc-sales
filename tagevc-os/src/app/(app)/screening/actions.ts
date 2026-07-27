'use server';

import { revalidatePath } from 'next/cache';

import {
  confirmAndPlaceScreeningOrder,
  createPendingScreeningOrder,
  listScreeningOrders,
  listScreeningPackages,
  waiveScreeningOrder,
} from '@/lib/screening/repo';
import {
  canManageScreening,
  type ScreeningPackageKind,
  type ScreeningSubjectType,
} from '@/lib/screening/types';
import { getSessionContext } from '@/lib/rbac/session';

async function requireManager() {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Not authenticated.' };
  if (!canManageScreening(session.profile.role)) {
    return {
      ok: false as const,
      error: 'HR / recruiting manager role required for screening orders.',
    };
  }
  return { ok: true as const, session };
}

/** Form-action compatible (void). Errors surface via revalidate + console. */
export async function createPendingScreeningOrderAction(
  formData: FormData,
): Promise<void> {
  const gate = await requireManager();
  if (!gate.ok) {
    console.error('[screening]', gate.error);
    return;
  }

  const entityId = String(formData.get('entity_id') ?? '').trim();
  const subjectType = String(
    formData.get('subject_type') ?? '',
  ).trim() as ScreeningSubjectType;
  const subjectId = String(formData.get('subject_id') ?? '').trim();
  const kind = String(formData.get('kind') ?? 'bg').trim() as ScreeningPackageKind;
  const packageId = String(formData.get('package_id') ?? '').trim() || null;
  const hrisStepId = String(formData.get('hris_step_id') ?? '').trim() || undefined;
  const hrisRunId = String(formData.get('hris_run_id') ?? '').trim() || undefined;

  if (!entityId || !subjectType || !subjectId) {
    console.error('[screening] Missing entity / subject fields.');
    return;
  }

  const { order, error } = await createPendingScreeningOrder({
    entityId,
    subjectType,
    subjectId,
    kind,
    packageId,
    consumerRef: {
      hris_step_id: hrisStepId,
      hris_run_id: hrisRunId,
      employee_id: subjectType === 'employee' ? subjectId : undefined,
      subject_name: String(formData.get('subject_name') ?? '').trim() || undefined,
      subject_email:
        String(formData.get('subject_email') ?? '').trim() || undefined,
    },
    actorId: gate.session.profile.id,
  });
  if (error || !order) {
    console.error('[screening]', error ?? 'Create failed.');
    return;
  }
  revalidatePath('/shared-services/hr/screening');
  revalidatePath(`/shared-services/hr/employees/${subjectId}`);
}

export async function confirmScreeningOrderAction(
  formData: FormData,
): Promise<void> {
  const gate = await requireManager();
  if (!gate.ok) {
    console.error('[screening]', gate.error);
    return;
  }

  const orderId = String(formData.get('order_id') ?? '').trim();
  const confirmed = String(formData.get('human_confirm') ?? '') === '1';
  if (!orderId || !confirmed) {
    console.error('[screening] Confirm required.');
    return;
  }

  const { order, error, vendorCode } = await confirmAndPlaceScreeningOrder({
    orderId,
    actorId: gate.session.profile.id,
    subject: {
      fullName: String(formData.get('subject_name') ?? 'Subject').trim(),
      email: String(formData.get('subject_email') ?? '').trim() || undefined,
    },
    humanConfirmed: true,
  });

  if (error && !order) console.error('[screening]', error);
  else if (vendorCode === 'live_disabled') {
    console.info('[screening] LIVE=0 fail-closed — local ordered.');
  }

  revalidatePath('/shared-services/hr/screening');
  if (order?.subject_type === 'employee') {
    revalidatePath(`/shared-services/hr/employees/${order.subject_id}`);
  }
}

export async function waiveScreeningOrderAction(
  formData: FormData,
): Promise<void> {
  const gate = await requireManager();
  if (!gate.ok) {
    console.error('[screening]', gate.error);
    return;
  }

  const orderId = String(formData.get('order_id') ?? '').trim();
  const reason = String(formData.get('waiver_reason') ?? '').trim();
  if (!orderId) {
    console.error('[screening] Missing order id.');
    return;
  }

  const { order, error } = await waiveScreeningOrder({
    orderId,
    actorId: gate.session.profile.id,
    reason,
  });
  if (error || !order) {
    console.error('[screening]', error ?? 'Waive failed.');
    return;
  }
  revalidatePath('/shared-services/hr/screening');
  if (order.subject_type === 'employee') {
    revalidatePath(`/shared-services/hr/employees/${order.subject_id}`);
  }
}

export async function loadScreeningAdminData(entityId?: string) {
  const [packages, orders] = await Promise.all([
    listScreeningPackages({ activeOnly: false }),
    listScreeningOrders({
      entityId: entityId || undefined,
      limit: 80,
    }),
  ]);
  return { packages, orders };
}
