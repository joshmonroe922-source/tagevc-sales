/** HRIS employee CRUD + mapping. */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { entityDisplayName } from '@/lib/entities/display-name';
import { buildRecruitAssignment } from './recruit-hook';
import type {
  HrisEmployee,
  HrisEmployeeEvent,
  HrisEmployeeLink,
  HrisEmployeeStatus,
  RecruitAssignment,
} from './types';

function mapEmployee(row: Record<string, unknown>): HrisEmployee {
  const recruit = (row.recruit_assignment ?? {}) as RecruitAssignment;
  return {
    id: String(row.id),
    employee_key: String(row.employee_key),
    full_name: String(row.full_name),
    work_email: String(row.work_email ?? ''),
    personal_email: String(row.personal_email ?? ''),
    phone: String(row.phone ?? ''),
    entity_id: String(row.entity_id),
    role_title: String(row.role_title ?? ''),
    department: String(row.department ?? ''),
    location: String(row.location ?? ''),
    manager_employee_id: (row.manager_employee_id as string) ?? null,
    manager_name: String(row.manager_name ?? ''),
    status: row.status as HrisEmployeeStatus,
    start_date: row.start_date ? String(row.start_date).slice(0, 10) : null,
    end_date: row.end_date ? String(row.end_date).slice(0, 10) : null,
    offer_accepted_at: row.offer_accepted_at
      ? String(row.offer_accepted_at).slice(0, 10)
      : null,
    onboarding_status: row.onboarding_status as HrisEmployee['onboarding_status'],
    offboarding_status:
      row.offboarding_status as HrisEmployee['offboarding_status'],
    onboarding_pct: Number(row.onboarding_pct ?? 0),
    offboarding_pct: Number(row.offboarding_pct ?? 0),
    profile_id: (row.profile_id as string) ?? null,
    recruit_assignment: recruit,
    notes: String(row.notes ?? ''),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function employeeCompanyName(emp: Pick<HrisEmployee, 'entity_id'>): string {
  return entityDisplayName(emp.entity_id);
}

export async function listEmployees(opts?: {
  entityId?: string | null;
  status?: HrisEmployeeStatus | null;
  limit?: number;
}): Promise<{ rows: HrisEmployee[]; error?: string }> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_hris_employees')
      .select('*')
      .order('full_name', { ascending: true })
      .limit(opts?.limit ?? 200);
    if (opts?.entityId) q = q.eq('entity_id', opts.entityId);
    if (opts?.status) q = q.eq('status', opts.status);
    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((r) => mapEmployee(r as Record<string, unknown>)) };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'List employees failed',
    };
  }
}

export async function getEmployee(
  employeeId: string,
): Promise<{ employee: HrisEmployee | null; error?: string }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_hris_employees')
      .select('*')
      .eq('id', employeeId)
      .maybeSingle();
    if (error) return { employee: null, error: error.message };
    if (!data) return { employee: null };
    return { employee: mapEmployee(data as Record<string, unknown>) };
  } catch (e) {
    return {
      employee: null,
      error: e instanceof Error ? e.message : 'Get employee failed',
    };
  }
}

export async function getEmployeeByKey(
  employeeKey: string,
): Promise<{ employee: HrisEmployee | null; error?: string }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_hris_employees')
      .select('*')
      .eq('employee_key', employeeKey)
      .maybeSingle();
    if (error) return { employee: null, error: error.message };
    if (!data) return { employee: null };
    return { employee: mapEmployee(data as Record<string, unknown>) };
  } catch (e) {
    return {
      employee: null,
      error: e instanceof Error ? e.message : 'Get employee failed',
    };
  }
}

export type CreateEmployeeInput = {
  employee_key?: string;
  full_name: string;
  work_email?: string;
  personal_email?: string;
  phone?: string;
  entity_id: string;
  role_title?: string;
  department?: string;
  location?: string;
  manager_name?: string;
  manager_employee_id?: string | null;
  status?: HrisEmployeeStatus;
  start_date?: string | null;
  end_date?: string | null;
  offer_accepted_at?: string | null;
  notes?: string;
  profile_id?: string | null;
  created_by?: string | null;
  auto_start_onboarding?: boolean;
};

function slugKey(name: string, entityId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'employee'}-${entityId.toLowerCase()}-${Date.now().toString(36)}`;
}

export async function appendEmployeeEvent(input: {
  employee_id: string;
  event_kind: HrisEmployeeEvent['event_kind'];
  summary: string;
  detail?: Record<string, unknown>;
  actor_id?: string | null;
}): Promise<void> {
  try {
    const sb = await createPersistClient();
    await sb.from('os_hris_employee_events').insert({
      employee_id: input.employee_id,
      event_kind: input.event_kind,
      summary: input.summary,
      detail: input.detail ?? {},
      actor_id: input.actor_id ?? null,
    });
  } catch {
    /* soft */
  }
}

export async function createEmployee(
  input: CreateEmployeeInput,
): Promise<
  | { ok: true; employee: HrisEmployee; onboarding_run_id?: string }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const status = input.status ?? 'pre_start';
    const recruit = buildRecruitAssignment(input.entity_id);
    const row = {
      employee_key: input.employee_key?.trim() || slugKey(input.full_name, input.entity_id),
      full_name: input.full_name.trim(),
      work_email: input.work_email?.trim() ?? '',
      personal_email: input.personal_email?.trim() ?? '',
      phone: input.phone?.trim() ?? '',
      entity_id: input.entity_id,
      role_title: input.role_title?.trim() ?? '',
      department: input.department?.trim() ?? '',
      location: input.location?.trim() ?? '',
      manager_name: input.manager_name?.trim() ?? '',
      manager_employee_id: input.manager_employee_id ?? null,
      status,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      offer_accepted_at: input.offer_accepted_at ?? null,
      onboarding_status:
        status === 'onboarding' || status === 'pre_start'
          ? 'not_started'
          : 'none',
      recruit_assignment: recruit ?? {},
      notes: input.notes?.trim() ?? '',
      profile_id: input.profile_id ?? null,
      created_by: input.created_by ?? null,
    };

    const { data, error } = await sb
      .from('os_hris_employees')
      .insert(row)
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Insert failed' };
    }
    const employee = mapEmployee(data as Record<string, unknown>);
    await appendEmployeeEvent({
      employee_id: employee.id,
      event_kind: 'created',
      summary: `Employee created · ${employee.full_name}`,
      detail: { entity_id: employee.entity_id, status: employee.status },
      actor_id: input.created_by,
    });

    let onboarding_run_id: string | undefined;
    const shouldStart =
      input.auto_start_onboarding !== false &&
      (status === 'pre_start' || status === 'onboarding');
    if (shouldStart) {
      const { startProcessRun } = await import('./runs');
      const run = await startProcessRun({
        employee_id: employee.id,
        kind: 'onboarding',
        actor_id: input.created_by,
      });
      if (run.ok) onboarding_run_id = run.run.id;
    }

    return { ok: true, employee, onboarding_run_id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Create employee failed',
    };
  }
}

export async function updateEmployee(
  employeeId: string,
  patch: Partial<CreateEmployeeInput> & {
    onboarding_status?: HrisEmployee['onboarding_status'];
    offboarding_status?: HrisEmployee['offboarding_status'];
    onboarding_pct?: number;
    offboarding_pct?: number;
  },
): Promise<{ ok: true; employee: HrisEmployee } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const existing = await getEmployee(employeeId);
    if (!existing.employee) {
      return { ok: false, error: existing.error ?? 'Not found' };
    }

    const entityId = patch.entity_id ?? existing.employee.entity_id;
    const recruit =
      patch.entity_id && patch.entity_id !== existing.employee.entity_id
        ? buildRecruitAssignment(patch.entity_id, existing.employee.recruit_assignment)
        : undefined;

    const update: Record<string, unknown> = {};
    for (const key of [
      'full_name',
      'work_email',
      'personal_email',
      'phone',
      'entity_id',
      'role_title',
      'department',
      'location',
      'manager_name',
      'manager_employee_id',
      'status',
      'start_date',
      'end_date',
      'offer_accepted_at',
      'notes',
      'profile_id',
      'onboarding_status',
      'offboarding_status',
      'onboarding_pct',
      'offboarding_pct',
    ] as const) {
      if (patch[key] !== undefined) update[key] = patch[key];
    }
    if (recruit) update.recruit_assignment = recruit;

    const { data, error } = await sb
      .from('os_hris_employees')
      .update(update)
      .eq('id', employeeId)
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Update failed' };
    }
    const employee = mapEmployee(data as Record<string, unknown>);

    if (patch.status && patch.status !== existing.employee.status) {
      await appendEmployeeEvent({
        employee_id: employeeId,
        event_kind: 'status_change',
        summary: `Status ${existing.employee.status} → ${patch.status}`,
        detail: { from: existing.employee.status, to: patch.status },
      });
    }

    if (
      patch.start_date ||
      patch.end_date ||
      patch.offer_accepted_at ||
      patch.status === 'offboarding'
    ) {
      const { retimeOpenRunsForEmployee } = await import('./runs');
      await retimeOpenRunsForEmployee(employeeId);
    }

    return { ok: true, employee };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Update failed',
    };
  }
}

export async function listEmployeeEvents(
  employeeId: string,
  limit = 40,
): Promise<HrisEmployeeEvent[]> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_hris_employee_events')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        employee_id: String(r.employee_id),
        event_kind: r.event_kind as HrisEmployeeEvent['event_kind'],
        summary: String(r.summary),
        detail: (r.detail as Record<string, unknown>) ?? {},
        created_at: String(r.created_at),
      };
    });
  } catch {
    return [];
  }
}

export async function listEmployeeLinks(
  employeeId: string,
): Promise<HrisEmployeeLink[]> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_hris_employee_links')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        employee_id: String(r.employee_id),
        kind: r.kind as HrisEmployeeLink['kind'],
        ref_id: String(r.ref_id),
        label: String(r.label),
        href: (r.href as string) ?? null,
        created_at: String(r.created_at),
      };
    });
  } catch {
    return [];
  }
}

export async function addEmployeeLink(input: {
  employee_id: string;
  kind: HrisEmployeeLink['kind'];
  ref_id: string;
  label: string;
  href?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { error } = await sb.from('os_hris_employee_links').insert({
      employee_id: input.employee_id,
      kind: input.kind,
      ref_id: input.ref_id,
      label: input.label,
      href: input.href ?? null,
    });
    if (error) return { ok: false, error: error.message };
    await appendEmployeeEvent({
      employee_id: input.employee_id,
      event_kind: 'link_added',
      summary: `Linked ${input.label}`,
      detail: { kind: input.kind, ref_id: input.ref_id },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Link failed' };
  }
}
