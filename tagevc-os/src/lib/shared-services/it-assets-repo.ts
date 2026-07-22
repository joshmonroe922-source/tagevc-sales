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

export type ItIntuneOutagePostmortem = {
  postmortem_id: string;
  episode_id: string;
  status: 'draft' | 'published' | 'rejected';
  root_cause_class:
    | 'provider_outage'
    | 'threshold_too_sensitive'
    | 'thin_sampling'
    | 'multi_scope_correlation'
    | 'unknown';
  timeline_sha256: string;
  blameless_notes: string;
  blameless_notes_sha256: string;
  aggregate_evidence_sha256: string;
  drafted_by: string | null;
  drafted_at: string;
  published_by: string | null;
  published_at: string | null;
  row_version: number;
  updated_at: string;
  provider: string;
  operation: string;
  started_at: string;
  resolved_at: string | null;
  correlated_scope_count: number;
  failure_count: number;
  sample_count: number;
};

export type ItIntuneThresholdRecommendation = {
  recommendation_id: string;
  episode_id: string;
  postmortem_id: string | null;
  breaker_id: string;
  status: 'pending' | 'accepted' | 'dismissed' | 'expired';
  base_config_version_no: number;
  recommended_failure_window_minutes: number;
  recommended_minimum_samples: number;
  recommended_failure_threshold: number;
  recommended_failure_rate_threshold: number;
  recommended_reset_success_threshold: number;
  risk_class: 'standard' | 'riskier';
  rationale: string;
  evidence_sha256: string;
  generated_at: string;
  expires_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  resulting_proposal_id: string | null;
  dismissed_by: string | null;
  dismissed_at: string | null;
  row_version: number;
  entity_id: string | null;
  provider: string;
  operation: string;
  breaker_state: 'closed' | 'open' | 'half_open';
  breaker_version: number;
  soak_status?:
    | 'awaiting_decision'
    | 'soaking'
    | 'healthy'
    | 'degraded'
    | 'rejected'
    | 'expired'
    | 'breaker_open_observed'
    | 'breaker_closed_observed'
    | 'cycle_complete'
    | null;
  soak_elapsed_minutes?: number | null;
  soak_sample_count?: number | null;
  soak_failure_count?: number | null;
  soak_failure_rate?: number | null;
  soak_proposal_decision?: 'approve' | 'reject' | null;
  soak_observed_at?: string | null;
  soak_evidence_sha256?: string | null;
  soak_cycle_id?: string | null;
  soak_cycle_status?: 'cycle_complete' | null;
  soak_cycle_elapsed_minutes?: number | null;
  soak_cycle_open_at?: string | null;
  soak_cycle_closed_at?: string | null;
  soak_cycle_evidence_sha256?: string | null;
};

export type ItIntunePhase41Health = {
  draft_postmortem_count: number;
  published_postmortem_count: number;
  pending_recommendation_count: number;
  accepted_recommendation_count: number;
  unresolved_postmortem_backlog: number;
};

export type ItIntunePhase42Health = {
  accepted_recommendation_count: number;
  soak_observation_count: number;
  awaiting_decision_count: number;
  soaking_count: number;
  healthy_count: number;
  degraded_count: number;
  breaker_open_observed_count: number;
};

export type ItIntunePhase43Health = {
  cycle_evidence_count: number;
  cycle_complete_count: number;
  open_awaiting_close_count: number;
};

export type ItIntunePhase44Health = {
  performance_snapshot_count: number;
  ops_alert_count: number;
  alerts_delivered_count: number;
  alerts_undelivered_count: number;
  canary_unhealthy_alerts_7d: number;
  canary_stale_alerts_7d: number;
  canary_during_outage_alerts_7d: number;
  open_awaiting_close_aged_7d: number;
  failure_rate_elevated_7d: number;
  correlation_events_7d: number;
};

export type ItIntunePhase45Health = {
  quality_review_count: number;
  quality_ready_count: number;
  quality_low_7d: number;
  promote_gate_count: number;
  promote_ready_latest_count: number;
  promote_blocked_7d: number;
  trend_degraded_7d: number;
  ops_alert_count: number;
  alerts_delivered_count: number;
  alerts_undelivered_count: number;
};

export type ItIntunePhase46Health = {
  scorecard_count: number;
  scorecard_ready_count: number;
  quality_score_low_7d: number;
  waive_pending_count: number;
  waive_approved_count: number;
  waive_decision_count: number;
  ops_alert_count: number;
  alerts_delivered_count: number;
  alerts_undelivered_count: number;
  dual_approve_required_7d: number;
};

export type ItIntunePhase47Health = {
  mttr_correlation_count: number;
  mttr_score_mismatch_7d: number;
  waive_expiry_pending_count: number;
  waive_extend_approved_count: number;
  waive_expire_approved_count: number;
  waive_expiry_decision_count: number;
  waive_expired_7d: number;
  ops_alert_count: number;
  alerts_delivered_count: number;
  alerts_undelivered_count: number;
};

export type ItIntunePhase48Health = {
  template_suggestion_count: number;
  template_mismatch_suggestions_7d: number;
  lifecycle_snapshot_count: number;
  lifecycle_expired_latest: number;
  lifecycle_extended_latest: number;
  lifecycle_proposed_latest: number;
  lifecycle_approved_latest: number;
  waive_expired_page_count: number;
  waive_expired_pages_delivered: number;
  ops_alert_count: number;
  alerts_delivered_count: number;
  alerts_undelivered_count: number;
};

export type ItIntunePostmortemQualityStatus = {
  review_id: string;
  postmortem_id: string;
  quality_score: number;
  checklist: Record<string, unknown>;
  cycle_complete_count: number;
  trend_healthy: boolean;
  ready_for_tuning_promote: boolean;
  evidence_sha256: string;
  recorded_at: string;
  postmortem_status: string;
  root_cause_class: string;
};

export type ItIntunePostmortemQualityScorecardStatus = {
  scorecard_id: string;
  postmortem_id: string;
  cycle_trend_component: number;
  correlation_coverage_component: number;
  root_cause_component: number;
  notes_quality_component: number;
  composite_score: number;
  checklist: Record<string, unknown>;
  cycle_complete_count: number;
  correlation_event_kinds: number;
  ready_for_tuning_promote: boolean;
  evidence_sha256: string;
  recorded_at: string;
  postmortem_status: string;
  root_cause_class: string;
};

export type ItIntunePromoteWaiveStatus = {
  proposal_id: string;
  recommendation_id: string;
  proposed_by: string;
  proposed_reason: string;
  status: 'proposed' | 'approved' | 'rejected' | 'expired';
  proposed_at: string;
  expires_at: string;
  row_version: number;
  evidence_sha256: string;
  decision_id: string | null;
  decided_by: string | null;
  decision_status: 'approved' | 'rejected' | null;
  decided_at: string | null;
  recommendation_status: string;
  breaker_id: string;
  postmortem_id: string | null;
};

export type ItIntunePromoteWaiveExpiryStatus = {
  expiry_proposal_id: string;
  waive_proposal_id: string;
  action: 'extend' | 'expire';
  proposed_by: string;
  proposed_reason: string;
  new_expires_at: string | null;
  status: 'proposed' | 'approved' | 'rejected';
  proposed_at: string;
  row_version: number;
  evidence_sha256: string;
  decision_id: string | null;
  decided_by: string | null;
  decision_status: 'approved' | 'rejected' | null;
  decided_at: string | null;
  recommendation_id: string;
  waive_expires_at: string;
  waive_status: string;
};

export type ItIntuneScorecardMttrCorrelationStatus = {
  correlation_id: string;
  postmortem_id: string;
  scorecard_id: string;
  cycle_elapsed_minutes: number;
  composite_score: number;
  correlation_delta: number;
  aggregate_evidence: Record<string, unknown>;
  evidence_sha256: string;
  recorded_at: string;
  ready_for_tuning_promote: boolean;
  postmortem_status: string;
};

export type ItIntunePostmortemTemplateSuggestionStatus = {
  suggestion_id: string;
  postmortem_id: string;
  scorecard_id: string;
  correlation_id: string;
  suggested_fields: Record<string, unknown>;
  mttr_minutes: number;
  composite_score: number;
  status: 'suggested';
  evidence_sha256: string;
  recorded_at: string;
  postmortem_status: string;
  root_cause_class: string;
};

export type ItIntuneWaiveLifecycleStatus = {
  snapshot_id: string;
  proposed_count: number;
  approved_count: number;
  rejected_count: number;
  expired_count: number;
  extended_count: number;
  expiry_pending_count: number;
  expire_action_approved_count: number;
  aggregate_evidence: Record<string, unknown>;
  evidence_sha256: string;
  bucket_key: string;
  recorded_at: string;
};

export type ItIntuneTuningPromoteGateStatus = {
  gate_id: string;
  recommendation_id: string;
  proposal_id: string | null;
  gate_status: 'blocked' | 'ready' | 'waived';
  block_reasons: Array<Record<string, unknown>>;
  multi_cycle_count: number;
  failure_rate_trend:
    | 'improving'
    | 'stable'
    | 'degrading'
    | 'insufficient_data';
  evidence_sha256: string;
  recorded_at: string;
  recommendation_status: string;
  breaker_id: string;
  postmortem_id: string | null;
};

export type ItIntuneResilienceCorrelationEvent = {
  breaker_id: string | null;
  event_kind: string;
  occurred_at: string;
  evidence_sha256: string;
  status: string | null;
};

export type ItIntuneSoakCycleTimeline = {
  cycle_id: string;
  recommendation_id: string;
  proposal_id: string;
  breaker_id: string;
  postmortem_id: string | null;
  open_observation_id: string;
  closed_observation_id: string;
  open_observed_at: string;
  closed_observed_at: string;
  cycle_elapsed_minutes: number;
  open_breaker_state: 'open' | 'half_open';
  closed_breaker_state: 'closed';
  cycle_status: 'cycle_complete';
  sample_count: number;
  failure_count: number;
  failure_rate: number;
  evidence_sha256: string;
  recorded_at: string;
  closes_or_resets_breaker: boolean;
  entity_id: string | null;
  provider: string;
  operation: string;
  breaker_state: 'closed' | 'open' | 'half_open';
  accepted_at: string | null;
  risk_class: string | null;
  postmortem_status: string | null;
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

export async function getIntunePhase41Health(): Promise<{
  row: ItIntunePhase41Health | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_phase41_health')
    .select(
      'draft_postmortem_count, published_postmortem_count, pending_recommendation_count, accepted_recommendation_count, unresolved_postmortem_backlog',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntunePhase41Health | null) ?? null };
}

export async function listIntuneOutagePostmortems(limit = 20): Promise<{
  rows: ItIntuneOutagePostmortem[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_outage_postmortem_status')
    .select(
      'postmortem_id, episode_id, status, root_cause_class, timeline_sha256, blameless_notes, blameless_notes_sha256, aggregate_evidence_sha256, drafted_by, drafted_at, published_by, published_at, row_version, updated_at, provider, operation, started_at, resolved_at, correlated_scope_count, failure_count, sample_count',
    )
    .order('updated_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneOutagePostmortem[] };
}

export async function listIntuneThresholdRecommendations(limit = 30): Promise<{
  rows: ItIntuneThresholdRecommendation[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_recommendation_soak_status')
    .select(
      'recommendation_id, episode_id, postmortem_id, breaker_id, status, base_config_version_no, recommended_failure_window_minutes, recommended_minimum_samples, recommended_failure_threshold, recommended_failure_rate_threshold, recommended_reset_success_threshold, risk_class, rationale, evidence_sha256, generated_at, expires_at, accepted_by, accepted_at, resulting_proposal_id, dismissed_by, dismissed_at, row_version, entity_id, provider, operation, breaker_state, breaker_version, soak_status, soak_elapsed_minutes, soak_sample_count, soak_failure_count, soak_failure_rate, soak_proposal_decision, soak_observed_at, soak_evidence_sha256, soak_cycle_id, soak_cycle_status, soak_cycle_elapsed_minutes, soak_cycle_open_at, soak_cycle_closed_at, soak_cycle_evidence_sha256',
    )
    .order('generated_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneThresholdRecommendation[] };
}

export async function getIntunePhase42Health(): Promise<{
  row: ItIntunePhase42Health | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_phase42_health')
    .select(
      'accepted_recommendation_count, soak_observation_count, awaiting_decision_count, soaking_count, healthy_count, degraded_count, breaker_open_observed_count',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntunePhase42Health | null) ?? null };
}

export async function getIntunePhase43Health(): Promise<{
  row: ItIntunePhase43Health | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_phase43_health')
    .select(
      'cycle_evidence_count, cycle_complete_count, open_awaiting_close_count',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntunePhase43Health | null) ?? null };
}

export async function getIntunePhase44Health(): Promise<{
  row: ItIntunePhase44Health | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_phase44_health')
    .select(
      'performance_snapshot_count, ops_alert_count, alerts_delivered_count, alerts_undelivered_count, canary_unhealthy_alerts_7d, canary_stale_alerts_7d, canary_during_outage_alerts_7d, open_awaiting_close_aged_7d, failure_rate_elevated_7d, correlation_events_7d',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntunePhase44Health | null) ?? null };
}

export async function getIntunePhase45Health(): Promise<{
  row: ItIntunePhase45Health | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_phase45_health')
    .select(
      'quality_review_count, quality_ready_count, quality_low_7d, promote_gate_count, promote_ready_latest_count, promote_blocked_7d, trend_degraded_7d, ops_alert_count, alerts_delivered_count, alerts_undelivered_count',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntunePhase45Health | null) ?? null };
}

export async function getIntunePhase46Health(): Promise<{
  row: ItIntunePhase46Health | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_phase46_health')
    .select(
      'scorecard_count, scorecard_ready_count, quality_score_low_7d, waive_pending_count, waive_approved_count, waive_decision_count, ops_alert_count, alerts_delivered_count, alerts_undelivered_count, dual_approve_required_7d',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntunePhase46Health | null) ?? null };
}

export async function getIntunePhase47Health(): Promise<{
  row: ItIntunePhase47Health | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_phase47_health')
    .select(
      'mttr_correlation_count, mttr_score_mismatch_7d, waive_expiry_pending_count, waive_extend_approved_count, waive_expire_approved_count, waive_expiry_decision_count, waive_expired_7d, ops_alert_count, alerts_delivered_count, alerts_undelivered_count',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntunePhase47Health | null) ?? null };
}

export async function getIntunePhase48Health(): Promise<{
  row: ItIntunePhase48Health | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_phase48_health')
    .select(
      'template_suggestion_count, template_mismatch_suggestions_7d, lifecycle_snapshot_count, lifecycle_expired_latest, lifecycle_extended_latest, lifecycle_proposed_latest, lifecycle_approved_latest, waive_expired_page_count, waive_expired_pages_delivered, ops_alert_count, alerts_delivered_count, alerts_undelivered_count',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntunePhase48Health | null) ?? null };
}

export async function listIntunePostmortemQualityStatus(limit = 50): Promise<{
  rows: ItIntunePostmortemQualityStatus[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_postmortem_quality_status')
    .select(
      'review_id, postmortem_id, quality_score, checklist, cycle_complete_count, trend_healthy, ready_for_tuning_promote, evidence_sha256, recorded_at, postmortem_status, root_cause_class',
    )
    .order('recorded_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntunePostmortemQualityStatus[] };
}

export async function listIntunePostmortemQualityScorecards(
  limit = 50,
): Promise<{
  rows: ItIntunePostmortemQualityScorecardStatus[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_postmortem_quality_scorecard_status')
    .select(
      'scorecard_id, postmortem_id, cycle_trend_component, correlation_coverage_component, root_cause_component, notes_quality_component, composite_score, checklist, cycle_complete_count, correlation_event_kinds, ready_for_tuning_promote, evidence_sha256, recorded_at, postmortem_status, root_cause_class',
    )
    .order('recorded_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntunePostmortemQualityScorecardStatus[] };
}

export async function listIntunePromoteWaiveStatus(limit = 50): Promise<{
  rows: ItIntunePromoteWaiveStatus[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_promote_waive_status')
    .select(
      'proposal_id, recommendation_id, proposed_by, proposed_reason, status, proposed_at, expires_at, row_version, evidence_sha256, decision_id, decided_by, decision_status, decided_at, recommendation_status, breaker_id, postmortem_id',
    )
    .order('proposed_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntunePromoteWaiveStatus[] };
}

export async function listIntunePromoteWaiveExpiryStatus(limit = 50): Promise<{
  rows: ItIntunePromoteWaiveExpiryStatus[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_promote_waive_expiry_status')
    .select(
      'expiry_proposal_id, waive_proposal_id, action, proposed_by, proposed_reason, new_expires_at, status, proposed_at, row_version, evidence_sha256, decision_id, decided_by, decision_status, decided_at, recommendation_id, waive_expires_at, waive_status',
    )
    .order('proposed_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntunePromoteWaiveExpiryStatus[] };
}

export async function listIntuneScorecardMttrCorrelations(
  limit = 50,
): Promise<{
  rows: ItIntuneScorecardMttrCorrelationStatus[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_scorecard_mttr_correlation_status')
    .select(
      'correlation_id, postmortem_id, scorecard_id, cycle_elapsed_minutes, composite_score, correlation_delta, aggregate_evidence, evidence_sha256, recorded_at, ready_for_tuning_promote, postmortem_status',
    )
    .order('recorded_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneScorecardMttrCorrelationStatus[] };
}

export async function listIntunePostmortemTemplateSuggestions(
  limit = 50,
): Promise<{
  rows: ItIntunePostmortemTemplateSuggestionStatus[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_postmortem_template_suggestion_status')
    .select(
      'suggestion_id, postmortem_id, scorecard_id, correlation_id, suggested_fields, mttr_minutes, composite_score, status, evidence_sha256, recorded_at, postmortem_status, root_cause_class',
    )
    .order('recorded_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntunePostmortemTemplateSuggestionStatus[] };
}

export async function getIntuneWaiveLifecycleStatus(): Promise<{
  row: ItIntuneWaiveLifecycleStatus | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_waive_lifecycle_status')
    .select(
      'snapshot_id, proposed_count, approved_count, rejected_count, expired_count, extended_count, expiry_pending_count, expire_action_approved_count, aggregate_evidence, evidence_sha256, bucket_key, recorded_at',
    )
    .maybeSingle();
  return error
    ? { row: null, error: error.message }
    : { row: (data as ItIntuneWaiveLifecycleStatus | null) ?? null };
}

export async function listIntuneTuningPromoteGateStatus(limit = 50): Promise<{
  rows: ItIntuneTuningPromoteGateStatus[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_tuning_promote_gate_status')
    .select(
      'gate_id, recommendation_id, proposal_id, gate_status, block_reasons, multi_cycle_count, failure_rate_trend, evidence_sha256, recorded_at, recommendation_status, breaker_id, postmortem_id',
    )
    .order('recorded_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneTuningPromoteGateStatus[] };
}

export async function listIntuneSoakCycleTimeline(limit = 30): Promise<{
  rows: ItIntuneSoakCycleTimeline[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_soak_cycle_timeline')
    .select(
      'cycle_id, recommendation_id, proposal_id, breaker_id, postmortem_id, open_observation_id, closed_observation_id, open_observed_at, closed_observed_at, cycle_elapsed_minutes, open_breaker_state, closed_breaker_state, cycle_status, sample_count, failure_count, failure_rate, evidence_sha256, recorded_at, closes_or_resets_breaker, entity_id, provider, operation, breaker_state, accepted_at, risk_class, postmortem_status',
    )
    .order('recorded_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneSoakCycleTimeline[] };
}

export async function listIntuneResilienceCorrelationTimeline(
  limit = 50,
): Promise<{
  rows: ItIntuneResilienceCorrelationEvent[];
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('os_it_intune_resilience_correlation_timeline')
    .select('breaker_id, event_kind, occurred_at, evidence_sha256, status')
    .order('occurred_at', { ascending: false })
    .limit(limit);
  return error
    ? { rows: [], error: error.message }
    : { rows: (data ?? []) as ItIntuneResilienceCorrelationEvent[] };
}

export async function getIntunePhase42OpsReport(): Promise<{
  report: Record<string, unknown> | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_it_intune_phase42_ops_report');
  return error
    ? { report: null, error: error.message }
    : { report: (data as Record<string, unknown> | null) ?? null };
}

export async function getIntunePhase43OpsReport(): Promise<{
  report: Record<string, unknown> | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_it_intune_phase43_ops_report');
  return error
    ? { report: null, error: error.message }
    : { report: (data as Record<string, unknown> | null) ?? null };
}

export async function getIntunePhase44OpsReport(): Promise<{
  report: Record<string, unknown> | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_it_intune_phase44_ops_report');
  return error
    ? { report: null, error: error.message }
    : { report: (data as Record<string, unknown> | null) ?? null };
}

export async function getIntunePhase45OpsReport(): Promise<{
  report: Record<string, unknown> | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_it_intune_phase45_ops_report');
  return error
    ? { report: null, error: error.message }
    : { report: (data as Record<string, unknown> | null) ?? null };
}

export async function getIntunePhase46OpsReport(): Promise<{
  report: Record<string, unknown> | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_it_intune_phase46_ops_report');
  return error
    ? { report: null, error: error.message }
    : { report: (data as Record<string, unknown> | null) ?? null };
}

export async function getIntunePhase47OpsReport(): Promise<{
  report: Record<string, unknown> | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_it_intune_phase47_ops_report');
  return error
    ? { report: null, error: error.message }
    : { report: (data as Record<string, unknown> | null) ?? null };
}

export async function getIntunePhase48OpsReport(): Promise<{
  report: Record<string, unknown> | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_it_intune_phase48_ops_report');
  return error
    ? { report: null, error: error.message }
    : { report: (data as Record<string, unknown> | null) ?? null };
}

export async function getIntuneTuningPromoteGate(input: {
  recommendation_id?: string;
  proposal_id?: string;
}): Promise<{
  gate: Record<string, unknown> | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'get_it_intune_tuning_promote_gate_phase47',
    {
      p_recommendation_id: input.recommendation_id ?? null,
      p_proposal_id: input.proposal_id ?? null,
    },
  );
  return error
    ? { gate: null, error: error.message }
    : { gate: (data as Record<string, unknown> | null) ?? null };
}

export async function evaluateIntuneTuningPromoteGate(input?: {
  recommendation_id?: string;
  proposal_id?: string;
}): Promise<{
  ok: true;
  detail?: Record<string, unknown>;
} | { ok: false; error: string }> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'evaluate_it_intune_tuning_promote_gate_phase46',
    {
      p_recommendation_id: input?.recommendation_id ?? null,
      p_proposal_id: input?.proposal_id ?? null,
    },
  );
  return error
    ? { ok: false, error: error.message }
    : {
        ok: true,
        detail: (data as Record<string, unknown> | null) ?? undefined,
      };
}

export async function observeIntuneRecommendationSoak() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'observe_it_intune_recommendation_soak_phase42',
  );
  return error
    ? { ok: false as const, error: error.message }
    : {
        ok: true as const,
        detail: (data as Record<string, unknown> | null) ?? undefined,
      };
}

export async function recordIntuneSoakCycleEvidence() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_it_intune_soak_cycle_evidence_phase43',
  );
  return error
    ? { ok: false as const, error: error.message }
    : {
        ok: true as const,
        detail: (data as Record<string, unknown> | null) ?? undefined,
      };
}

export async function runIntunePhase44ResilienceOps() {
  const { processIntunePhase44ResilienceOps } = await import(
    '@/lib/shared-services/it-intune-worker'
  );
  return processIntunePhase44ResilienceOps();
}

export async function runIntunePhase45QualityGateOps() {
  const { processIntunePhase45QualityGateOps } = await import(
    '@/lib/shared-services/it-intune-worker'
  );
  return processIntunePhase45QualityGateOps();
}

export async function runIntunePhase46QualityWaiveOps() {
  const { processIntunePhase46QualityWaiveOps } = await import(
    '@/lib/shared-services/it-intune-worker'
  );
  return processIntunePhase46QualityWaiveOps();
}

export async function runIntunePhase47ExpiryMttrOps() {
  const { processIntunePhase47ExpiryMttrOps } = await import(
    '@/lib/shared-services/it-intune-worker'
  );
  return processIntunePhase47ExpiryMttrOps();
}

export async function runIntunePhase48TemplateLifecycleOps() {
  const { processIntunePhase48TemplateLifecycleOps } = await import(
    '@/lib/shared-services/it-intune-worker'
  );
  return processIntunePhase48TemplateLifecycleOps();
}

export async function getIntunePhase49OpsReport(): Promise<{
  report: Record<string, unknown> | null;
  error?: string;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_it_intune_phase49_ops_report');
  return error
    ? { report: null, error: error.message }
    : { report: (data as Record<string, unknown> | null) ?? null };
}

export async function runIntunePhase49PublishGateOps() {
  const { processIntunePhase49PublishGateOps } = await import(
    '@/lib/shared-services/it-intune-worker'
  );
  return processIntunePhase49PublishGateOps();
}

// Human-apply a Phase 48 template suggestion onto its draft postmortem.
// Never auto-publish — this only appends the suggested notes fragment.
export async function requestIntunePostmortemApply(input: {
  suggestionId: string;
  actorId: string;
  expectedRowVersion: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'request_it_intune_postmortem_apply_phase49',
    {
      p_suggestion_id: input.suggestionId,
      p_actor_id: input.actorId,
      p_expected_row_version: input.expectedRowVersion,
    },
  );
  return error
    ? { ok: false as const, error: error.message }
    : {
        ok: true as const,
        detail: (data as Record<string, unknown> | null) ?? undefined,
      };
}

// Dual distinct-actor approval gate. Only calls the existing independent
// maker-checker publish RPC after 2 distinct approvals — never auto-publish.
export async function approveIntunePostmortemPublish(input: {
  postmortemId: string;
  actorId: string;
  decision: 'approve' | 'reject';
  statement: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'approve_it_intune_postmortem_publish_phase49',
    {
      p_postmortem_id: input.postmortemId,
      p_actor_id: input.actorId,
      p_decision: input.decision,
      p_statement: input.statement,
    },
  );
  return error
    ? { ok: false as const, error: error.message }
    : {
        ok: true as const,
        detail: (data as Record<string, unknown> | null) ?? undefined,
      };
}

export async function proposeIntunePromoteWaive(input: {
  recommendation_id: string;
  actor_id: string;
  reason: string;
  expected_row_version?: number | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'propose_it_intune_promote_waive_phase46',
    {
      p_recommendation_id: input.recommendation_id,
      p_actor_id: input.actor_id,
      p_reason: input.reason,
      p_expected_row_version: input.expected_row_version ?? null,
    },
  );
  return error
    ? { ok: false as const, error: error.message }
    : {
        ok: true as const,
        detail: (data as Record<string, unknown> | null) ?? undefined,
      };
}

export async function reviewIntunePromoteWaive(input: {
  proposal_id: string;
  actor_id: string;
  decision: 'approve' | 'reject';
  statement: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'review_it_intune_promote_waive_phase46',
    {
      p_proposal_id: input.proposal_id,
      p_actor_id: input.actor_id,
      p_decision: input.decision,
      p_statement: input.statement,
      p_expected_row_version: input.expected_row_version,
    },
  );
  return error
    ? { ok: false as const, error: error.message }
    : {
        ok: true as const,
        detail: (data as Record<string, unknown> | null) ?? undefined,
      };
}

export async function proposeIntunePromoteWaiveExpiry(input: {
  waive_proposal_id: string;
  actor_id: string;
  action: 'extend' | 'expire';
  reason: string;
  new_expires_at?: string | null;
  expected_row_version?: number | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'propose_it_intune_promote_waive_expiry_phase47',
    {
      p_waive_proposal_id: input.waive_proposal_id,
      p_actor_id: input.actor_id,
      p_action: input.action,
      p_reason: input.reason,
      p_new_expires_at: input.new_expires_at ?? null,
      p_expected_row_version: input.expected_row_version ?? null,
    },
  );
  return error
    ? { ok: false as const, error: error.message }
    : {
        ok: true as const,
        detail: (data as Record<string, unknown> | null) ?? undefined,
      };
}

export async function reviewIntunePromoteWaiveExpiry(input: {
  expiry_proposal_id: string;
  actor_id: string;
  decision: 'approve' | 'reject';
  statement: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'review_it_intune_promote_waive_expiry_phase47',
    {
      p_expiry_proposal_id: input.expiry_proposal_id,
      p_actor_id: input.actor_id,
      p_decision: input.decision,
      p_statement: input.statement,
      p_expected_row_version: input.expected_row_version,
    },
  );
  return error
    ? { ok: false as const, error: error.message }
    : {
        ok: true as const,
        detail: (data as Record<string, unknown> | null) ?? undefined,
      };
}

export async function updateIntuneOutagePostmortemDraft(input: {
  postmortem_id: string;
  actor_id: string;
  root_cause_class: ItIntuneOutagePostmortem['root_cause_class'];
  blameless_notes: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('update_it_intune_outage_postmortem_draft', {
    p_postmortem_id: input.postmortem_id,
    p_actor_id: input.actor_id,
    p_root_cause_class: input.root_cause_class,
    p_blameless_notes: input.blameless_notes,
    p_expected_row_version: input.expected_row_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function publishIntuneOutagePostmortem(input: {
  postmortem_id: string;
  actor_id: string;
  statement: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('publish_it_intune_outage_postmortem', {
    p_postmortem_id: input.postmortem_id,
    p_actor_id: input.actor_id,
    p_statement: input.statement,
    p_expected_row_version: input.expected_row_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function rejectIntuneOutagePostmortem(input: {
  postmortem_id: string;
  actor_id: string;
  statement: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('reject_it_intune_outage_postmortem', {
    p_postmortem_id: input.postmortem_id,
    p_actor_id: input.actor_id,
    p_statement: input.statement,
    p_expected_row_version: input.expected_row_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function acceptIntuneThresholdRecommendation(input: {
  recommendation_id: string;
  actor_id: string;
  reason: string;
  expected_breaker_version: number;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  // Phase 47: non-expired dual-approved waive (extend renews TTL) or ready gate.
  // Never closes or resets breakers.
  const { error } = await sb.rpc(
    'accept_it_intune_threshold_recommendation_phase47',
    {
      p_recommendation_id: input.recommendation_id,
      p_actor_id: input.actor_id,
      p_reason: input.reason,
      p_expected_breaker_version: input.expected_breaker_version,
      p_expected_row_version: input.expected_row_version,
    },
  );
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function dismissIntuneThresholdRecommendation(input: {
  recommendation_id: string;
  actor_id: string;
  statement: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { error } = await sb.rpc('dismiss_it_intune_threshold_recommendation', {
    p_recommendation_id: input.recommendation_id,
    p_actor_id: input.actor_id,
    p_statement: input.statement,
    p_expected_row_version: input.expected_row_version,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
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
