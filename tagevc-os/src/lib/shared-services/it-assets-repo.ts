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
  source_name?: string | null;
}): Promise<{
  ok: true;
  batch_id: string | null;
  source_sha256: string;
  updated: number;
  failed: number;
  errors: string[];
}> {
  const { createHash } = await import('crypto');
  const sourceSha256 = createHash('sha256')
    .update(input.lines, 'utf8')
    .digest('hex');
  const errors: string[] = [];
  let failed = 0;
  const preparedRows: Array<{
    line_number: number;
    asset_id: string | null;
    serial_number: string | null;
    warranty_ends_at: string;
  }> = [];
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
      batch_id: null,
      source_sha256: sourceSha256,
      updated: 0,
      failed: Math.max(rows.length - 1, 1),
      errors: [
        'Invalid header: include warranty_ends_at and asset_id or serial_number',
      ],
    };
  }
  const seen = new Map<string, string>();

  for (const [index, raw] of rows.slice(hasHeader ? 1 : 0).entries()) {
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
    preparedRows.push({
      line_number: index + (hasHeader ? 2 : 1),
      asset_id: assetId || (!hasHeader ? key : null),
      serial_number: serial || null,
      warranty_ends_at: date,
    });
  }
  if (errors.length > 0 || preparedRows.length === 0) {
    return {
      ok: true,
      batch_id: null,
      source_sha256: sourceSha256,
      updated: 0,
      failed: failed || 1,
      errors:
        errors.length > 0 ? errors.slice(0, 100) : ['No valid data rows'],
    };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('prepare_it_warranty_import', {
    p_source_name: input.source_name ?? 'warranty.csv',
    p_source_sha256: sourceSha256,
    p_actor_id: input.actor_id ?? null,
    p_rows: preparedRows,
  });
  if (error) {
    return {
      ok: true,
      batch_id: null,
      source_sha256: sourceSha256,
      updated: 0,
      failed: preparedRows.length,
      errors: [error.message],
    };
  }
  const result = (data ?? {}) as {
    batch_id?: string;
    valid?: number;
    errors?: number;
    status?: string;
  };
  return {
    ok: true,
    batch_id: result.batch_id ?? null,
    source_sha256: sourceSha256,
    updated: Number(result.valid ?? 0),
    failed: Number(result.errors ?? 0),
    errors:
      result.status === 'ready'
        ? []
        : ['Preview contains invalid or ambiguous rows; no assets were changed'],
  };
}

export async function commitWarrantyImport(input: {
  batch_id: string;
  source_sha256: string;
  actor_id?: string | null;
}): Promise<
  | { ok: true; changed: number; status: string }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('commit_it_warranty_import', {
      p_batch_id: input.batch_id,
      p_source_sha256: input.source_sha256,
      p_actor_id: input.actor_id ?? null,
    });
    if (error) return { ok: false, error: error.message };
    const result = (data ?? {}) as { changed?: number; status?: string };
    return {
      ok: true,
      changed: Number(result.changed ?? 0),
      status: result.status ?? 'committed',
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Warranty commit failed',
    };
  }
}

export type ItIntuneAction = {
  action_id: string;
  run_id: string | null;
  managed_device_id: string;
  user_id: string | null;
  entity_id: string | null;
  status: string;
  requested_at: string;
  approved_at: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  graph_request_id: string | null;
  attempt_count: number;
  poll_count: number;
  provider_state: string | null;
  verification_code: string | null;
  last_error: string | null;
  request_metadata: Record<string, unknown>;
  verification_evidence: Record<string, unknown>;
  local_asset_id: string | null;
  matched_by: string | null;
  matched_at: string | null;
  match_sha256: string | null;
  approval_expires_at: string | null;
  retry_of_action_id: string | null;
  retry_generation: number;
  cancelled_at: string | null;
  cancel_reason: string | null;
  failure_code: string | null;
  last_error_code: string | null;
  last_error_class: string | null;
  approval_expired_at: string | null;
  dispatch_authorized_at: string | null;
  lease_expires_at: string | null;
  worker_id: string | null;
  retry_child_action_id: string | null;
  manual_review_started_at: string | null;
  ambiguity_resolution_id: string | null;
  ambiguity_disposition: string | null;
  row_version: number;
};

export type ItIntuneAmbiguityResolution = {
  resolution_id: string;
  action_id: string;
  entity_id: string | null;
  decision: 'confirm_retired' | 'close_unresolved' | 'create_retry_child';
  status: 'awaiting_review' | 'approved' | 'rejected' | 'expired';
  evidence_sha256: string;
  provider_http_status: number;
  provider_request_id: string;
  provider_state: string | null;
  dispatch_attempt_id: string | null;
  approval_match_sha256: string | null;
  asset_sha256: string | null;
  provider_preflight_sha256: string | null;
  evidence_semantic_sha256: string | null;
  reviewer_evidence_semantic_sha256: string | null;
  proposed_by: string;
  proposed_reason: string;
  proposed_at: string;
  expires_at: string;
  reviewed_by: string | null;
  reviewer_statement: string | null;
  reviewed_at: string | null;
  retry_child_action_id: string | null;
  row_version: number;
};

export type ItIntuneBreakerHealth = {
  breaker_id: string;
  entity_id: string | null;
  provider: string;
  operation: string;
  state: 'closed' | 'open' | 'half_open';
  opened_at: string | null;
  cooldown_until: string | null;
  last_failure_at: string | null;
  last_success_at: string | null;
  opened_reason: string | null;
  canary_action_id: string | null;
  canary_expires_at: string | null;
  canary_post_accepted_at: string | null;
  row_version: number;
  state_age_minutes: number;
  blocked_action_count: number;
  sample_count: number;
  failure_count: number;
  failure_window_minutes: number;
  minimum_samples: number;
  failure_threshold: number;
  failure_rate_threshold: number;
  reset_success_threshold: number;
};

export type ItIntuneBreakerResetProposal = {
  proposal_id: string;
  breaker_id: string;
  entity_id: string | null;
  status: 'awaiting_review' | 'approved' | 'rejected' | 'expired';
  proposed_by: string;
  proposed_reason: string;
  evidence_sha256: string;
  proposed_at: string;
  expires_at: string;
  reviewed_by: string | null;
  reviewer_statement: string | null;
  reviewed_at: string | null;
  row_version: number;
};

export type ItIntuneTuningProposal = {
  proposal_id: string;
  breaker_id: string;
  entity_id: string | null;
  base_config_version_no: number;
  proposed_failure_window_minutes: number;
  proposed_minimum_samples: number;
  proposed_failure_threshold: number;
  proposed_failure_rate_threshold: number;
  proposed_reset_success_threshold: number;
  risk_class: 'standard' | 'riskier';
  proposed_by: string;
  proposed_reason: string;
  evidence_sha256: string;
  proposed_at: string;
  expires_at: string;
  decision?: 'approved' | 'rejected' | 'expired' | null;
};

export type ItIntunePhase40Health = {
  active_outage_count: number;
  recovering_outage_count: number;
  open_incident_count: number;
  last_canary_success_at: string | null;
  last_canary_failure_at: string | null;
  open_breaker_count: number;
  recovering_breaker_count: number;
  slo_state: 'healthy' | 'warning' | 'breached';
};

export type ItIntuneBreakerGovernance = {
  breaker_id: string;
  entity_id: string | null;
  state: 'closed' | 'open' | 'half_open';
  breaker_version: number;
  failure_window_minutes: number;
  minimum_samples: number;
  failure_threshold: number;
  failure_rate_threshold: number;
  reset_success_threshold: number;
  config_version_no: number;
  current_risk_class: 'baseline' | 'standard' | 'riskier';
  config_applied_at: string;
  pending_proposal_id: string | null;
  pending_proposed_by: string | null;
  pending_risk_class: 'standard' | 'riskier' | null;
  pending_reason: string | null;
  proposed_failure_window_minutes: number | null;
  proposed_minimum_samples: number | null;
  proposed_failure_threshold: number | null;
  proposed_failure_rate_threshold: number | null;
  proposed_reset_success_threshold: number | null;
  pending_expires_at: string | null;
};

export type ItIntuneOutageStatus = {
  episode_id: string;
  provider: string;
  operation: string;
  state: 'active' | 'recovering' | 'resolved';
  started_at: string;
  recovering_at: string | null;
  resolved_at: string | null;
  correlated_scope_count: number;
  failure_count: number;
  sample_count: number;
  evidence_sha256: string;
  row_version: number;
  updated_at: string;
};

export async function listIntuneActions(
  limit = 50,
): Promise<{ rows: ItIntuneAction[]; error?: string }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_intune_actions')
      .select(
        'action_id, run_id, managed_device_id, user_id, entity_id, status, requested_at, approved_at, approval_expires_at, approval_expired_at, submitted_at, dispatch_authorized_at, verified_at, graph_request_id, attempt_count, poll_count, provider_state, verification_code, last_error, last_error_code, last_error_class, request_metadata, verification_evidence, local_asset_id, matched_by, matched_at, match_sha256, retry_of_action_id, retry_child_action_id, retry_generation, cancelled_at, cancel_reason, failure_code, lease_expires_at, worker_id, manual_review_started_at, ambiguity_resolution_id, ambiguity_disposition, row_version',
      )
      .order('requested_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []) as ItIntuneAction[] };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : 'Intune list failed',
    };
  }
}

export async function listIntuneAmbiguityResolutions(limit = 50): Promise<{
  rows: ItIntuneAmbiguityResolution[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_it_intune_ambiguity_resolutions')
      .select(
        'resolution_id, action_id, entity_id, decision, status, evidence_sha256, provider_http_status, provider_request_id, provider_state, dispatch_attempt_id, approval_match_sha256, asset_sha256, provider_preflight_sha256, evidence_semantic_sha256, reviewer_evidence_semantic_sha256, proposed_by, proposed_reason, proposed_at, expires_at, reviewed_by, reviewer_statement, reviewed_at, retry_child_action_id, row_version',
      )
      .order('proposed_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []) as ItIntuneAmbiguityResolution[] };
  } catch (error) {
    return {
      rows: [],
      error:
        error instanceof Error ? error.message : 'Intune ambiguity list failed',
    };
  }
}

export async function listIntuneManualReviewSlo(limit = 50) {
  const sb = await createPersistClient();
  const { data } = await sb
    .from('os_it_intune_manual_review_slo')
    .select('action_id, entity_id, manual_review_started_at, age_minutes, slo_state')
    .order('age_minutes', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listIntuneActionEvents(limit = 80) {
  const sb = await createPersistClient();
  const { data } = await sb
    .from('os_it_intune_action_events')
    .select(
      'event_id, action_id, from_status, to_status, source, evidence, occurred_at, worker_id, row_version',
    )
    .order('occurred_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listIntuneDispatchAttempts(limit = 50) {
  const sb = await createPersistClient();
  const { data } = await sb
    .from('os_it_intune_dispatch_attempts')
    .select(
      'dispatch_attempt_id, action_id, authorization_request_id, worker_id, action_row_version, approval_match_sha256, asset_sha256, provider_preflight_sha256, provider_observed_at, provider_request_id, authorized_at, outcome, outcome_at, graph_request_id, error_code, error_class',
    )
    .order('authorized_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listIntuneWorkerRuns(limit = 12) {
  const sb = await createPersistClient();
  const { data } = await sb
    .from('os_it_intune_worker_runs')
    .select(
      'worker_run_id, status, claimed, succeeded, failed, lease_conflicts, preflighted, authorized, ambiguous, recovered, platform_error, started_at, completed_at',
    )
    .order('started_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listIntuneBreakerHealth(): Promise<{
  rows: ItIntuneBreakerHealth[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_breaker_health')
    .select(
      'breaker_id, entity_id, provider, operation, state, opened_at, cooldown_until, last_failure_at, last_success_at, opened_reason, canary_action_id, canary_expires_at, canary_post_accepted_at, row_version, state_age_minutes, blocked_action_count, sample_count, failure_count, failure_window_minutes, minimum_samples, failure_threshold, failure_rate_threshold, reset_success_threshold',
    )
    .order('state_age_minutes', { ascending: false });
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneBreakerHealth[] };
}

export async function listIntuneBreakerResetProposals(limit = 30): Promise<{
  rows: ItIntuneBreakerResetProposal[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_breaker_reset_proposals')
    .select(
      'proposal_id, breaker_id, entity_id, status, proposed_by, proposed_reason, evidence_sha256, proposed_at, expires_at, reviewed_by, reviewer_statement, reviewed_at, row_version',
    )
    .order('proposed_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneBreakerResetProposal[] };
}

export async function listIntuneTuningProposals(limit = 30): Promise<{
  rows: ItIntuneTuningProposal[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_breaker_tuning_proposals')
    .select(
      'proposal_id, breaker_id, entity_id, base_config_version_no, proposed_failure_window_minutes, proposed_minimum_samples, proposed_failure_threshold, proposed_failure_rate_threshold, proposed_reset_success_threshold, risk_class, proposed_by, proposed_reason, evidence_sha256, proposed_at, expires_at',
    )
    .order('proposed_at', { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  const proposals = (data ?? []) as ItIntuneTuningProposal[];
  if (proposals.length === 0) return { rows: [] };
  const { data: decisions, error: decisionError } = await sb
    .from('os_it_intune_breaker_tuning_decisions')
    .select('proposal_id, decision')
    .in(
      'proposal_id',
      proposals.map((proposal) => proposal.proposal_id),
    );
  if (decisionError) return { rows: [], error: decisionError.message };
  const decisionByProposal = new Map(
    (decisions ?? []).map((decision) => [
      String(decision.proposal_id),
      String(decision.decision) as ItIntuneTuningProposal['decision'],
    ]),
  );
  return {
    rows: proposals.map((proposal) => ({
      ...proposal,
      decision: decisionByProposal.get(proposal.proposal_id) ?? null,
    })),
  };
}

export async function getIntunePhase40Health(): Promise<{
  row: ItIntunePhase40Health | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_phase40_health')
    .select(
      'active_outage_count, recovering_outage_count, open_incident_count, last_canary_success_at, last_canary_failure_at, open_breaker_count, recovering_breaker_count, slo_state',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntunePhase40Health | null) ?? null };
}

export async function listIntuneBreakerGovernance(): Promise<{
  rows: ItIntuneBreakerGovernance[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_breaker_governance')
    .select(
      'breaker_id, entity_id, state, breaker_version, failure_window_minutes, minimum_samples, failure_threshold, failure_rate_threshold, reset_success_threshold, config_version_no, current_risk_class, config_applied_at, pending_proposal_id, pending_proposed_by, pending_risk_class, pending_reason, proposed_failure_window_minutes, proposed_minimum_samples, proposed_failure_threshold, proposed_failure_rate_threshold, proposed_reset_success_threshold, pending_expires_at',
    )
    .order('config_applied_at', { ascending: false });
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneBreakerGovernance[] };
}

export async function listIntuneOutageStatus(limit = 20): Promise<{
  rows: ItIntuneOutageStatus[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_outage_status')
    .select(
      'episode_id, provider, operation, state, started_at, recovering_at, resolved_at, correlated_scope_count, failure_count, sample_count, evidence_sha256, row_version, updated_at',
    )
    .order('started_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneOutageStatus[] };
}

export async function approveIntuneAction(input: {
  action_id: string;
  actor_id: string;
  reason: string;
  expected_row_version: number;
  expected_match_sha256: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('approve_it_intune_action_v2', {
    p_action_id: input.action_id,
    p_actor_id: input.actor_id,
    p_reason: input.reason,
    p_expected_row_version: input.expected_row_version,
    p_expected_match_sha256: input.expected_match_sha256,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function matchIntuneAction(input: {
  action_id: string;
  asset_id: string;
  actor_id: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('match_it_intune_action', {
    p_action_id: input.action_id,
    p_asset_id: input.asset_id,
    p_actor_id: input.actor_id,
    p_expected_row_version: input.expected_row_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function cancelIntuneAction(input: {
  action_id: string;
  actor_id: string;
  reason: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('cancel_it_intune_action', {
    p_action_id: input.action_id,
    p_actor_id: input.actor_id,
    p_reason: input.reason,
    p_expected_row_version: input.expected_row_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function retryIntuneAction(input: {
  action_id: string;
  actor_id: string;
  reason: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('retry_it_intune_action', {
    p_action_id: input.action_id,
    p_actor_id: input.actor_id,
    p_reason: input.reason,
    p_expected_row_version: input.expected_row_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function proposeIntuneAmbiguityResolution(input: {
  action_id: string;
  actor_id: string;
  decision: ItIntuneAmbiguityResolution['decision'];
  provider_evidence: Record<string, unknown>;
  reason: string;
  expected_action_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('propose_it_intune_ambiguity_resolution', {
    p_action_id: input.action_id,
    p_actor_id: input.actor_id,
    p_decision: input.decision,
    p_provider_evidence: input.provider_evidence,
    p_reason: input.reason,
    p_expected_action_version: input.expected_action_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function reviewIntuneAmbiguityResolution(input: {
  resolution_id: string;
  actor_id: string;
  review_decision: 'approve' | 'reject';
  provider_evidence: Record<string, unknown>;
  statement: string;
  expected_resolution_version: number;
  expected_action_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('review_it_intune_ambiguity_resolution', {
    p_resolution_id: input.resolution_id,
    p_actor_id: input.actor_id,
    p_review_decision: input.review_decision,
    p_provider_evidence: input.provider_evidence,
    p_statement: input.statement,
    p_expected_resolution_version: input.expected_resolution_version,
    p_expected_action_version: input.expected_action_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function proposeIntuneBreakerReset(input: {
  breaker_id: string;
  actor_id: string;
  reason: string;
  evidence: Record<string, unknown>;
  expected_breaker_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('propose_it_intune_breaker_reset', {
    p_breaker_id: input.breaker_id,
    p_actor_id: input.actor_id,
    p_reason: input.reason,
    p_evidence: input.evidence,
    p_expected_breaker_version: input.expected_breaker_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function reviewIntuneBreakerReset(input: {
  proposal_id: string;
  actor_id: string;
  decision: 'approve' | 'reject';
  statement: string;
  expected_proposal_version: number;
  expected_breaker_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('review_it_intune_breaker_reset', {
    p_proposal_id: input.proposal_id,
    p_actor_id: input.actor_id,
    p_decision: input.decision,
    p_statement: input.statement,
    p_expected_proposal_version: input.expected_proposal_version,
    p_expected_breaker_version: input.expected_breaker_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}


export async function proposeIntuneBreakerTuning(input: {
  breaker_id: string;
  actor_id: string;
  reason: string;
  failure_window_minutes: number;
  minimum_samples: number;
  failure_threshold: number;
  failure_rate_threshold: number;
  reset_success_threshold: number;
  expected_breaker_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('propose_it_intune_breaker_tuning', {
    p_breaker_id: input.breaker_id,
    p_actor_id: input.actor_id,
    p_reason: input.reason,
    p_failure_window_minutes: input.failure_window_minutes,
    p_minimum_samples: input.minimum_samples,
    p_failure_threshold: input.failure_threshold,
    p_failure_rate_threshold: input.failure_rate_threshold,
    p_reset_success_threshold: input.reset_success_threshold,
    p_expected_breaker_version: input.expected_breaker_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function reviewIntuneBreakerTuning(input: {
  proposal_id: string;
  actor_id: string;
  decision: 'approve' | 'reject';
  statement: string;
  expected_breaker_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('review_it_intune_breaker_tuning', {
    p_proposal_id: input.proposal_id,
    p_actor_id: input.actor_id,
    p_decision: input.decision,
    p_statement: input.statement,
    p_expected_breaker_version: input.expected_breaker_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}
