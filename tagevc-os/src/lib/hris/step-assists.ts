/**
 * HRIS step assists: Graph joiner, mailbox, DocuSign, Gusto, IT child runs.
 */

import { writeAuditEvent } from '@/lib/audit/write';
import {
  createOrUpdateGraphUserJoiner,
  grantVisionaryMailboxFullAccess,
} from '@/lib/shared-services/it-mdm';
import { runVisionaryMailboxAssist } from '@/lib/hris/visionary-mailbox';
import { sendHrisStepViaDocuSign } from '@/lib/hris/docusign-step';
import type { HrisEmployee, HrisProcessStep } from '@/lib/hris/types';
import { addEmployeeLink, getEmployee } from '@/lib/hris/employees';
import { updateStepStatus } from '@/lib/hris/runs';
import { startOnboarding } from '@/lib/shared-services/it-onboarding';
import { startOffboarding } from '@/lib/shared-services/it-offboarding';
import { runPartnerLifecycleHook } from '@/lib/partners/adapters';
import {
  isEmailSignatureStep,
  runEmailSignatureAssist,
} from '@/lib/hris/email-signature-step';
import {
  activateDigitalCardForEmployee,
  revokeDigitalCardsForEmployee,
} from '@/lib/digital-cards/lifecycle';

export type StepAssistResult = {
  handled: boolean;
  detail: string;
  evidence_note?: string;
  evidence_url?: string | null;
  requires_confirm?: boolean;
};

export async function runGraphJoinerAssist(
  emp: HrisEmployee,
): Promise<StepAssistResult> {
  const result = await createOrUpdateGraphUserJoiner({
    display_name: emp.full_name,
    work_email: emp.work_email || emp.personal_email,
    job_title: emp.role_title,
    department: emp.department,
    entity_id: emp.entity_id,
  });
  await writeAuditEvent({
    action: 'hris_action',
    title: `Graph joiner · ${emp.full_name}`,
    object_type: 'employee',
    object_id: emp.id,
    entity_id: emp.entity_id,
    metadata: {
      ok: result.ok,
      skipped: result.skipped ?? false,
      detail: result.detail,
      graph_user_id: result.graph_user_id ?? null,
    },
  });
  return {
    handled: true,
    detail: result.detail,
    evidence_note: result.detail,
  };
}

export async function runMailboxAssistForEmployee(
  emp: HrisEmployee,
): Promise<StepAssistResult> {
  const assist = await runVisionaryMailboxAssist({
    employeeEmail: emp.work_email || emp.personal_email,
    employeeUserId: emp.id,
    entityId: emp.entity_id,
  });
  return {
    handled: true,
    detail: assist.detail,
    evidence_note: assist.detail,
  };
}

/** Attempt mailbox grant for all active/onboarding employees (fail-soft). */
export async function grantVisionaryMailboxForExistingEmployees(limit = 50): Promise<{
  attempted: number;
  ok: number;
  skipped: number;
  details: string[];
}> {
  const { listEmployees } = await import('@/lib/hris/employees');
  const { rows } = await listEmployees({ limit });
  const details: string[] = [];
  let ok = 0;
  let skipped = 0;
  let attempted = 0;
  for (const emp of rows) {
    if (!['active', 'onboarding', 'pre_start'].includes(emp.status)) continue;
    const email = emp.work_email || emp.personal_email;
    if (!email) continue;
    attempted += 1;
    const res = await grantVisionaryMailboxFullAccess({
      user_id: emp.id,
      email,
    });
    details.push(`${emp.full_name}: ${res.detail}`);
    if (res.ok) ok += 1;
    else if (res.skipped) skipped += 1;
  }
  return { attempted, ok, skipped, details: details.slice(0, 30) };
}

export async function linkItChildRun(input: {
  employee: HrisEmployee;
  kind: 'it_onboarding' | 'it_offboarding';
  actorId?: string | null;
}): Promise<StepAssistResult> {
  const emp = input.employee;
  const userKey = emp.profile_id || emp.work_email || emp.id;
  try {
    if (input.kind === 'it_onboarding') {
      const run = await startOnboarding({
        user_id: userKey,
        entity_id: emp.entity_id,
        actor_id: input.actorId,
        notes: `Linked from HRIS employee ${emp.full_name}`,
        source: 'hr_ticket',
        auto_execute: false,
      });
      if (!run.ok) {
        return { handled: true, detail: run.error };
      }
      const runId = run.run.run_id;
      await addEmployeeLink({
        employee_id: emp.id,
        kind: 'it_onboarding',
        ref_id: runId,
        label: `IT onboarding · ${runId}`,
        href: `/shared-services/it/assets?onboarding=${encodeURIComponent(runId)}`,
      });
      return {
        handled: true,
        detail: `Linked IT onboarding run ${runId}`,
        evidence_note: `IT child run ${runId}`,
      };
    }

    const off = await startOffboarding({
      user_id: userKey,
      entity_id: emp.entity_id,
      actor_id: input.actorId,
      notes: `Linked from HRIS offboarding ${emp.full_name}`,
      source: 'hr_ticket',
      auto_execute: false,
    });
    if (!off.ok) {
      return { handled: true, detail: off.error };
    }
    const runId = off.run.run_id;
    await addEmployeeLink({
      employee_id: emp.id,
      kind: 'it_offboarding',
      ref_id: runId,
      label: `IT offboarding · ${runId}`,
      href: `/shared-services/it/assets?offboarding=${encodeURIComponent(runId)}`,
    });
    return {
      handled: true,
      detail: `Linked IT offboarding run ${runId}`,
      evidence_note: `IT child run ${runId}`,
    };
  } catch (e) {
    return {
      handled: true,
      detail: e instanceof Error ? e.message : 'IT child link failed',
    };
  }
}

function isDocuSignStep(step: HrisProcessStep): boolean {
  return (
    step.system_hook === 'docusign_send' ||
    step.step_key === 'pre.offer_letter' ||
    /nda/i.test(step.step_key) ||
    /nda/i.test(step.title)
  );
}

function isGustoProvisionStep(step: HrisProcessStep): boolean {
  return (
    step.system_hook === 'gusto_provision' ||
    step.step_key === 'bs.gusto_provision' ||
    step.step_key === 'sd.gusto_provision'
  );
}

/** Fail-closed Gusto employee provision for the hire's entity_id. */
export async function runGustoProvisionAssist(
  emp: HrisEmployee,
): Promise<StepAssistResult> {
  const result = await runPartnerLifecycleHook('provision_gusto_employee', {
    entityId: emp.entity_id,
    email: emp.work_email || emp.personal_email || undefined,
  });
  const detail = result.ok
    ? result.message
    : result.error;
  const externalRef = result.ok ? result.externalRef : undefined;
  await writeAuditEvent({
    action: 'hris_action',
    title: `Gusto provision · ${emp.full_name}`,
    object_type: 'employee',
    object_id: emp.id,
    entity_id: emp.entity_id,
    metadata: {
      ok: result.ok,
      dry_run: result.ok ? result.dryRun : result.dryRun ?? false,
      status: result.status,
      detail,
      gusto_company_uuid: externalRef ?? null,
    },
  });
  if (externalRef) {
    await addEmployeeLink({
      employee_id: emp.id,
      kind: 'other',
      ref_id: externalRef,
      label: `Gusto company · ${externalRef}`,
      href: '/shared-services/it/technology-stack#gusto',
    }).catch(() => undefined);
  }
  return {
    handled: true,
    detail,
    evidence_note: detail,
    evidence_url: '/shared-services/it/technology-stack#gusto',
  };
}

/**
 * Dispatch assists when a step is marked done (or explicitly assisted).
 */
export async function dispatchHrisStepAssist(input: {
  step: HrisProcessStep;
  employeeId: string;
  actorId?: string | null;
  actorEmail?: string | null;
  confirmDocuSign?: boolean;
}): Promise<StepAssistResult> {
  const empRes = await getEmployee(input.employeeId);
  const emp = empRes.employee;
  if (!emp) return { handled: false, detail: 'Employee not found' };

  const key = input.step.step_key;
  const hook = input.step.system_hook;

  if (key === 'bs.ms_email' || hook === 'graph_provision') {
    return runGraphJoinerAssist(emp);
  }
  if (isEmailSignatureStep({ step_key: key, system_hook: hook })) {
    return runEmailSignatureAssist(emp);
  }
  if (key === 'bs.visionary_mailbox_access' || hook === 'mailbox_grant') {
    return runMailboxAssistForEmployee(emp);
  }
  if (
    hook === 'it_provision' &&
    (key === 'bs.notify_it' || key === 'bs.computer_setup')
  ) {
    return linkItChildRun({
      employee: emp,
      kind: 'it_onboarding',
      actorId: input.actorId,
    });
  }
  if (
    (hook === 'access_revoke' || hook === 'it_provision') &&
    /revoke|offboard|disable/i.test(key)
  ) {
    return linkItChildRun({
      employee: emp,
      kind: 'it_offboarding',
      actorId: input.actorId,
    });
  }
  if (isDocuSignStep(input.step)) {
    if (!input.confirmDocuSign) {
      return {
        handled: true,
        requires_confirm: true,
        detail:
          'DocuSign send requires explicit human confirmation — re-submit with confirm.',
      };
    }
    if (!input.actorId) {
      return { handled: true, detail: 'Actor required for DocuSign send' };
    }
    const sent = await sendHrisStepViaDocuSign({
      employee: emp,
      step: input.step,
      actorId: input.actorId,
      actorEmail: input.actorEmail ?? '',
      explicitHumanConfirm: true,
    });
    if (!sent.ok) {
      return { handled: true, detail: sent.error };
    }
    return {
      handled: true,
      detail: sent.detail,
      evidence_note: sent.detail,
      evidence_url: `/shared-services/legal/docusign`,
    };
  }
  if (isGustoProvisionStep(input.step)) {
    return runGustoProvisionAssist(emp);
  }
  if (
    hook === 'digital_card_activate' ||
    key === 'sd.digital_card_activate'
  ) {
    const res = await activateDigitalCardForEmployee(emp);
    return {
      handled: true,
      detail: res.detail,
      evidence_note: res.detail,
      evidence_url: res.public_id
        ? `/my-card?activated=${encodeURIComponent(res.public_id)}`
        : '/my-card',
    };
  }
  if (
    hook === 'digital_card_revoke' ||
    key === 'ex.digital_card_revoke'
  ) {
    const res = await revokeDigitalCardsForEmployee(emp);
    return {
      handled: true,
      detail: res.detail,
      evidence_note: res.detail,
    };
  }

  return { handled: false, detail: 'No assist for this step' };
}

export async function applyAssistEvidenceToStep(input: {
  stepId: string;
  assist: StepAssistResult;
  actorId?: string | null;
  status?: HrisProcessStep['status'];
}): Promise<void> {
  if (!input.assist.evidence_note && !input.assist.evidence_url) return;
  await updateStepStatus({
    step_id: input.stepId,
    status: input.status ?? 'done',
    evidence_note: input.assist.evidence_note,
    evidence_url: input.assist.evidence_url,
    actor_id: input.actorId,
  });
}
