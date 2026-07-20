'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  assignHardware,
  createHardwareAsset,
  createSoftwareLicense,
  grantLicenseSeat,
  returnHardware,
  revokeLicenseSeat,
} from '@/lib/shared-services/it-assets-repo';
import { guardPermission } from '@/lib/rbac/session';

export type ItAssetActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function revalidateAssets() {
  revalidatePath('/shared-services/it/assets');
  revalidatePath('/shared-services');
}

export async function createHardwareAction(
  _prev: ItAssetActionResult | null,
  formData: FormData,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const parsed = z
    .object({
      kind: z.enum(['laptop', 'phone', 'peripheral', 'other_hardware']),
      entity_id: z.string().optional(),
      serial_number: z.string().optional(),
      model: z.string().optional(),
      notes: z.string().optional(),
      purchased_at: z.string().optional(),
    })
    .safeParse({
      kind: formData.get('kind'),
      entity_id: formData.get('entity_id') || undefined,
      serial_number: formData.get('serial_number') || undefined,
      model: formData.get('model') || undefined,
      notes: formData.get('notes') || undefined,
      purchased_at: formData.get('purchased_at') || undefined,
    });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const res = await createHardwareAsset({
    kind: parsed.data.kind,
    entity_id: parsed.data.entity_id || null,
    serial_number: parsed.data.serial_number || null,
    model: parsed.data.model || null,
    notes: parsed.data.notes || null,
    purchased_at: parsed.data.purchased_at || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Created ${res.asset.asset_id}` };
}

export async function createLicenseAction(
  _prev: ItAssetActionResult | null,
  formData: FormData,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const parsed = z
    .object({
      product_name: z.string().min(2),
      vendor: z.string().optional(),
      seat_count: z.coerce.number().int().positive().optional(),
      entity_id: z.string().optional(),
      renewal_date: z.string().optional(),
      cost_k: z.coerce.number().optional(),
      notes: z.string().optional(),
    })
    .safeParse({
      product_name: formData.get('product_name'),
      vendor: formData.get('vendor') || undefined,
      seat_count: formData.get('seat_count') || undefined,
      entity_id: formData.get('entity_id') || undefined,
      renewal_date: formData.get('renewal_date') || undefined,
      cost_k: formData.get('cost_k') || undefined,
      notes: formData.get('notes') || undefined,
    });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const res = await createSoftwareLicense({
    product_name: parsed.data.product_name,
    vendor: parsed.data.vendor || null,
    seat_count: parsed.data.seat_count ?? null,
    entity_id: parsed.data.entity_id || null,
    renewal_date: parsed.data.renewal_date || null,
    cost_k: parsed.data.cost_k ?? null,
    notes: parsed.data.notes || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Created ${res.license.license_id}` };
}

export async function assignHardwareAction(
  assetId: string,
  userId: string,
  note?: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  if (!userId.trim()) return { ok: false, error: 'User id required' };

  const res = await assignHardware({
    asset_id: assetId,
    user_id: userId.trim(),
    actor_id: gate.profile.id,
    note: note || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Assigned ${assetId}` };
}

export async function returnHardwareAction(
  assetId: string,
  note?: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const res = await returnHardware({
    asset_id: assetId,
    actor_id: gate.profile.id,
    note: note || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Returned ${assetId}` };
}

export async function grantSeatAction(
  licenseId: string,
  userId?: string,
  note?: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const res = await grantLicenseSeat({
    license_id: licenseId,
    user_id: userId?.trim() || null,
    actor_id: gate.profile.id,
    note: note || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Granted seat on ${licenseId}` };
}

export async function revokeSeatAction(
  licenseId: string,
  userId?: string,
  note?: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;

  const res = await revokeLicenseSeat({
    license_id: licenseId,
    user_id: userId?.trim() || null,
    actor_id: gate.profile.id,
    note: note || null,
  });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Revoked seat on ${licenseId}` };
}

export async function startOffboardingAction(
  userId: string,
  entityId?: string,
  autoExecute?: boolean,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { startOffboarding } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await startOffboarding({
    user_id: userId,
    entity_id: entityId || null,
    actor_id: gate.profile.id,
    auto_execute: Boolean(autoExecute),
  });
  if (!res.ok) return res;
  revalidateAssets();
  return {
    ok: true,
    message: `Offboarding ${res.run.run_id} · ${res.run.checklist.length} items · ${res.run.status}`,
  };
}

export async function executeOffboardingAction(
  runId: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { executeOffboarding } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await executeOffboarding(runId, { actor_id: gate.profile.id });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Executed ${runId}` };
}

export async function startOffboardingFromTicketAction(
  ticketId: string,
  autoExecute?: boolean,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { startOffboardingFromHrTicket } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await startOffboardingFromHrTicket({
    ticket_id: ticketId,
    actor_id: gate.profile.id,
    auto_execute: Boolean(autoExecute),
  });
  if (!res.ok) return res;
  revalidateAssets();
  return {
    ok: true,
    message: `Offboarding ${res.run.run_id} from ${ticketId}`,
  };
}

export async function completeOffboardingAction(
  runId: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { completeOffboarding } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await completeOffboarding(runId);
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Completed ${runId}` };
}

export async function scanInactiveOffboardingAction(): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { scanInactiveProfilesForOffboarding } = await import(
    '@/lib/shared-services/it-offboarding'
  );
  const res = await scanInactiveProfilesForOffboarding({
    limit: 20,
    auto_execute: true,
    actor_id: gate.profile.id,
  });
  revalidateAssets();
  return {
    ok: true,
    message: `Status scan: ${res.started} started, ${res.skipped} skipped (${res.scanned} inactive)`,
  };
}

export async function startOnboardingAction(
  userId: string,
  entityId?: string,
  autoExecute?: boolean,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { startOnboarding } = await import(
    '@/lib/shared-services/it-onboarding'
  );
  const res = await startOnboarding({
    user_id: userId,
    entity_id: entityId || null,
    actor_id: gate.profile.id,
    auto_execute: Boolean(autoExecute),
  });
  if (!res.ok) return res;
  revalidateAssets();
  return {
    ok: true,
    message: `Onboarding ${res.run.run_id} · ${res.run.checklist.length} items · ${res.run.status}`,
  };
}

export async function executeOnboardingAction(
  runId: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { executeOnboarding } = await import(
    '@/lib/shared-services/it-onboarding'
  );
  const res = await executeOnboarding(runId, { actor_id: gate.profile.id });
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Executed onboarding ${runId}` };
}

export async function completeOnboardingAction(
  runId: string,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { completeOnboarding } = await import(
    '@/lib/shared-services/it-onboarding'
  );
  const res = await completeOnboarding(runId);
  if (!res.ok) return res;
  revalidateAssets();
  return { ok: true, message: `Completed onboarding ${runId}` };
}

export async function startOnboardingFromTicketAction(
  ticketId: string,
  autoExecute?: boolean,
): Promise<ItAssetActionResult> {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) return gate;
  const { startOnboardingFromHrTicket } = await import(
    '@/lib/shared-services/it-onboarding'
  );
  const res = await startOnboardingFromHrTicket({
    ticket_id: ticketId,
    actor_id: gate.profile.id,
    auto_execute: Boolean(autoExecute),
  });
  if (!res.ok) return res;
  revalidateAssets();
  return {
    ok: true,
    message: `Onboarding ${res.run.run_id} from ${ticketId}`,
  };
}
