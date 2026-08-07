/**
 * Lifecycle orchestrator — extends VM lifecycle_cases (sheet 03 / 10 / 11 / 07b).
 * Branches company_mdm vs byod_mam from HRIS device_ownership.
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { resolveDevicePath } from '@/lib/identity/device-path';
import {
  IDENTITY_CONTRACT_VERSION,
  caseTypeToVmEvent,
  type CaseType,
  type HrisHiredBody,
  type HrisTerminatedBody,
  type WorkerCommand,
} from '@/lib/identity/types';
import { writeIdentityAudit } from '@/lib/identity/audit';

export type OrchestratorResult = {
  ok: boolean;
  case_id?: string;
  correlation_id?: string;
  device_path?: string;
  needs_human?: boolean;
  preview?: boolean;
  error?: string;
  steps?: string[];
  jobs_queued?: number;
};

async function enqueueJob(input: {
  command: WorkerCommand;
  entity_id: string;
  employee_id?: string | null;
  case_id: string;
  correlation_id: string;
  payload: Record<string, unknown>;
  priority?: number;
}): Promise<boolean> {
  const sb = await createPersistClient();
  const key = `${input.command}:${input.employee_id ?? 'na'}:${input.case_id}`;
  const { error } = await sb.from('identity_worker_jobs').insert({
    command: input.command,
    entity_id: input.entity_id,
    employee_id: input.employee_id ?? null,
    case_id: input.case_id,
    correlation_id: input.correlation_id,
    idempotency_key: key,
    payload: input.payload,
    priority: input.priority ?? 100,
    status: 'queued',
  });
  if (error && (error.code === '23505' || error.message.includes('unique'))) {
    return true;
  }
  return !error;
}

async function insertSteps(
  caseId: string,
  entityId: string,
  steps: Array<{ step_key: string; worker?: string; status?: string }>,
) {
  const sb = await createPersistClient();
  await sb.from('vm_lifecycle_case_steps').insert(
    steps.map((s) => ({
      case_id: caseId,
      entity_id: entityId,
      step_key: s.step_key,
      worker: s.worker ?? null,
      status: s.status ?? 'pending',
    })),
  );
}

export async function openJoinerCase(input: {
  hired: HrisHiredBody;
  correlation_id: string;
  hris_event_id?: string;
  byod_allowed?: boolean;
  role_byod_allowed?: boolean;
  entity_byod_allowed?: boolean;
}): Promise<OrchestratorResult> {
  const path = resolveDevicePath({
    device_ownership: input.hired.device_ownership,
    device_preference: input.hired.device_preference,
    byod_allowed: input.byod_allowed,
    role_byod_allowed: input.role_byod_allowed,
    entity_byod_allowed: input.entity_byod_allowed,
  });

  const caseId = `LC-J-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const caseType: CaseType = 'joiner';
  const sb = await createPersistClient();

  // Upsert HRIS employee projection from event (HRIS remains SoT; we don't invent hire)
  const fullName =
    input.hired.preferred_name ||
    `${input.hired.legal_first_name} ${input.hired.legal_last_name}`;
  await sb.from('os_hris_employees').upsert(
    {
      id: input.hired.employee_id,
      employee_key: `HRIS-${input.hired.employee_id.replace(/-/g, '').slice(0, 16)}`,
      full_name: fullName,
      entity_id: input.hired.entity_id,
      work_email: input.hired.work_email ?? '',
      personal_email: input.hired.personal_email,
      status: 'pre_start',
      start_date: input.hired.start_date,
      role_title: input.hired.job_title,
      location: input.hired.location ?? '',
      device_ownership: input.hired.device_ownership,
      device_preference: input.hired.device_preference ?? null,
      byod_enforcement_level: path.byod_enforcement_level,
      identity_status: path.needs_human ? 'not_provisioned' : 'pending',
      primary_role_id: input.hired.primary_role_id,
      job_title: input.hired.job_title,
      employment_type: input.hired.employment_type,
      legal_first_name: input.hired.legal_first_name,
      legal_last_name: input.hired.legal_last_name,
      preferred_name: input.hired.preferred_name ?? null,
      country: input.hired.country ?? 'US',
    },
    { onConflict: 'id' },
  );

  // VM employee projection required for vm_lifecycle_cases.emp_id FK
  const vmEmpId = `VM-${input.hired.employee_id.replace(/-/g, '').slice(0, 12)}`;
  const { data: roleRow } = await sb
    .from('vm_roles')
    .select('id')
    .eq('id', input.hired.primary_role_id)
    .maybeSingle();
  await sb.from('vm_employees').upsert(
    {
      id: vmEmpId,
      name: fullName,
      entity_id: input.hired.entity_id,
      role_id: roleRow?.id ?? null,
      status: 'Active',
      start_date: input.hired.start_date,
    },
    { onConflict: 'id' },
  );
  await sb
    .from('os_hris_employees')
    .update({ vm_employee_id: vmEmpId })
    .eq('id', input.hired.employee_id);

  const status = path.needs_human ? 'needs_human' : 'In Progress';
  const { error } = await sb.from('vm_lifecycle_cases').insert({
    id: caseId,
    emp_id: vmEmpId,
    event: caseTypeToVmEvent(caseType),
    case_type: caseType,
    role_id: roleRow?.id ?? null,
    entity_id: input.hired.entity_id,
    start_date: input.hired.start_date,
    status,
    correlation_id: input.correlation_id,
    kit_snapshot: path.kit_snapshot,
    device_path: path.device_path,
    hris_employee_id: input.hired.employee_id,
    hris_event_id: input.hris_event_id ?? null,
    effective_at: input.hired.start_date,
    steps: [],
    last_error: path.reason ?? null,
    notes: `Identity joiner ${IDENTITY_CONTRACT_VERSION}`,
  });

  if (error) {
    return { ok: false, error: error.message, correlation_id: input.correlation_id };
  }

  await writeIdentityAudit({
    action: 'case_created',
    entity_id: input.hired.entity_id,
    employee_id: input.hired.employee_id,
    correlation_id: input.correlation_id,
    case_id: caseId,
    title: `Joiner case opened (${path.device_path})`,
    after: { device_path: path.device_path, ownership: path.ownership },
  });

  await writeIdentityAudit({
    action: 'device_path_resolved',
    entity_id: input.hired.entity_id,
    employee_id: input.hired.employee_id,
    correlation_id: input.correlation_id,
    case_id: caseId,
    title: `Device path ${path.device_path}`,
    after: path.kit_snapshot,
    result: path.ok ? 'success' : 'failure',
  });

  if (path.needs_human) {
    return {
      ok: true,
      case_id: caseId,
      correlation_id: input.correlation_id,
      device_path: path.device_path,
      needs_human: true,
      error: path.reason,
    };
  }

  const stepDefs = [
    { step_key: 'kit_resolve', worker: 'orchestrator', status: 'succeeded' },
    { step_key: 'entra_upsert', worker: 'entra' },
    { step_key: 'entitlements', worker: 'entitlement' },
    path.skip_hardware
      ? { step_key: 'byod_mam', worker: 'intune' }
      : { step_key: 'device_reserve', worker: 'intune' },
    { step_key: 'notify_welcome', worker: 'notify' },
  ];
  await insertSteps(caseId, input.hired.entity_id, stepDefs);

  let jobs = 0;
  const basePayload = {
    employee_id: input.hired.employee_id,
    entity_id: input.hired.entity_id,
    case_id: caseId,
    correlation_id: input.correlation_id,
    hired: input.hired,
    device_path: path.device_path,
    kit_snapshot: path.kit_snapshot,
  };

  if (await enqueueJob({
    command: 'entra.user.upsert',
    entity_id: input.hired.entity_id,
    employee_id: input.hired.employee_id,
    case_id: caseId,
    correlation_id: input.correlation_id,
    payload: basePayload,
    priority: 10,
  })) jobs += 1;

  if (await enqueueJob({
    command: 'entitlement.materialize',
    entity_id: input.hired.entity_id,
    employee_id: input.hired.employee_id,
    case_id: caseId,
    correlation_id: input.correlation_id,
    payload: {
      ...basePayload,
      primary_role_id: input.hired.primary_role_id,
      secondary_role_ids: input.hired.secondary_role_ids ?? [],
    },
    priority: 20,
  })) jobs += 1;

  if (path.skip_hardware) {
    if (await enqueueJob({
      command: 'intune.byod.ensure_mam',
      entity_id: input.hired.entity_id,
      employee_id: input.hired.employee_id,
      case_id: caseId,
      correlation_id: input.correlation_id,
      payload: {
        ...basePayload,
        platforms: input.hired.device_preference
          ? [input.hired.device_preference]
          : [],
        byod_enforcement_level: path.byod_enforcement_level,
      },
      priority: 30,
    })) jobs += 1;
  } else {
    if (await enqueueJob({
      command: 'intune.device.assign_user',
      entity_id: input.hired.entity_id,
      employee_id: input.hired.employee_id,
      case_id: caseId,
      correlation_id: input.correlation_id,
      payload: basePayload,
      priority: 30,
    })) jobs += 1;
  }

  if (await enqueueJob({
    command: 'notify.send',
    entity_id: input.hired.entity_id,
    employee_id: input.hired.employee_id,
    case_id: caseId,
    correlation_id: input.correlation_id,
    payload: {
      ...basePayload,
      template:
        path.ownership === 'personal_byod'
          ? 'identity.byod_welcome'
          : 'identity.company_welcome',
      to: input.hired.personal_email,
    },
    priority: 40,
  })) jobs += 1;

  return {
    ok: true,
    case_id: caseId,
    correlation_id: input.correlation_id,
    device_path: path.device_path,
    steps: stepDefs.map((s) => s.step_key),
    jobs_queued: jobs,
  };
}

export async function openLeaverCase(input: {
  terminated: HrisTerminatedBody;
  correlation_id: string;
  hris_event_id?: string;
}): Promise<OrchestratorResult> {
  const sb = await createPersistClient();
  let ownership = input.terminated.device_ownership;
  if (!ownership || ownership === 'unset') {
    const { data } = await sb
      .from('os_hris_employees')
      .select('device_ownership')
      .eq('id', input.terminated.employee_id)
      .maybeSingle();
    ownership = (data?.device_ownership as typeof ownership) || 'company_owned';
  }

  const path = resolveDevicePath({
    device_ownership: ownership,
  });

  const caseId = `LC-L-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const caseType: CaseType = 'leaver';

  const { data: hrisRow } = await sb
    .from('os_hris_employees')
    .select('vm_employee_id, full_name')
    .eq('id', input.terminated.employee_id)
    .maybeSingle();
  let vmEmpId = (hrisRow?.vm_employee_id as string | null) || null;
  if (!vmEmpId) {
    vmEmpId = `VM-${input.terminated.employee_id.replace(/-/g, '').slice(0, 12)}`;
    await sb.from('vm_employees').upsert(
      {
        id: vmEmpId,
        name: hrisRow?.full_name || vmEmpId,
        entity_id: input.terminated.entity_id,
        status: 'Active',
      },
      { onConflict: 'id' },
    );
  }

  const { error } = await sb.from('vm_lifecycle_cases').insert({
    id: caseId,
    emp_id: vmEmpId,
    event: caseTypeToVmEvent(caseType),
    case_type: caseType,
    entity_id: input.terminated.entity_id,
    start_date: input.terminated.effective_at.slice(0, 10),
    status: 'In Progress',
    correlation_id: input.correlation_id,
    kit_snapshot: path.kit_snapshot,
    device_path: path.device_path,
    it_offboard_gate: 'pending',
    hris_employee_id: input.terminated.employee_id,
    hris_event_id: input.hris_event_id ?? null,
    effective_at: input.terminated.effective_at,
    notes: `Identity leaver ${IDENTITY_CONTRACT_VERSION}`,
  });

  if (error) {
    return { ok: false, error: error.message, correlation_id: input.correlation_id };
  }

  await writeIdentityAudit({
    action: 'case_created',
    entity_id: input.terminated.entity_id,
    employee_id: input.terminated.employee_id,
    correlation_id: input.correlation_id,
    case_id: caseId,
    title: `Leaver case opened (${path.device_path})`,
    after: { device_path: path.device_path, ownership },
  });

  const stepDefs = [
    { step_key: 'entra_disable', worker: 'entra' },
    { step_key: 'entitlements_revoke', worker: 'entitlement' },
    path.ownership === 'personal_byod'
      ? { step_key: 'byod_selective_wipe', worker: 'intune' }
      : { step_key: 'device_wipe_recover', worker: 'intune' },
    { step_key: 'it_offboard_gate', worker: 'orchestrator' },
  ];
  await insertSteps(caseId, input.terminated.entity_id, stepDefs);

  let jobs = 0;
  const basePayload = {
    employee_id: input.terminated.employee_id,
    entity_id: input.terminated.entity_id,
    case_id: caseId,
    correlation_id: input.correlation_id,
    terminated: input.terminated,
    device_path: path.device_path,
    device_ownership: ownership,
  };

  if (await enqueueJob({
    command: 'entra.user.disable',
    entity_id: input.terminated.entity_id,
    employee_id: input.terminated.employee_id,
    case_id: caseId,
    correlation_id: input.correlation_id,
    payload: { ...basePayload, revoke_sessions: true },
    priority: 1,
  })) jobs += 1;

  if (await enqueueJob({
    command: 'entitlement.revoke_all',
    entity_id: input.terminated.entity_id,
    employee_id: input.terminated.employee_id,
    case_id: caseId,
    correlation_id: input.correlation_id,
    payload: basePayload,
    priority: 5,
  })) jobs += 1;

  if (path.ownership === 'personal_byod') {
    await writeIdentityAudit({
      action: 'byod_offboard_start',
      entity_id: input.terminated.entity_id,
      employee_id: input.terminated.employee_id,
      correlation_id: input.correlation_id,
      case_id: caseId,
      title: 'BYOD offboard — selective wipe only',
    });
    if (await enqueueJob({
      command: 'intune.byod.selective_wipe',
      entity_id: input.terminated.entity_id,
      employee_id: input.terminated.employee_id,
      case_id: caseId,
      correlation_id: input.correlation_id,
      payload: basePayload,
      priority: 10,
    })) jobs += 1;
    if (await enqueueJob({
      command: 'intune.byod.retire',
      entity_id: input.terminated.entity_id,
      employee_id: input.terminated.employee_id,
      case_id: caseId,
      correlation_id: input.correlation_id,
      payload: basePayload,
      priority: 15,
    })) jobs += 1;
  } else {
    if (await enqueueJob({
      command: 'intune.device.wipe',
      entity_id: input.terminated.entity_id,
      employee_id: input.terminated.employee_id,
      case_id: caseId,
      correlation_id: input.correlation_id,
      payload: basePayload,
      priority: 10,
    })) jobs += 1;
  }

  return {
    ok: true,
    case_id: caseId,
    correlation_id: input.correlation_id,
    device_path: path.device_path,
    steps: stepDefs.map((s) => s.step_key),
    jobs_queued: jobs,
  };
}

/** Drain pending HRIS outbox into lifecycle cases. */
export async function processHrisOutbox(limit = 10): Promise<{
  processed: number;
  results: OrchestratorResult[];
}> {
  const sb = await createPersistClient();
  const { data: rows } = await sb
    .from('identity_hris_outbox')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('available_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);

  const results: OrchestratorResult[] = [];
  let processed = 0;

  for (const row of rows ?? []) {
    await sb
      .from('identity_hris_outbox')
      .update({
        status: 'processing',
        attempts: (row.attempts ?? 0) + 1,
      })
      .eq('id', row.id);

    try {
      let result: OrchestratorResult;
      if (row.event_type === 'hris.employee.hired') {
        result = await openJoinerCase({
          hired: row.payload as HrisHiredBody,
          correlation_id: row.correlation_id,
          hris_event_id: row.event_id,
        });
      } else if (row.event_type === 'hris.employee.terminated') {
        result = await openLeaverCase({
          terminated: row.payload as HrisTerminatedBody,
          correlation_id: row.correlation_id,
          hris_event_id: row.event_id,
        });
      } else {
        result = {
          ok: true,
          correlation_id: row.correlation_id,
          preview: true,
          error: `Event ${row.event_type} acknowledged (handler stub)`,
        };
      }

      results.push(result);
      await sb
        .from('identity_hris_outbox')
        .update({
          status: result.ok ? 'completed' : 'failed',
          last_error: result.error ?? null,
          processed_at: new Date().toISOString(),
          available_at: result.ok
            ? new Date().toISOString()
            : new Date(Date.now() + 60_000).toISOString(),
        })
        .eq('id', row.id);
      processed += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'process failed';
      await sb
        .from('identity_hris_outbox')
        .update({
          status: 'failed',
          last_error: msg,
          available_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .eq('id', row.id);
      results.push({ ok: false, error: msg });
    }
  }

  return { processed, results };
}
