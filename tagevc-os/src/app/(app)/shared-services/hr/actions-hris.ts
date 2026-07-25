'use server';

import { revalidatePath } from 'next/cache';
import {
  addEmployeeLink,
  createEmployee,
  updateEmployee,
  type CreateEmployeeInput,
} from '@/lib/hris/employees';
import { runHrisCadence } from '@/lib/hris/cadence-runner';
import { startProcessRun, updateStepStatus } from '@/lib/hris/runs';
import type { HrisStepStatus } from '@/lib/hris/types';
import { getSessionContext, guardPermission } from '@/lib/rbac/session';

function revalidateHris(employeeId?: string) {
  revalidatePath('/shared-services/hr');
  revalidatePath('/shared-services/hr/employees');
  revalidatePath('/shared-services/hr/onboarding');
  revalidatePath('/shared-services/hr/offboarding');
  if (employeeId) {
    revalidatePath(`/shared-services/hr/employees/${employeeId}`);
  }
}

export type HrisActionResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string };

export async function createHrisEmployeeAction(
  formData: FormData,
): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const session = await getSessionContext();

  const input: CreateEmployeeInput = {
    full_name: String(formData.get('full_name') ?? '').trim(),
    work_email: String(formData.get('work_email') ?? '').trim(),
    personal_email: String(formData.get('personal_email') ?? '').trim(),
    phone: String(formData.get('phone') ?? '').trim(),
    entity_id: String(formData.get('entity_id') ?? 'ENT-FIRM').trim(),
    role_title: String(formData.get('role_title') ?? '').trim(),
    department: String(formData.get('department') ?? '').trim(),
    location: String(formData.get('location') ?? '').trim(),
    manager_name: String(formData.get('manager_name') ?? '').trim(),
    start_date: String(formData.get('start_date') ?? '').trim() || null,
    offer_accepted_at:
      String(formData.get('offer_accepted_at') ?? '').trim() || null,
    status: 'pre_start',
    notes: String(formData.get('notes') ?? '').trim(),
    created_by: session?.profile.id ?? null,
    auto_start_onboarding: true,
  };

  if (input.full_name.length < 2) {
    return { ok: false, error: 'Name is required' };
  }

  const res = await createEmployee(input);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateHris(res.employee.id);
  return {
    ok: true,
    message: `Created ${res.employee.full_name}${res.onboarding_run_id ? ' · onboarding started' : ''}`,
    id: res.employee.id,
  };
}

export async function updateHrisEmployeeAction(
  employeeId: string,
  formData: FormData,
): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };

  const res = await updateEmployee(employeeId, {
    full_name: String(formData.get('full_name') ?? '').trim() || undefined,
    work_email: String(formData.get('work_email') ?? '').trim(),
    personal_email: String(formData.get('personal_email') ?? '').trim(),
    phone: String(formData.get('phone') ?? '').trim(),
    entity_id: String(formData.get('entity_id') ?? '').trim() || undefined,
    role_title: String(formData.get('role_title') ?? '').trim(),
    department: String(formData.get('department') ?? '').trim(),
    location: String(formData.get('location') ?? '').trim(),
    manager_name: String(formData.get('manager_name') ?? '').trim(),
    start_date: String(formData.get('start_date') ?? '').trim() || null,
    end_date: String(formData.get('end_date') ?? '').trim() || null,
    offer_accepted_at:
      String(formData.get('offer_accepted_at') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim(),
    status: (String(formData.get('status') ?? '').trim() ||
      undefined) as CreateEmployeeInput['status'],
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateHris(employeeId);
  return { ok: true, message: 'Employee updated', id: employeeId };
}

export async function startHrisOffboardingAction(
  employeeId: string,
  endDate?: string | null,
): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const session = await getSessionContext();

  if (endDate) {
    await updateEmployee(employeeId, {
      end_date: endDate,
      status: 'offboarding',
    });
  } else {
    await updateEmployee(employeeId, {
      end_date: new Date().toISOString().slice(0, 10),
      status: 'offboarding',
    });
  }

  const res = await startProcessRun({
    employee_id: employeeId,
    kind: 'offboarding',
    actor_id: session?.profile.id ?? null,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateHris(employeeId);
  return { ok: true, message: 'Offboarding started (revoke-first)', id: res.run.id };
}

export async function startHrisOnboardingAction(
  employeeId: string,
): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const session = await getSessionContext();
  const res = await startProcessRun({
    employee_id: employeeId,
    kind: 'onboarding',
    actor_id: session?.profile.id ?? null,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateHris(employeeId);
  return { ok: true, message: 'Onboarding started', id: res.run.id };
}

export async function updateHrisStepAction(input: {
  stepId: string;
  employeeId: string;
  status: HrisStepStatus;
  evidenceNote?: string;
  confirmDestructive?: boolean;
}): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const session = await getSessionContext();
  const res = await updateStepStatus({
    step_id: input.stepId,
    status: input.status,
    evidence_note: input.evidenceNote,
    confirm_destructive: input.confirmDestructive,
    actor_id: session?.profile.id ?? null,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // Visionary mailbox FullAccess assist (fail-soft)
  if (
    input.status === 'done' &&
    res.step.step_key === 'bs.visionary_mailbox_access'
  ) {
    try {
      const { getEmployee } = await import('@/lib/hris/employees');
      const {
        runVisionaryMailboxAssist,
      } = await import('@/lib/hris/visionary-mailbox');
      const emp = await getEmployee(input.employeeId);
      const assist = await runVisionaryMailboxAssist({
        employeeEmail: emp?.work_email ?? emp?.personal_email ?? null,
        employeeUserId: emp?.id ?? null,
        entityId: emp?.entity_id ?? null,
      });
      revalidateHris(input.employeeId);
      return {
        ok: true,
        message: `Step → ${input.status}. Mailbox assist: ${assist.detail}`,
      };
    } catch {
      /* keep step success even if assist fails */
    }
  }

  revalidateHris(input.employeeId);
  return { ok: true, message: `Step → ${input.status}` };
}

export async function addHrisLinkAction(input: {
  employeeId: string;
  kind: 'document' | 'equipment' | 'access' | 'ticket' | 'other';
  refId: string;
  label: string;
  href?: string;
}): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const res = await addEmployeeLink({
    employee_id: input.employeeId,
    kind: input.kind,
    ref_id: input.refId,
    label: input.label,
    href: input.href ?? null,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateHris(input.employeeId);
  return { ok: true, message: 'Link added' };
}

export async function runHrisCadenceAction(
  kind: 'full' | 'timing' | 'escalate' = 'full',
): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const session = await getSessionContext();
  const res = await runHrisCadence({
    run_kind: kind,
    trigger_source: 'manual',
    actor_id: session?.profile.id ?? null,
  });
  revalidateHris();
  if (!res.ok) return { ok: false, error: res.error ?? 'Cadence failed' };
  return {
    ok: true,
    message: `Cadence ${kind}: retimed ${res.steps_retimed}, escalated ${res.escalations_created}`,
  };
}
