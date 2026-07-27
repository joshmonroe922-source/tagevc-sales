/**
 * Screening spine repository — packages + orders on Tage UDL.
 */

import { randomUUID } from 'crypto';

import { createBroadcastNotification } from '@/lib/data/activity';
import { createClient } from '@/lib/supabase/server';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  mapVendorStatusToSpine,
  spineStatusToBgScreen,
  type ScreeningConsumerRef,
  type ScreeningOrder,
  type ScreeningOrderStatus,
  type ScreeningPackage,
  type ScreeningPackageKind,
  type ScreeningSubjectType,
} from '@/lib/screening/types';
import { placeVerifiedFirstOrder } from '@/lib/screening/vendor';

function mapPackage(row: Record<string, unknown>): ScreeningPackage {
  return {
    id: String(row.id),
    vendor: 'verified_first',
    code: String(row.code),
    name: String(row.name),
    kind: row.kind as ScreeningPackageKind,
    description: String(row.description ?? ''),
    vendor_package_id: String(row.vendor_package_id ?? ''),
    active: Boolean(row.active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapOrder(row: Record<string, unknown>): ScreeningOrder {
  return {
    id: String(row.id),
    vendor: 'verified_first',
    external_order_id: (row.external_order_id as string | null) ?? null,
    subject_type: row.subject_type as ScreeningSubjectType,
    subject_id: String(row.subject_id),
    entity_id: String(row.entity_id),
    package_id: (row.package_id as string | null) ?? null,
    package_code: String(row.package_code ?? ''),
    kind: row.kind as ScreeningPackageKind,
    status: row.status as ScreeningOrderStatus,
    ordered_by: (row.ordered_by as string | null) ?? null,
    ordered_at: (row.ordered_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    report_storage_path: (row.report_storage_path as string | null) ?? null,
    raw_status: (row.raw_status as string | null) ?? null,
    last_sync_at: (row.last_sync_at as string | null) ?? null,
    consumer_ref: (row.consumer_ref as ScreeningConsumerRef) ?? {},
    confirm_token: (row.confirm_token as string | null) ?? null,
    confirmed_at: (row.confirmed_at as string | null) ?? null,
    waiver_reason: (row.waiver_reason as string | null) ?? null,
    waived_by: (row.waived_by as string | null) ?? null,
    waived_at: (row.waived_at as string | null) ?? null,
    notes: String(row.notes ?? ''),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listScreeningPackages(opts?: {
  activeOnly?: boolean;
  kind?: ScreeningPackageKind;
}): Promise<{ packages: ScreeningPackage[]; error?: string }> {
  const supabase = await createClient();
  let q = supabase
    .from('os_screening_packages')
    .select('*')
    .eq('vendor', 'verified_first')
    .order('kind')
    .order('name');
  if (opts?.activeOnly !== false) q = q.eq('active', true);
  if (opts?.kind) q = q.eq('kind', opts.kind);
  const { data, error } = await q;
  if (error) return { packages: [], error: error.message };
  return {
    packages: ((data ?? []) as Record<string, unknown>[]).map(mapPackage),
  };
}

export async function getScreeningPackage(
  idOrCode: string,
): Promise<{ package: ScreeningPackage | null; error?: string }> {
  const supabase = await createClient();
  const byId = await supabase
    .from('os_screening_packages')
    .select('*')
    .eq('id', idOrCode)
    .maybeSingle();
  if (byId.data) {
    return { package: mapPackage(byId.data as Record<string, unknown>) };
  }
  const byCode = await supabase
    .from('os_screening_packages')
    .select('*')
    .eq('code', idOrCode)
    .maybeSingle();
  if (byCode.error) return { package: null, error: byCode.error.message };
  return {
    package: byCode.data
      ? mapPackage(byCode.data as Record<string, unknown>)
      : null,
  };
}

export async function listScreeningOrders(filters?: {
  entityId?: string;
  status?: ScreeningOrderStatus | ScreeningOrderStatus[];
  subjectType?: ScreeningSubjectType;
  subjectId?: string;
  limit?: number;
}): Promise<{ orders: ScreeningOrder[]; error?: string }> {
  const supabase = await createClient();
  let q = supabase
    .from('os_screening_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters?.limit ?? 100);
  if (filters?.entityId) q = q.eq('entity_id', filters.entityId);
  if (filters?.subjectType) q = q.eq('subject_type', filters.subjectType);
  if (filters?.subjectId) q = q.eq('subject_id', filters.subjectId);
  if (filters?.status) {
    if (Array.isArray(filters.status)) q = q.in('status', filters.status);
    else q = q.eq('status', filters.status);
  }
  const { data, error } = await q;
  if (error) return { orders: [], error: error.message };
  return {
    orders: ((data ?? []) as Record<string, unknown>[]).map(mapOrder),
  };
}

export async function getScreeningOrder(
  orderId: string,
): Promise<{ order: ScreeningOrder | null; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('os_screening_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) return { order: null, error: error.message };
  return {
    order: data ? mapOrder(data as Record<string, unknown>) : null,
  };
}

export type CreateScreeningOrderInput = {
  entityId: string;
  subjectType: ScreeningSubjectType;
  subjectId: string;
  kind: ScreeningPackageKind;
  packageId?: string | null;
  packageCode?: string;
  consumerRef?: ScreeningConsumerRef;
  notes?: string;
  actorId?: string | null;
};

/** Create a pending (ready-to-order) spine row — does not call vendor. */
export async function createPendingScreeningOrder(
  input: CreateScreeningOrderInput,
): Promise<{ order: ScreeningOrder | null; error?: string }> {
  const supabase = await createClient();
  let packageCode = input.packageCode?.trim() || '';
  let packageId = input.packageId ?? null;
  let kind = input.kind;

  if (packageId || packageCode) {
    const pkg = await getScreeningPackage(packageId || packageCode);
    if (pkg.package) {
      packageId = pkg.package.id;
      packageCode = pkg.package.code;
      kind = pkg.package.kind;
    }
  }

  const { data, error } = await supabase
    .from('os_screening_orders')
    .insert({
      vendor: 'verified_first',
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      entity_id: input.entityId,
      package_id: packageId,
      package_code: packageCode,
      kind,
      status: 'pending',
      consumer_ref: input.consumerRef ?? {},
      notes: input.notes?.trim() || '',
      confirm_token: randomUUID(),
      ordered_by: input.actorId ?? null,
    })
    .select('*')
    .maybeSingle();

  if (error) return { order: null, error: error.message };
  return {
    order: data ? mapOrder(data as Record<string, unknown>) : null,
  };
}

/**
 * Human-confirm and attempt vendor order.
 * LIVE=0: marks ordered locally with raw_status noting fail-closed (no fabricated clear).
 */
export async function confirmAndPlaceScreeningOrder(input: {
  orderId: string;
  actorId: string;
  subject?: {
    fullName: string;
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
  };
  humanConfirmed: boolean;
}): Promise<{
  order: ScreeningOrder | null;
  error?: string;
  vendorCode?: string;
}> {
  if (!input.humanConfirmed) {
    return {
      order: null,
      error: 'Human confirmation required — no silent sends.',
      vendorCode: 'confirm_required',
    };
  }

  const { order: existing, error: loadErr } = await getScreeningOrder(
    input.orderId,
  );
  if (loadErr || !existing) {
    return { order: null, error: loadErr ?? 'Order not found.' };
  }
  if (['clear', 'waived', 'cancelled'].includes(existing.status)) {
    return { order: existing, error: 'Order already terminal.' };
  }

  const subject = input.subject ?? {
    fullName: String(existing.consumer_ref.subject_name ?? 'Subject'),
    email: String(existing.consumer_ref.subject_email ?? '') || undefined,
  };

  const vendor = await placeVerifiedFirstOrder({
    packageCode: existing.package_code,
    subject,
    consumerRef: existing.consumer_ref as Record<string, unknown>,
    idempotencyKey: existing.id,
    humanConfirmed: true,
  });

  const supabase = await createClient();
  const now = new Date().toISOString();

  if (vendor.ok) {
    const mapped =
      mapVendorStatusToSpine(vendor.rawStatus) ?? ('ordered' as const);
    const { data, error } = await supabase
      .from('os_screening_orders')
      .update({
        status: mapped === 'clear' ? 'ordered' : mapped, // never trust immediate fabricated clear
        external_order_id: vendor.externalOrderId,
        raw_status: vendor.rawStatus,
        ordered_by: input.actorId,
        ordered_at: now,
        confirmed_at: now,
        last_sync_at: now,
      })
      .eq('id', input.orderId)
      .select('*')
      .maybeSingle();
    if (error) return { order: null, error: error.message };
    const order = data ? mapOrder(data as Record<string, unknown>) : null;
    return { order };
  }

  if (vendor.code === 'live_disabled') {
    // Fail-closed: record confirmed intent as ordered (local), not clear.
    const { data, error } = await supabase
      .from('os_screening_orders')
      .update({
        status: 'ordered',
        raw_status: 'live_disabled_local_ordered',
        ordered_by: input.actorId,
        ordered_at: now,
        confirmed_at: now,
        last_sync_at: now,
        notes: [existing.notes, vendor.error].filter(Boolean).join(' · '),
      })
      .eq('id', input.orderId)
      .select('*')
      .maybeSingle();
    if (error) return { order: null, error: error.message };
    return {
      order: data ? mapOrder(data as Record<string, unknown>) : null,
      error: vendor.error,
      vendorCode: vendor.code,
    };
  }

  return {
    order: existing,
    error: vendor.error,
    vendorCode: vendor.code,
  };
}

export async function waiveScreeningOrder(input: {
  orderId: string;
  actorId: string;
  reason: string;
}): Promise<{ order: ScreeningOrder | null; error?: string }> {
  const reason = input.reason.trim();
  if (!reason) return { order: null, error: 'Waiver reason required.' };

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('os_screening_orders')
    .update({
      status: 'waived',
      waiver_reason: reason,
      waived_by: input.actorId,
      waived_at: now,
      completed_at: now,
    })
    .eq('id', input.orderId)
    .select('*')
    .maybeSingle();

  if (error) return { order: null, error: error.message };
  const order = data ? mapOrder(data as Record<string, unknown>) : null;
  if (order) await syncConsumersFromOrder(order);
  return { order };
}

export async function applyScreeningStatusUpdate(input: {
  orderId?: string;
  externalOrderId?: string;
  rawStatus: string;
  reportStoragePath?: string | null;
  persistClient?: boolean;
}): Promise<{ order: ScreeningOrder | null; error?: string }> {
  const client = input.persistClient
    ? await createPersistClient()
    : await createClient();

  let orderId = input.orderId;
  if (!orderId && input.externalOrderId) {
    const { data } = await client
      .from('os_screening_orders')
      .select('id')
      .eq('vendor', 'verified_first')
      .eq('external_order_id', input.externalOrderId)
      .maybeSingle();
    orderId = data?.id as string | undefined;
  }
  if (!orderId) return { order: null, error: 'Order not found for webhook.' };

  const mapped = mapVendorStatusToSpine(input.rawStatus);
  if (!mapped) {
    return { order: null, error: `Unmapped vendor status: ${input.rawStatus}` };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: mapped,
    raw_status: input.rawStatus,
    last_sync_at: now,
  };
  if (input.reportStoragePath) {
    patch.report_storage_path = input.reportStoragePath;
  }
  if (['clear', 'failed', 'waived', 'cancelled'].includes(mapped)) {
    patch.completed_at = now;
  }

  const { data, error } = await client
    .from('os_screening_orders')
    .update(patch)
    .eq('id', orderId)
    .select('*')
    .maybeSingle();

  if (error) return { order: null, error: error.message };
  const order = data ? mapOrder(data as Record<string, unknown>) : null;
  if (order) {
    await syncConsumersFromOrder(order, true);
    if (mapped === 'clear' || mapped === 'failed') {
      void createBroadcastNotification({
        kind: 'screening',
        title: `Screening ${mapped}: ${order.package_code || order.kind}`,
        body: `${order.subject_type} ${order.subject_id} · ${order.entity_id}`,
        href:
          order.subject_type === 'employee'
            ? `/shared-services/hr/employees/${order.subject_id}`
            : '/shared-services/hr/screening',
      });
    }
  }
  return { order };
}

/**
 * Roll status onto Recruit placement + application (shared UDL) and HRIS step.
 */
export async function syncConsumersFromOrder(
  order: ScreeningOrder,
  usePersist = false,
): Promise<void> {
  const client = usePersist
    ? await createPersistClient()
    : await createClient();
  const ref = order.consumer_ref;
  const bgStatus = spineStatusToBgScreen(order.status);

  if (ref.application_id && order.kind !== 'drug') {
    await client
      .from('r619_applications')
      .update({
        bg_screen_status: bgStatus,
        ...(order.status === 'waived'
          ? {
              bg_screen_waiver: true,
              bg_screen_waived_by: order.waived_by,
              bg_screen_waived_at: order.waived_at,
            }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('application_id', ref.application_id)
      .eq('entity_id', 'ENT-R619');
  }

  if (ref.placement_id || order.subject_type === 'placement') {
    const placementId = ref.placement_id || order.subject_id;
    const col =
      order.kind === 'drug'
        ? 'screening_drug_status'
        : order.kind === 'combo'
          ? 'screening_combo_status'
          : 'screening_bg_status';
    await client
      .from('r619_placements')
      .update({
        [col]: order.status,
        screening_last_order_id: order.id,
        screening_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', placementId)
      .eq('entity_id', 'ENT-R619');
  }

  if (ref.hris_step_id && screeningStepComplete(order.status)) {
    await client
      .from('os_hris_process_steps')
      .update({
        status: order.status === 'waived' ? 'waived' : 'done',
        evidence_note: `Verified First ${order.status} · order ${order.id}`,
        evidence_url: `/shared-services/hr/screening?order=${order.id}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', ref.hris_step_id);
  }
}

function screeningStepComplete(status: ScreeningOrderStatus): boolean {
  return status === 'clear' || status === 'waived';
}

/** Ensure pending orders exist for required kinds (idempotent). */
export async function ensurePendingOrdersForRequirements(input: {
  entityId: string;
  subjectType: ScreeningSubjectType;
  subjectId: string;
  requiresBg: boolean;
  requiresDrug: boolean;
  bgPackageId?: string | null;
  drugPackageId?: string | null;
  comboPackageId?: string | null;
  consumerRef?: ScreeningConsumerRef;
  actorId?: string | null;
}): Promise<{ orders: ScreeningOrder[]; errors: string[] }> {
  const existing = await listScreeningOrders({
    entityId: input.entityId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    limit: 20,
  });
  const orders: ScreeningOrder[] = [...existing.orders];
  const errors: string[] = [];

  const hasOpen = (kind: ScreeningPackageKind) =>
    orders.some(
      (o) =>
        o.kind === kind &&
        !['cancelled', 'failed'].includes(o.status),
    );

  if (input.requiresBg && input.requiresDrug && input.comboPackageId) {
    if (!hasOpen('combo') && !hasOpen('bg') && !hasOpen('drug')) {
      const { order, error } = await createPendingScreeningOrder({
        entityId: input.entityId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        kind: 'combo',
        packageId: input.comboPackageId,
        consumerRef: input.consumerRef,
        actorId: input.actorId,
      });
      if (error) errors.push(error);
      else if (order) orders.push(order);
    }
    return { orders, errors };
  }

  if (input.requiresBg && !hasOpen('bg') && !hasOpen('combo')) {
    const { order, error } = await createPendingScreeningOrder({
      entityId: input.entityId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      kind: 'bg',
      packageId: input.bgPackageId,
      packageCode: input.bgPackageId ? undefined : 'vf-standard-bg',
      consumerRef: input.consumerRef,
      actorId: input.actorId,
    });
    if (error) errors.push(error);
    else if (order) orders.push(order);
  }

  if (input.requiresDrug && !hasOpen('drug') && !hasOpen('combo')) {
    const { order, error } = await createPendingScreeningOrder({
      entityId: input.entityId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      kind: 'drug',
      packageId: input.drugPackageId,
      packageCode: input.drugPackageId ? undefined : 'vf-drug-5',
      consumerRef: input.consumerRef,
      actorId: input.actorId,
    });
    if (error) errors.push(error);
    else if (order) orders.push(order);
  }

  return { orders, errors };
}
