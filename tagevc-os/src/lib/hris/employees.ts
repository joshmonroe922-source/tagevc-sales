/** HRIS employee CRUD + mapping. */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeAuditEvent } from '@/lib/audit/write';
import { entityDisplayName } from '@/lib/entities/display-name';
import { getActiveManagerProfile } from '@/lib/hris/people';
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
    manager_profile_id: (row.manager_profile_id as string) ?? null,
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
    comp_amount:
      row.comp_amount === null || row.comp_amount === undefined
        ? null
        : Number(row.comp_amount),
    comp_currency: String(row.comp_currency ?? 'USD'),
    comp_basis: (row.comp_basis as HrisEmployee['comp_basis']) || 'salary',
    pay_frequency:
      (row.pay_frequency as HrisEmployee['pay_frequency']) || 'annual',
    bonus_amount:
      row.bonus_amount === null || row.bonus_amount === undefined
        ? null
        : Number(row.bonus_amount),
    bonus_currency: String(row.bonus_currency ?? 'USD'),
    bonus_frequency:
      (row.bonus_frequency as HrisEmployee['bonus_frequency']) || 'none',
    bonus_type: (row.bonus_type as HrisEmployee['bonus_type']) || 'none',
    bonus_notes: String(row.bonus_notes ?? ''),
    profile_id: (row.profile_id as string) ?? null,
    entra_object_id: (row.entra_object_id as string) ?? null,
    upn: (row.upn as string) ?? null,
    identity_status: String(row.identity_status ?? 'unknown'),
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
  managerProfileId?: string | null;
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
    if (opts?.managerProfileId) {
      q = q.eq('manager_profile_id', opts.managerProfileId);
    }
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

/** Strip compensation fields for non-HR viewers (managers). */
export function redactEmployeeComp(emp: HrisEmployee): HrisEmployee {
  return {
    ...emp,
    comp_amount: null,
    comp_currency: 'USD',
    comp_basis: 'salary',
    pay_frequency: 'annual',
    bonus_amount: null,
    bonus_currency: 'USD',
    bonus_frequency: 'none',
    bonus_type: 'none',
    bonus_notes: '',
    notes: '',
  };
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
  manager_profile_id?: string | null;
  status?: HrisEmployeeStatus;
  start_date?: string | null;
  end_date?: string | null;
  offer_accepted_at?: string | null;
  notes?: string;
  profile_id?: string | null;
  created_by?: string | null;
  auto_start_onboarding?: boolean;
  comp_amount?: number | null;
  comp_currency?: string;
  comp_basis?: HrisEmployee['comp_basis'];
  pay_frequency?: HrisEmployee['pay_frequency'];
  bonus_amount?: number | null;
  bonus_currency?: string;
  bonus_frequency?: HrisEmployee['bonus_frequency'];
  bonus_type?: HrisEmployee['bonus_type'];
  bonus_notes?: string;
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
    let managerProfileId = input.manager_profile_id?.trim() || null;
    let managerName = input.manager_name?.trim() ?? '';
    if (managerProfileId) {
      const mgr = await getActiveManagerProfile(managerProfileId);
      if (!mgr) {
        return {
          ok: false,
          error: 'Manager must be an active eligible profile',
        };
      }
      managerProfileId = mgr.id;
      if (!managerName) managerName = mgr.full_name || mgr.email;
    }

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
      manager_name: managerName,
      manager_employee_id: input.manager_employee_id ?? null,
      manager_profile_id: managerProfileId,
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
      comp_amount: input.comp_amount ?? null,
      comp_currency: input.comp_currency ?? 'USD',
      comp_basis: input.comp_basis ?? 'salary',
      pay_frequency: input.pay_frequency ?? 'annual',
      bonus_amount: input.bonus_amount ?? null,
      bonus_currency: input.bonus_currency ?? 'USD',
      bonus_frequency: input.bonus_frequency ?? 'none',
      bonus_type: input.bonus_type ?? 'none',
      bonus_notes: input.bonus_notes?.trim() ?? '',
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

    if (employee.profile_id || input.profile_id) {
      const { syncProfileFromHire } = await import('@/lib/org/repo');
      await syncProfileFromHire({
        profileId: employee.profile_id || input.profile_id,
        managerProfileId: managerProfileId,
        jobTitle: employee.role_title,
      });
    }

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

    // Validate manager assignment before write
    if (patch.manager_profile_id !== undefined) {
      const nextId = patch.manager_profile_id?.trim() || null;
      if (nextId) {
        const mgr = await getActiveManagerProfile(nextId);
        if (!mgr) {
          return {
            ok: false,
            error: 'Manager must be an active eligible profile',
          };
        }
        patch.manager_profile_id = mgr.id;
        if (!patch.manager_name?.trim()) {
          patch.manager_name = mgr.full_name || mgr.email;
        }
      } else {
        patch.manager_profile_id = null;
      }
    }

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
      'manager_profile_id',
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
      'comp_amount',
      'comp_currency',
      'comp_basis',
      'pay_frequency',
      'bonus_amount',
      'bonus_currency',
      'bonus_frequency',
      'bonus_type',
      'bonus_notes',
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
      patch.manager_profile_id !== undefined &&
      patch.manager_profile_id !== existing.employee.manager_profile_id
    ) {
      await appendEmployeeEvent({
        employee_id: employeeId,
        event_kind: 'note',
        summary: patch.manager_profile_id
          ? `Manager assigned · ${employee.manager_name || patch.manager_profile_id}`
          : 'Manager cleared',
        detail: {
          from: existing.employee.manager_profile_id,
          to: patch.manager_profile_id,
          manager_name: employee.manager_name,
        },
      });
      await writeAuditEvent({
        action: 'hris_action',
        title: patch.manager_profile_id
          ? `HRIS manager assigned · ${employee.full_name} → ${employee.manager_name || 'profile'}`
          : `HRIS manager cleared · ${employee.full_name}`,
        object_type: 'hris_employee',
        object_id: employeeId,
        entity_id: employee.entity_id,
        metadata: {
          from_manager_profile_id: existing.employee.manager_profile_id,
          to_manager_profile_id: patch.manager_profile_id,
        },
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
