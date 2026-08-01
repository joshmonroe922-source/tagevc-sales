/**
 * Bulk CSV import matching Seed_Export header rows from Vendor Management.xlsx.
 * Deny-by-default: only known tables; never invents secrets.
 */

export type CsvImportKind =
  | 'vendors'
  | 'employees'
  | 'products'
  | 'roles'
  | 'admin_users'
  | 'cost_centers';

export const CSV_HEADERS: Record<CsvImportKind, string[]> = {
  vendors: [
    'vendor_id',
    'name',
    'entity_id',
    'category',
    'product',
    'pricing_model',
    'billing_cadence',
    'invoice_amount',
    'currency',
    'seats_contracted',
    'seats_active',
    'unit_price',
    'contract_start',
    'contract_end',
    'auto_renew',
    'status',
    'owner',
    'notes',
  ],
  employees: [
    'emp_id',
    'name',
    'entity_id',
    'role_id',
    'status',
    'start_date',
    'manager_emp_id',
    'notes',
  ],
  products: [
    'product_id',
    'name',
    'vendor_id',
    'entity_scope',
    'license_type',
    'cost_seat_mo',
    'fixed_cost_mo',
    'requires_sso',
    'sensitivity',
    'offboard_action',
    'active',
    'notes',
  ],
  roles: ['role_id', 'name', 'entity_id', 'level', 'dept', 'notes'],
  admin_users: [
    'admin_user_id',
    'display_name',
    'email',
    'emp_id',
    'admin_role_id',
    'entity_scope',
    'status',
    'mfa_enrolled',
    'notes',
  ],
  cost_centers: [
    'cost_center_id',
    'name',
    'entity_id',
    'dept_code',
    'cc_type',
    'status',
    'notes',
  ],
};

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? '').trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function validateCsvHeaders(
  kind: CsvImportKind,
  headers: string[],
): { ok: true } | { ok: false; error: string; missing: string[] } {
  const required = CSV_HEADERS[kind];
  const set = new Set(headers.map((h) => h.trim()));
  const missing = required.filter((h) => !set.has(h));
  // Allow subset if at least id + name (+ entity when required)
  const min =
    kind === 'vendors'
      ? ['vendor_id', 'name', 'entity_id']
      : kind === 'employees'
        ? ['emp_id', 'name', 'entity_id']
        : kind === 'products'
          ? ['product_id', 'name']
          : kind === 'roles'
            ? ['role_id', 'name', 'entity_id']
            : kind === 'admin_users'
              ? ['admin_user_id', 'display_name', 'email', 'admin_role_id']
              : ['cost_center_id', 'name', 'entity_id'];
  const minMissing = min.filter((h) => !set.has(h));
  if (minMissing.length) {
    return {
      ok: false,
      error: `Missing required columns: ${minMissing.join(', ')}`,
      missing: minMissing,
    };
  }
  return { ok: true };
}

export function boolish(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

export function numOrNull(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
