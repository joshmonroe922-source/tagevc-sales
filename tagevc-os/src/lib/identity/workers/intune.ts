/**
 * intune-worker — company MDM + BYOD MAM (sheets 07 / 07b / 18).
 * G-BYOD-WIPE: reject factory wipe when ownership=personal_byod.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeIdentityAudit } from '@/lib/identity/audit';
import { assertWipeAllowed } from '@/lib/identity/wipe-guard';
import { assertNoHardwareForByod } from '@/lib/identity/device-path';
import type { DevicePath } from '@/lib/identity/types';

export type IntuneJobResult = {
  ok: boolean;
  blocked?: boolean;
  code?: string;
  detail: string;
  registration_id?: string | null;
};

async function resolveOwnership(employeeId: string): Promise<{
  ownership: string | null;
  enrollment_type: string | null;
}> {
  const sb = await createPersistClient();
  const { data } = await sb
    .from('os_hris_employees')
    .select('device_ownership')
    .eq('id', employeeId)
    .maybeSingle();
  return {
    ownership: (data?.device_ownership as string) ?? null,
    enrollment_type: null,
  };
}

/** Hard guard — called before any full wipe path. */
export async function guardFullWipe(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  action: string;
  device_ownership?: string | null;
  enrollment_type?: string | null;
}): Promise<IntuneJobResult | null> {
  const resolved = await resolveOwnership(payload.employee_id);
  const ownership = payload.device_ownership ?? resolved.ownership;
  const enrollment = payload.enrollment_type ?? resolved.enrollment_type;
  const guard = assertWipeAllowed({
    action: payload.action,
    device_ownership: ownership,
    enrollment_type: enrollment,
  });
  if (guard.allowed) return null;

  await writeIdentityAudit({
    action: 'byod_wipe_blocked',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'Full wipe blocked for personal_byod',
    after: {
      action: payload.action,
      ownership,
      enrollment,
      code: guard.code,
    },
    result: 'failure',
    source_system: 'intune',
    error_code: guard.code,
    actor_type: 'worker',
  });

  return {
    ok: false,
    blocked: true,
    code: guard.code,
    detail: guard.reason,
  };
}

export async function handleIntuneDeviceWipe(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  device_ownership?: string | null;
}): Promise<IntuneJobResult> {
  const blocked = await guardFullWipe({
    ...payload,
    action: 'intune.device.wipe',
  });
  if (blocked) return blocked;

  await writeIdentityAudit({
    action: 'device_wipe',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'Company device wipe queued (company_owned only)',
    after: { path: 'company_mdm' },
    source_system: 'intune',
    result: 'partial',
  });

  return {
    ok: true,
    detail:
      'Company wipe accepted — Intune retire/wipe dispatch via existing action worker',
  };
}

export async function handleByodEnsureMam(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  platforms?: string[];
  byod_enforcement_level?: string | null;
  device_path?: DevicePath;
}): Promise<IntuneJobResult> {
  if (
    payload.device_path &&
    assertNoHardwareForByod(payload.device_path) === false
  ) {
    return {
      ok: false,
      detail: 'ensure_mam called for non-BYOD path',
      code: 'path_mismatch',
    };
  }

  const sb = await createPersistClient();
  const platform =
    payload.platforms?.find((p) =>
      ['windows', 'macos', 'ios', 'android'].includes(p),
    ) ?? 'unknown';

  const { data, error } = await sb
    .from('byod_registrations')
    .insert({
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      platform,
      enrollment_type: 'mam_only',
      app_protection_status: 'pending',
      status: 'pending_first_sign_in',
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      meta: {
        byod_enforcement_level: payload.byod_enforcement_level ?? 'mam_only',
      },
    })
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, detail: error.message };
  }

  await writeIdentityAudit({
    action: 'byod_mam_target',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'BYOD MAM registration created (no hardware row)',
    after: {
      registration_id: data?.id,
      platform,
      hardware: false,
    },
    source_system: 'intune',
  });

  return {
    ok: true,
    registration_id: data?.id ?? null,
    detail: 'byod_registrations row created — APP targeting pending Graph',
  };
}

export async function handleByodSelectiveWipe(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
}): Promise<IntuneJobResult> {
  const sb = await createPersistClient();
  await sb
    .from('byod_registrations')
    .update({
      status: 'wipe_pending',
      app_protection_status: 'wiped',
    })
    .eq('employee_id', payload.employee_id)
    .eq('entity_id', payload.entity_id)
    .in('status', ['pending_first_sign_in', 'protected', 'mdm_enrolled']);

  await writeIdentityAudit({
    action: 'byod_selective_wipe',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'BYOD selective wipe / company data only',
    source_system: 'intune',
    result: 'partial',
  });

  return { ok: true, detail: 'Selective wipe marked wipe_pending' };
}

export async function handleByodRetire(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
}): Promise<IntuneJobResult> {
  const ownership = await resolveOwnership(payload.employee_id);
  if (ownership.ownership !== 'personal_byod') {
    return {
      ok: false,
      code: 'ownership_mismatch',
      detail: 'byod.retire requires personal_byod ownership',
    };
  }

  const sb = await createPersistClient();
  await sb
    .from('byod_registrations')
    .update({
      status: 'retired',
      app_protection_status: 'wiped',
    })
    .eq('employee_id', payload.employee_id)
    .eq('entity_id', payload.entity_id);

  await writeIdentityAudit({
    action: 'byod_retire',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'BYOD registration retired',
    source_system: 'intune',
  });

  await writeIdentityAudit({
    action: 'byod_offboard_complete',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'BYOD offboard complete — no physical return SLA',
    source_system: 'intune',
  });

  await sb
    .from('vm_lifecycle_cases')
    .update({ it_offboard_gate: 'passed', status: 'Complete' })
    .eq('id', payload.case_id);

  return { ok: true, detail: 'BYOD retired; IT gate passed' };
}

export async function handleDeviceAssignUser(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  hired?: { device_preference?: string | null };
}): Promise<IntuneJobResult> {
  const sb = await createPersistClient();
  const pref = payload.hired?.device_preference || 'none';
  const assetId = `HW-${payload.case_id.slice(-8)}`;

  const { error } = await sb.from('os_it_hardware_assets').insert({
    asset_id: assetId,
    kind: pref === 'macos' ? 'laptop_mac' : 'laptop_win',
    status: 'assigned',
    entity_id: payload.entity_id,
    model: pref === 'macos' ? 'MacBook (kit)' : 'Windows laptop (kit)',
    notes: `Reserved by joiner ${payload.case_id}`,
    device_ownership: 'company_owned',
    enrollment_type: pref === 'macos' ? 'ade' : 'autopilot',
    hris_employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
  });

  if (error && !error.message.includes('duplicate')) {
    // Fail-soft: stock may be managed elsewhere — park as needs_human-ish signal
    await writeIdentityAudit({
      action: 'device_reserve',
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      title: 'Device reserve attempted',
      after: { error: error.message },
      result: 'partial',
      source_system: 'intune',
    });
    return { ok: true, detail: `Reserve soft-fail: ${error.message}` };
  }

  await sb.from('os_it_asset_assignments').insert({
    entity_id: payload.entity_id,
    asset_id: assetId,
    hris_employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    reason: 'onboarding',
  });

  await writeIdentityAudit({
    action: 'device_reserve',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: `Company device reserved ${assetId}`,
    after: { asset_id: assetId, ownership: 'company_owned' },
    source_system: 'intune',
  });

  return { ok: true, detail: `Asset ${assetId} reserved` };
}
