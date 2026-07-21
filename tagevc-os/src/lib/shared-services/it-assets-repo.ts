/**
 * IT hardware + software license repo (Phase 21).
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type {
  ItAssignmentEvent,
  ItAssetKind,
  ItAssetStatus,
  ItHardwareAsset,
  ItSoftwareLicense,
  ItSoftwareLicenseStatus,
} from '@/lib/shared-services/it-assets-types';

function nextAssetId(): string {
  return `HW-${Date.now().toString(36).toUpperCase()}`;
}

function nextLicenseId(): string {
  return `LIC-${Date.now().toString(36).toUpperCase()}`;
}

function nextEventId(): string {
  return `IAE-${randomUUID().slice(0, 8)}`;
}

function mapHardware(row: Record<string, unknown>): ItHardwareAsset {
  return {
    asset_id: String(row.asset_id),
    kind: row.kind as ItAssetKind,
    status: row.status as ItAssetStatus,
    entity_id: (row.entity_id as string) ?? null,
    assigned_user_id: (row.assigned_user_id as string) ?? null,
    serial_number: (row.serial_number as string) ?? null,
    model: (row.model as string) ?? null,
    notes: (row.notes as string) ?? null,
    purchased_at: (row.purchased_at as string) ?? null,
    warranty_ends_at: (row.warranty_ends_at as string) ?? null,
    updated_at: String(row.updated_at ?? row.created_at ?? ''),
  };
}

function mapLicense(row: Record<string, unknown>): ItSoftwareLicense {
  return {
    license_id: String(row.license_id),
    product_name: String(row.product_name),
    vendor: (row.vendor as string) ?? null,
    status: row.status as ItSoftwareLicenseStatus,
    seat_count: row.seat_count == null ? null : Number(row.seat_count),
    seats_used: row.seats_used == null ? null : Number(row.seats_used),
    entity_id: (row.entity_id as string) ?? null,
    renewal_date: (row.renewal_date as string) ?? null,
    cost_k: row.cost_k == null ? null : Number(row.cost_k),
    notes: (row.notes as string) ?? null,
    updated_at: String(row.updated_at ?? row.created_at ?? ''),
  };
}

function mapEvent(row: Record<string, unknown>): ItAssignmentEvent {
  return {
    event_id: String(row.event_id),
    kind: row.kind as ItAssignmentEvent['kind'],
    asset_id: (row.asset_id as string) ?? null,
    license_id: (row.license_id as string) ?? null,
    user_id: (row.user_id as string) ?? null,
    entity_id: (row.entity_id as string) ?? null,
    actor_id: (row.actor_id as string) ?? null,
    note: (row.note as string) ?? null,
    created_at: String(row.created_at),
  };
}

export async function listHardwareAssets(limit = 100): Promise<{
  rows: ItHardwareAsset[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_hardware_assets')
      .select(
        'asset_id, kind, status, entity_id, assigned_user_id, serial_number, model, notes, purchased_at, warranty_ends_at, updated_at, created_at',
      )
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((r) => mapHardware(r as Record<string, unknown>)) };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
  }
}

export async function listSoftwareLicenses(limit = 100): Promise<{
  rows: ItSoftwareLicense[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_software_licenses')
      .select(
        'license_id, product_name, vendor, status, seat_count, seats_used, entity_id, renewal_date, cost_k, notes, updated_at, created_at',
      )
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((r) => mapLicense(r as Record<string, unknown>)) };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
  }
}

export async function listAssignmentEvents(limit = 40): Promise<{
  rows: ItAssignmentEvent[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_assignment_events')
      .select(
        'event_id, kind, asset_id, license_id, user_id, entity_id, actor_id, note, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((r) => mapEvent(r as Record<string, unknown>)) };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
  }
}

export type ItLifecycleEvent = {
  event_id: string;
  run_id: string | null;
  item_id: string;
  target_id: string | null;
  entity_id: string | null;
  status: string;
  detail: string | null;
  occurred_at: string;
};

export async function listLifecycleEvents(limit = 40): Promise<{
  rows: ItLifecycleEvent[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_lifecycle_events')
      .select(
        'event_id, run_id, item_id, target_id, entity_id, status, detail, occurred_at',
      )
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => ({
        event_id: String(row.event_id),
        run_id: (row.run_id as string) ?? null,
        item_id: String(row.item_id),
        target_id: (row.target_id as string) ?? null,
        entity_id: (row.entity_id as string) ?? null,
        status: String(row.status),
        detail: (row.detail as string) ?? null,
        occurred_at: String(row.occurred_at),
      })),
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'lifecycle events failed',
    };
  }
}

async function recordEvent(input: {
  kind: ItAssignmentEvent['kind'];
  asset_id?: string | null;
  license_id?: string | null;
  user_id?: string | null;
  entity_id?: string | null;
  actor_id?: string | null;
  note?: string | null;
}): Promise<void> {
  const sb = await createPersistClient();
  const { error } = await sb.from('os_it_assignment_events').insert({
    event_id: nextEventId(),
    kind: input.kind,
    asset_id: input.asset_id ?? null,
    license_id: input.license_id ?? null,
    user_id: input.user_id ?? null,
    entity_id: input.entity_id ?? null,
    actor_id: input.actor_id ?? null,
    note: input.note ?? null,
  });
  if (error) {
    console.error('[it-assets] event insert failed', error.message);
  }
}

export async function createHardwareAsset(input: {
  kind: ItAssetKind;
  entity_id?: string | null;
  serial_number?: string | null;
  model?: string | null;
  notes?: string | null;
  purchased_at?: string | null;
  warranty_ends_at?: string | null;
}): Promise<{ ok: true; asset: ItHardwareAsset } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const asset_id = nextAssetId();
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('os_it_hardware_assets')
      .insert({
        asset_id,
        kind: input.kind,
        status: 'in_stock',
        entity_id: input.entity_id || null,
        serial_number: input.serial_number || null,
        model: input.model || null,
        notes: input.notes || null,
        purchased_at: input.purchased_at || null,
        warranty_ends_at: input.warranty_ends_at || null,
        updated_at: now,
      })
      .select(
        'asset_id, kind, status, entity_id, assigned_user_id, serial_number, model, notes, purchased_at, warranty_ends_at, updated_at, created_at',
      )
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, asset: mapHardware(data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'create failed' };
  }
}

export async function createSoftwareLicense(input: {
  product_name: string;
  vendor?: string | null;
  seat_count?: number | null;
  entity_id?: string | null;
  renewal_date?: string | null;
  cost_k?: number | null;
  notes?: string | null;
}): Promise<
  { ok: true; license: ItSoftwareLicense } | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const license_id = nextLicenseId();
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('os_it_software_licenses')
      .insert({
        license_id,
        product_name: input.product_name,
        vendor: input.vendor || null,
        status: 'active',
        seat_count: input.seat_count ?? null,
        seats_used: 0,
        entity_id: input.entity_id || null,
        renewal_date: input.renewal_date || null,
        cost_k: input.cost_k ?? null,
        notes: input.notes || null,
        updated_at: now,
      })
      .select(
        'license_id, product_name, vendor, status, seat_count, seats_used, entity_id, renewal_date, cost_k, notes, updated_at, created_at',
      )
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, license: mapLicense(data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'create failed' };
  }
}

export async function assignHardware(input: {
  asset_id: string;
  user_id: string;
  actor_id?: string | null;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data: existing, error: findErr } = await sb
      .from('os_it_hardware_assets')
      .select('asset_id, status, entity_id')
      .eq('asset_id', input.asset_id)
      .maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (!existing) return { ok: false, error: 'Asset not found' };
    if ((existing as { status: string }).status === 'retired') {
      return { ok: false, error: 'Cannot assign a retired asset' };
    }

    const now = new Date().toISOString();
    const { error } = await sb
      .from('os_it_hardware_assets')
      .update({
        status: 'assigned',
        assigned_user_id: input.user_id,
        updated_at: now,
      })
      .eq('asset_id', input.asset_id);
    if (error) return { ok: false, error: error.message };

    await recordEvent({
      kind: 'assign',
      asset_id: input.asset_id,
      user_id: input.user_id,
      entity_id: (existing as { entity_id: string | null }).entity_id,
      actor_id: input.actor_id ?? null,
      note: input.note ?? null,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'assign failed' };
  }
}

export async function returnHardware(input: {
  asset_id: string;
  actor_id?: string | null;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data: existing, error: findErr } = await sb
      .from('os_it_hardware_assets')
      .select('asset_id, assigned_user_id, entity_id')
      .eq('asset_id', input.asset_id)
      .maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (!existing) return { ok: false, error: 'Asset not found' };

    const prevUser = (existing as { assigned_user_id: string | null })
      .assigned_user_id;
    const now = new Date().toISOString();
    const { error } = await sb
      .from('os_it_hardware_assets')
      .update({
        status: 'in_stock',
        assigned_user_id: null,
        updated_at: now,
      })
      .eq('asset_id', input.asset_id);
    if (error) return { ok: false, error: error.message };

    await recordEvent({
      kind: 'return',
      asset_id: input.asset_id,
      user_id: prevUser,
      entity_id: (existing as { entity_id: string | null }).entity_id,
      actor_id: input.actor_id ?? null,
      note: input.note ?? null,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'return failed' };
  }
}

export async function grantLicenseSeat(input: {
  license_id: string;
  user_id?: string | null;
  actor_id?: string | null;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data: existing, error: findErr } = await sb
      .from('os_it_software_licenses')
      .select('license_id, seat_count, seats_used, entity_id, status')
      .eq('license_id', input.license_id)
      .maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (!existing) return { ok: false, error: 'License not found' };

    const row = existing as {
      seat_count: number | null;
      seats_used: number | null;
      entity_id: string | null;
      status: string;
    };
    if (row.status !== 'active') {
      return { ok: false, error: `License status is ${row.status}` };
    }
    const used = row.seats_used ?? 0;
    if (row.seat_count != null && used >= row.seat_count) {
      return { ok: false, error: 'No seats remaining' };
    }

    const now = new Date().toISOString();
    const { error } = await sb
      .from('os_it_software_licenses')
      .update({ seats_used: used + 1, updated_at: now })
      .eq('license_id', input.license_id);
    if (error) return { ok: false, error: error.message };

    await recordEvent({
      kind: 'license_grant',
      license_id: input.license_id,
      user_id: input.user_id ?? null,
      entity_id: row.entity_id,
      actor_id: input.actor_id ?? null,
      note: input.note ?? null,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'grant failed' };
  }
}

export async function revokeLicenseSeat(input: {
  license_id: string;
  user_id?: string | null;
  actor_id?: string | null;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data: existing, error: findErr } = await sb
      .from('os_it_software_licenses')
      .select('license_id, seats_used, entity_id')
      .eq('license_id', input.license_id)
      .maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };
    if (!existing) return { ok: false, error: 'License not found' };

    const row = existing as {
      seats_used: number | null;
      entity_id: string | null;
    };
    const used = row.seats_used ?? 0;
    if (used <= 0) return { ok: false, error: 'No seats in use' };

    const now = new Date().toISOString();
    const { error } = await sb
      .from('os_it_software_licenses')
      .update({ seats_used: used - 1, updated_at: now })
      .eq('license_id', input.license_id);
    if (error) return { ok: false, error: error.message };

    await recordEvent({
      kind: 'license_revoke',
      license_id: input.license_id,
      user_id: input.user_id ?? null,
      entity_id: row.entity_id,
      actor_id: input.actor_id ?? null,
      note: input.note ?? null,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'revoke failed' };
  }
}

/** Update warranty end date by asset_id or serial_number (Phase 30). */
export async function updateHardwareWarranty(input: {
  asset_id?: string | null;
  serial_number?: string | null;
  warranty_ends_at: string;
  actor_id?: string | null;
}): Promise<{ ok: true; asset_id: string } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    let assetId = input.asset_id?.trim() || null;
    if (!assetId && input.serial_number?.trim()) {
      const { data, error } = await sb
        .from('os_it_hardware_assets')
        .select('asset_id')
        .eq('serial_number', input.serial_number.trim())
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (!data) return { ok: false, error: `No asset for serial ${input.serial_number}` };
      assetId = data.asset_id as string;
    }
    if (!assetId) return { ok: false, error: 'asset_id or serial_number required' };
    const { data: before, error: beforeError } = await sb
      .from('os_it_hardware_assets')
      .select('asset_id, warranty_ends_at, entity_id')
      .eq('asset_id', assetId)
      .maybeSingle();
    if (beforeError) return { ok: false, error: beforeError.message };
    if (!before) return { ok: false, error: `No asset ${assetId}` };

    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('os_it_hardware_assets')
      .update({
        warranty_ends_at: input.warranty_ends_at,
        updated_at: now,
      })
      .eq('asset_id', assetId)
      .select('asset_id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: `No asset ${assetId}` };
    const { error: auditError } = await sb.from('os_it_lifecycle_events').insert({
      event_id: `ITL-${randomUUID()}`,
      run_id: null,
      item_id: 'warranty-update',
      target_id: assetId,
      entity_id: (before.entity_id as string) ?? null,
      actor_id: input.actor_id ?? null,
      status: 'done',
      detail: `Warranty ${
        (before.warranty_ends_at as string | null) ?? 'unset'
      } → ${input.warranty_ends_at}`,
      metadata: {
        kind: 'warranty_update',
        before: (before.warranty_ends_at as string | null) ?? null,
        after: input.warranty_ends_at,
      },
    });
    if (auditError && !auditError.message.includes('os_it_lifecycle_events')) {
      return {
        ok: false,
        error: `Warranty updated but lifecycle audit failed: ${auditError.message}`,
      };
    }

    return { ok: true, asset_id: assetId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'warranty update failed',
    };
  }
}

/**
 * Bulk warranty import — lines: `ASSET-ID,YYYY-MM-DD` or `serial,YYYY-MM-DD`.
 */
export async function bulkUpdateWarranties(input: {
  lines: string;
  actor_id?: string | null;
}): Promise<{
  ok: true;
  updated: number;
  failed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let updated = 0;
  let failed = 0;
  function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (ch === ',' && !quoted) {
        fields.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  }

  const rows = input.lines
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const header = rows.length > 0 ? parseCsvLine(rows[0]).map((h) => h.toLowerCase()) : [];
  const hasHeader =
    header.includes('warranty_ends_at') &&
    (header.includes('asset_id') || header.includes('serial_number'));
  const assetIndex = hasHeader ? header.indexOf('asset_id') : 0;
  const serialIndex = hasHeader ? header.indexOf('serial_number') : -1;
  const dateIndex = hasHeader ? header.indexOf('warranty_ends_at') : 1;
  if (
    rows.length > 0 &&
    !hasHeader &&
    header.some((value) =>
      ['asset_id', 'serial_number', 'warranty_ends_at'].includes(value),
    )
  ) {
    return {
      ok: true,
      updated: 0,
      failed: Math.max(rows.length - 1, 1),
      errors: [
        'Invalid header: include warranty_ends_at and asset_id or serial_number',
      ],
    };
  }
  const seen = new Map<string, string>();

  for (const raw of rows.slice(hasHeader ? 1 : 0)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.includes(',') ? parseCsvLine(line) : line.split('\t').map((p) => p.trim());
    if (parts.length < 2) {
      failed += 1;
      errors.push(`Bad line: ${line}`);
      continue;
    }
    const assetId = assetIndex >= 0 ? parts[assetIndex]?.trim() : '';
    const serial = serialIndex >= 0 ? parts[serialIndex]?.trim() : '';
    const key = assetId || serial || parts[0]?.trim();
    const date = parts[dateIndex]?.trim();
    const parsedDate = date ? new Date(`${date}T00:00:00Z`) : null;
    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !parsedDate ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      failed += 1;
      errors.push(`Bad date on ${key}: ${date}`);
      continue;
    }
    const normalizedKey = key.toLowerCase();
    const priorDate = seen.get(normalizedKey);
    if (priorDate) {
      failed += 1;
      errors.push(
        priorDate === date
          ? `Duplicate row for ${key}`
          : `Conflicting dates for ${key}: ${priorDate} and ${date}`,
      );
      continue;
    }
    seen.set(normalizedKey, date);
    let res = await updateHardwareWarranty({
      asset_id: assetId || (!hasHeader ? key : null),
      serial_number: serial || null,
      warranty_ends_at: date,
      actor_id: input.actor_id,
    });
    if (!res.ok && !serial) {
      res = await updateHardwareWarranty({
        asset_id: null,
        serial_number: key,
        warranty_ends_at: date,
        actor_id: input.actor_id,
      });
    }
    if (res.ok) updated += 1;
    else {
      failed += 1;
      errors.push(`${key}: ${res.error}`);
    }
  }
  return { ok: true, updated, failed, errors: errors.slice(0, 100) };
}
