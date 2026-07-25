'use server';

import { revalidatePath } from 'next/cache';
import {
  addEmployeeLink,
  createEmployee,
  updateEmployee,
  type CreateEmployeeInput,
} from '@/lib/hris/employees';
import { canViewHrisCompensation, isManagerOwnedStep } from '@/lib/hris/access';
import { runHrisCadence } from '@/lib/hris/cadence-runner';
import { uploadHrisDocument, type HrisDocKind } from '@/lib/hris/documents';
import { grantVisionaryMailboxForExistingEmployees } from '@/lib/hris/step-assists';
import { dispatchHrisStepAssist } from '@/lib/hris/step-assists';
import { getRunWithSteps, startProcessRun, updateStepStatus } from '@/lib/hris/runs';
import type { HrisStepStatus } from '@/lib/hris/types';
import { getSessionContext, guardPermission } from '@/lib/rbac/session';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getActiveManagerProfile,
  searchManagerCandidates,
  type PeoplePickerRow,
} from '@/lib/hris/people';

function revalidateHris(employeeId?: string) {
  revalidatePath('/shared-services/hr');
  revalidatePath('/shared-services/hr/employees');
  revalidatePath('/shared-services/hr/onboarding');
  revalidatePath('/shared-services/hr/offboarding');
  revalidatePath('/shared-services/hr/manager');
  if (employeeId) {
    revalidatePath(`/shared-services/hr/employees/${employeeId}`);
  }
}

export type HrisActionResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string };

export async function searchManagerCandidatesAction(
  query: string,
): Promise<
  { ok: true; users: PeoplePickerRow[] } | { ok: false; error: string }
> {
  const gate = await guardPermission('read:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const users = await searchManagerCandidates(query);
  return { ok: true, users };
}

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
    manager_profile_id:
      String(formData.get('manager_profile_id') ?? '').trim() || null,
    start_date: String(formData.get('start_date') ?? '').trim() || null,
    offer_accepted_at:
      String(formData.get('offer_accepted_at') ?? '').trim() || null,
    status: 'pre_start',
    notes: String(formData.get('notes') ?? '').trim(),
    created_by: session?.profile.id ?? null,
    auto_start_onboarding: true,
  };

  if (input.manager_profile_id && !input.manager_name) {
    const mgr = await getActiveManagerProfile(input.manager_profile_id);
    if (mgr) input.manager_name = mgr.full_name || mgr.email;
  }

  if (session && canViewHrisCompensation(session.profile.role)) {
    const amt = String(formData.get('comp_amount') ?? '').trim();
    input.comp_amount = amt ? Number(amt) : null;
    input.comp_currency =
      String(formData.get('comp_currency') ?? 'USD').trim() || 'USD';
    input.comp_basis = (String(formData.get('comp_basis') ?? 'salary').trim() ||
      'salary') as CreateEmployeeInput['comp_basis'];
    input.pay_frequency = (String(
      formData.get('pay_frequency') ?? 'annual',
    ).trim() || 'annual') as CreateEmployeeInput['pay_frequency'];
  }

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
  const session = await getSessionContext();

  const patch: Partial<CreateEmployeeInput> & {
    status?: CreateEmployeeInput['status'];
  } = {
    full_name: String(formData.get('full_name') ?? '').trim() || undefined,
    work_email: String(formData.get('work_email') ?? '').trim(),
    personal_email: String(formData.get('personal_email') ?? '').trim(),
    phone: String(formData.get('phone') ?? '').trim(),
    entity_id: String(formData.get('entity_id') ?? '').trim() || undefined,
    role_title: String(formData.get('role_title') ?? '').trim(),
    department: String(formData.get('department') ?? '').trim(),
    location: String(formData.get('location') ?? '').trim(),
    manager_name: String(formData.get('manager_name') ?? '').trim(),
    manager_profile_id:
      String(formData.get('manager_profile_id') ?? '').trim() || null,
    start_date: String(formData.get('start_date') ?? '').trim() || null,
    end_date: String(formData.get('end_date') ?? '').trim() || null,
    offer_accepted_at:
      String(formData.get('offer_accepted_at') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim(),
    status: (String(formData.get('status') ?? '').trim() ||
      undefined) as CreateEmployeeInput['status'],
  };

  // If picker set a profile, prefer profile display name when manager_name blank
  if (patch.manager_profile_id && !patch.manager_name) {
    const mgr = await getActiveManagerProfile(patch.manager_profile_id);
    if (mgr) patch.manager_name = mgr.full_name || mgr.email;
  }

  if (session && canViewHrisCompensation(session.profile.role)) {
    const amt = String(formData.get('comp_amount') ?? '').trim();
    patch.comp_amount = amt ? Number(amt) : null;
    patch.comp_currency =
      String(formData.get('comp_currency') ?? 'USD').trim() || 'USD';
    patch.comp_basis = (String(formData.get('comp_basis') ?? 'salary').trim() ||
      'salary') as CreateEmployeeInput['comp_basis'];
    patch.pay_frequency = (String(
      formData.get('pay_frequency') ?? 'annual',
    ).trim() || 'annual') as CreateEmployeeInput['pay_frequency'];
  }

  const res = await updateEmployee(employeeId, patch);
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
  confirmDocuSign?: boolean;
  managerMode?: boolean;
}): Promise<HrisActionResult> {
  const session = await getSessionContext();
  if (!session) return { ok: false, error: 'Not authenticated' };

  // Manager self-service: can complete manager-owned steps for reports only
  if (input.managerMode) {
    const gate = await guardPermission('read:shared_services');
    if (!gate.ok) return { ok: false, error: gate.error };

    const sb = await createPersistClient();
    const { data: stepRow } = await sb
      .from('os_hris_process_steps')
      .select('*')
      .eq('id', input.stepId)
      .maybeSingle();
    if (!stepRow) return { ok: false, error: 'Step not found' };
    const owner = String(stepRow.owner_role ?? '');
    if (
      !isManagerOwnedStep({
        owner_role: owner,
      })
    ) {
      return { ok: false, error: 'Managers can only complete manager-owned steps' };
    }

    const { data: emp } = await sb
      .from('os_hris_employees')
      .select('manager_profile_id')
      .eq('id', input.employeeId)
      .maybeSingle();
    if (!emp || emp.manager_profile_id !== session.profile.id) {
      return { ok: false, error: 'Not your assigned employee' };
    }
  } else {
    const gate = await guardPermission('write:shared_services');
    if (!gate.ok) return { ok: false, error: gate.error };
  }

  // Pre-check DocuSign: require human confirm before marking done
  if (input.status === 'done' && !input.managerMode) {
    const sb = await createPersistClient();
    const { data: peek } = await sb
      .from('os_hris_process_steps')
      .select('step_key, system_hook, title')
      .eq('id', input.stepId)
      .maybeSingle();
    const hook = (peek?.system_hook as string) ?? null;
    const key = String(peek?.step_key ?? '');
    const title = String(peek?.title ?? '');
    const isDs =
      hook === 'docusign_send' ||
      key === 'pre.offer_letter' ||
      /nda/i.test(key) ||
      /nda/i.test(title);
    if (isDs && !input.confirmDocuSign) {
      return {
        ok: false,
        error:
          'DocuSign send requires explicit confirmation. Confirm to send offer/NDA.',
      };
    }
  }

  const res = await updateStepStatus({
    step_id: input.stepId,
    status: input.status,
    evidence_note: input.evidenceNote,
    confirm_destructive: input.confirmDestructive,
    actor_id: session.profile.id,
  });
  if (!res.ok) return { ok: false, error: res.error };

  let assistMsg = '';
  if (input.status === 'done' && !input.managerMode) {
    try {
      const assist = await dispatchHrisStepAssist({
        step: res.step,
        employeeId: input.employeeId,
        actorId: session.profile.id,
        actorEmail: session.profile.email,
        confirmDocuSign: input.confirmDocuSign,
      });
      if (assist.handled) {
        assistMsg = ` · Assist: ${assist.detail}`;
        if (assist.evidence_note || assist.evidence_url) {
          await updateStepStatus({
            step_id: input.stepId,
            status: 'done',
            evidence_note: assist.evidence_note ?? input.evidenceNote,
            evidence_url: assist.evidence_url,
            actor_id: session.profile.id,
            confirm_destructive: true,
          });
        }
      }
    } catch (e) {
      assistMsg = ` · Assist soft-fail: ${e instanceof Error ? e.message : 'error'}`;
    }
  }

  revalidateHris(input.employeeId);
  return { ok: true, message: `Step → ${input.status}${assistMsg}` };
}

export async function uploadHrisDocumentAction(input: {
  employeeId: string;
  stepId?: string | null;
  kind: HrisDocKind;
  title: string;
  fileName: string;
  mimeType: string;
  base64: string;
}): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const session = await getSessionContext();
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.byteLength > 20 * 1024 * 1024) {
    return { ok: false, error: 'File too large (20MB max)' };
  }
  const res = await uploadHrisDocument({
    employeeId: input.employeeId,
    stepId: input.stepId,
    kind: input.kind,
    title: input.title,
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes,
    uploadedBy: session?.profile.id ?? null,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateHris(input.employeeId);
  return { ok: true, message: `Uploaded ${res.doc.title}`, id: res.doc.id };
}

export async function grantExistingMailboxAction(): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const res = await grantVisionaryMailboxForExistingEmployees(50);
  revalidateHris();
  return {
    ok: true,
    message: `Mailbox grant pass: attempted ${res.attempted}, ok ${res.ok}, skipped ${res.skipped}`,
  };
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

/** Ensure open run steps match template hooks (Dennis hardening helper). */
export async function syncOpenRunStepHooksAction(
  runId: string,
): Promise<HrisActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const { run } = await getRunWithSteps(runId);
  if (!run) return { ok: false, error: 'Run not found' };
  revalidateHris(run.employee_id);
  return { ok: true, message: `Run ${run.run_key} loaded (${run.steps?.length ?? 0} steps)` };
}
