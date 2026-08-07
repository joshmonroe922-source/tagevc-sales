/**
 * intune-worker BYOD + company device commands (sheets 07 / 07b / 18).
 * G-BYOD-WIPE: reject factory wipe when ownership=personal_byod.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeIdentityAudit } from '@/lib/identity/audit';
import { assertWipeAllowed } from '@/lib/identity/wipe-guard';
import {
  getMsGraphToken,
  graphConfigured,
} from '@/lib/shared-services/it-mdm';

export type IntuneIdentityResult = {
  ok: boolean;
  blocked?: boolean;
  code?: string;
  registration_id?: string | null;
  detail: string;
};

export async function handleByodEnsureMam(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  platforms?: string[];
  byod_enforcement_level?: string | null;
}): Promise<IntuneIdentityResult> {
  const sb = await createPersistClient();
  const enrollment =
    payload.byod_enforcement_level === 'mam_plus_optional_mdm' ||
    payload.byod_enforcement_level === 'mdm_required_exception'
      ? 'company_portal_personal'
      : 'mam_only';

  const platform = payload.platforms?.[0] ?? null;
  const { data, error } = await sb
    .from('byod_registrations')
    .insert({
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      platform,
      enrollment_type: enrollment,
      status: 'pending_first_sign_in',
      app_protection_status: 'pending',
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      meta: { mam_targeted: true },
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // Idempotent: if row exists for same corr, treat ok
    const { data: existing } = await sb
      .from('byod_registrations')
      .select('id')
      .eq('employee_id', payload.employee_id)
      .eq('correlation_id', payload.correlation_id)
      .maybeSingle();
    if (!existing) {
      return { ok: false, detail: error.message };
    }
    return {
      ok: true,
      registration_id: existing.id,
      detail: 'BYOD registration already present',
    };
  }

  await writeIdentityAudit({
    action: 'byod_mam_target',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'BYOD MAM targeted — no hardware asset created',
    after: {
      registration_id: data?.id,
      enrollment_type: enrollment,
      platform,
    },
    source_system: 'intune',
  });

  return {
    ok: true,
    registration_id: data?.id ?? null,
    detail: 'byod_registrations row created (APP target)',
  };
}

export async function handleByodSelectiveWipe(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
}): Promise<IntuneIdentityResult> {
  const sb = await createPersistClient();
  await sb
    .from('byod_registrations')
    .update({ status: 'wipe_pending' })
    .eq('employee_id', payload.employee_id)
    .eq('entity_id', payload.entity_id)
    .in('status', ['pending_first_sign_in', 'protected', 'mdm_enrolled']);

  // Graph selective wipe when configured — never factory wipe
  if (graphConfigured()) {
    const token = await getMsGraphToken();
    if (token.ok) {
      // MAM selective wipe is user-scoped via managedAppRegistrations / wipe
      // Best-effort: mark wiped_company_data after enqueue intent
      await fetch(
        'https://graph.microsoft.com/beta/users/' +
          encodeURIComponent(payload.employee_id) +
          '/wipeManagedAppRegistrationsByDeviceTag',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ deviceTag: 'TageWork' }),
        },
      ).catch(() => null);
    }
  }

  await sb
    .from('byod_registrations')
    .update({
      status: 'wiped_company_data',
      app_protection_status: 'wiped',
      last_sync_at: new Date().toISOString(),
    })
    .eq('employee_id', payload.employee_id)
    .eq('entity_id', payload.entity_id);

  await writeIdentityAudit({
    action: 'byod_selective_wipe',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'BYOD selective wipe (company data only)',
    source_system: 'intune',
  });

  return { ok: true, detail: 'Selective wipe recorded' };
}

export async function handleByodRetire(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  intune_device_id?: string | null;
}): Promise<IntuneIdentityResult> {
  const sb = await createPersistClient();
  const { data: emp } = await sb
    .from('os_hris_employees')
    .select('device_ownership')
    .eq('id', payload.employee_id)
    .maybeSingle();

  if (emp?.device_ownership !== 'personal_byod') {
    return {
      ok: false,
      detail: 'byod.retire requires device_ownership=personal_byod',
      code: 'ownership_mismatch',
    };
  }

  const { data: regs } = await sb
    .from('byod_registrations')
    .select('id, intune_device_id, enrollment_type')
    .eq('employee_id', payload.employee_id)
    .eq('entity_id', payload.entity_id);

  for (const reg of regs ?? []) {
    if (reg.intune_device_id && graphConfigured()) {
      const token = await getMsGraphToken();
      if (token.ok) {
        await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(reg.intune_device_id)}/retire`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token.token}` },
          },
        ).catch(() => null);
      }
    }
  }

  await sb
    .from('byod_registrations')
    .update({ status: 'retired', last_sync_at: new Date().toISOString() })
    .eq('employee_id', payload.employee_id)
    .eq('entity_id', payload.entity_id);

  await writeIdentityAudit({
    action: 'byod_retire',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'BYOD Retire (not Wipe)',
    source_system: 'intune',
  });

  await writeIdentityAudit({
    action: 'byod_offboard_complete',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'BYOD offboard complete',
    source_system: 'intune',
  });

  // IT gate can pass without physical return for pure MAM
  await sb
    .from('vm_lifecycle_cases')
    .update({ it_offboard_gate: 'passed', status: 'Complete' })
    .eq('id', payload.case_id);

  return { ok: true, detail: 'BYOD retired; IT gate passed' };
}

/**
 * Company wipe OR blocked BYOD full wipe.
 * Always runs wipe guard first.
 */
export async function handleDeviceWipe(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  device_ownership?: string | null;
  enrollment_type?: string | null;
  intune_device_id?: string | null;
}): Promise<IntuneIdentityResult> {
  const sb = await createPersistClient();
  let ownership = payload.device_ownership;
  if (!ownership) {
    const { data: emp } = await sb
      .from('os_hris_employees')
      .select('device_ownership')
      .eq('id', payload.employee_id)
      .maybeSingle();
    ownership = emp?.device_ownership ?? null;
  }

  const guard = assertWipeAllowed({
    action: 'intune.device.wipe',
    device_ownership: ownership,
    enrollment_type: payload.enrollment_type,
  });

  if (!guard.allowed) {
    await writeIdentityAudit({
      action: 'byod_wipe_blocked',
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      title: 'Full wipe blocked for BYOD',
      after: { code: guard.code, reason: guard.reason, ownership },
      result: 'failure',
      source_system: 'intune',
      error_code: guard.code,
    });
    return {
      ok: false,
      blocked: true,
      code: guard.code,
      detail: guard.reason,
    };
  }

  // Company-owned path — wipe allowed
  if (payload.intune_device_id && graphConfigured()) {
    const token = await getMsGraphToken();
    if (token.ok) {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodeURIComponent(payload.intune_device_id)}/wipe`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ keepEnrollmentData: false }),
        },
      );
      await writeIdentityAudit({
        action: 'device_wipe',
        entity_id: payload.entity_id,
        employee_id: payload.employee_id,
        correlation_id: payload.correlation_id,
        case_id: payload.case_id,
        title: `Company device wipe HTTP ${res.status}`,
        source_system: 'intune',
        result: res.ok ? 'success' : 'failure',
      });
      return {
        ok: res.ok,
        detail: res.ok ? 'Wipe accepted' : `Wipe HTTP ${res.status}`,
      };
    }
  }

  await writeIdentityAudit({
    action: 'device_wipe',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: 'Company device wipe queued (dry-run / no device id)',
    source_system: 'intune',
    result: 'partial',
  });

  await sb
    .from('vm_lifecycle_cases')
    .update({ it_offboard_gate: 'pending' })
    .eq('id', payload.case_id);

  return { ok: true, detail: 'Company wipe recorded (await recovery SLA)' };
}

export async function handleDeviceAssignUser(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  hired?: { device_preference?: string | null };
}): Promise<IntuneIdentityResult> {
  const sb = await createPersistClient();

  // Refuse to create hardware for BYOD (defense in depth)
  const { data: emp } = await sb
    .from('os_hris_employees')
    .select('device_ownership')
    .eq('id', payload.employee_id)
    .maybeSingle();
  if (emp?.device_ownership === 'personal_byod') {
    return {
      ok: false,
      blocked: true,
      code: 'byod_asset_blocked',
      detail: 'Pure MAM must use byod_registrations, not it_assets',
    };
  }

  const { data: stock } = await sb
    .from('os_it_hardware_assets')
    .select('asset_id, id')
    .eq('entity_id', payload.entity_id)
    .eq('status', 'in_stock')
    .eq('device_ownership', 'company_owned')
    .limit(1)
    .maybeSingle();

  if (!stock) {
    await writeIdentityAudit({
      action: 'device_reserve',
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      title: 'No in-stock company device — needs_human',
      result: 'partial',
      source_system: 'intune',
      error_code: 'no_stock',
    });
    await sb
      .from('vm_lifecycle_cases')
      .update({ status: 'needs_human', last_error: 'no_stock_device' })
      .eq('id', payload.case_id);
    return {
      ok: true,
      detail: 'No stock — case marked needs_human',
      code: 'no_stock',
    };
  }

  await sb
    .from('os_it_hardware_assets')
    .update({
      status: 'assigned',
      hris_employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      enrollment_type:
        payload.hired?.device_preference === 'macos' ? 'ade' : 'autopilot',
    })
    .eq('asset_id', stock.asset_id);

  await sb.from('os_it_asset_assignments').insert({
    entity_id: payload.entity_id,
    asset_id: stock.asset_id,
    hris_employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    reason: 'joiner_reserve',
  });

  await writeIdentityAudit({
    action: 'device_reserve',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: `Reserved ${stock.asset_id}`,
    after: { asset_id: stock.asset_id },
    source_system: 'intune',
  });

  return {
    ok: true,
    detail: `Reserved asset ${stock.asset_id}`,
  };
}
