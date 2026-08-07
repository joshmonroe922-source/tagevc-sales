/**
 * entra-worker — Graph user upsert/disable (sheet 05 / 18).
 * Dry-runs when MS_GRAPH_* not configured; still stamps UDL + audit.
 */

import {
  getMsGraphToken,
  graphConfigured,
} from '@/lib/shared-services/it-mdm';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeIdentityAudit } from '@/lib/identity/audit';
import type { HrisHiredBody } from '@/lib/identity/types';

export type EntraJobResult = {
  ok: boolean;
  skipped?: boolean;
  objectId?: string | null;
  upn?: string | null;
  detail: string;
};

function proposedUpn(hired: HrisHiredBody, emailDomain?: string | null): string {
  if (hired.work_email?.includes('@')) return hired.work_email.toLowerCase();
  const local = `${hired.legal_first_name}.${hired.legal_last_name}`
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  const domain = emailDomain || 'tagevc.com';
  return `${local}@${domain}`;
}

export async function handleEntraUserUpsert(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  hired: HrisHiredBody;
  device_path?: string;
}): Promise<EntraJobResult> {
  const sb = await createPersistClient();
  const { data: entity } = await sb
    .from('entities')
    .select('email_domain, entity_id, entra_au_id')
    .eq('entity_id', payload.entity_id)
    .maybeSingle();

  const upn = proposedUpn(payload.hired, entity?.email_domain);
  const ownership = payload.hired.device_ownership;

  if (!graphConfigured()) {
    await sb
      .from('os_hris_employees')
      .update({
        upn,
        identity_status: 'pending',
      })
      .eq('id', payload.employee_id);

    await writeIdentityAudit({
      action: 'entra_user_create',
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      title: `Entra upsert dry-run ${upn}`,
      after: {
        upn,
        device_ownership: ownership,
        mode: 'dry_run',
      },
      source_system: 'entra',
      result: 'partial',
    });

    // Ensure BYOD group membership marker for dual-path
    if (ownership === 'personal_byod') {
      await writeIdentityAudit({
        action: 'group_add',
        entity_id: payload.entity_id,
        employee_id: payload.employee_id,
        correlation_id: payload.correlation_id,
        case_id: payload.case_id,
        title: `BYOD group target grp-${payload.entity_id}-byod (dry-run)`,
        after: { extension_deviceOwnership: 'personal_byod' },
        source_system: 'entra',
        result: 'partial',
      });
    }

    return {
      ok: true,
      skipped: true,
      upn,
      objectId: null,
      detail: 'Graph not configured — dry-run upsert recorded',
    };
  }

  const token = await getMsGraphToken();
  if (!token.ok) {
    return { ok: false, detail: token.detail };
  }

  const body = {
    accountEnabled: false,
    displayName:
      payload.hired.preferred_name ||
      `${payload.hired.legal_first_name} ${payload.hired.legal_last_name}`,
    givenName: payload.hired.legal_first_name,
    surname: payload.hired.legal_last_name,
    mailNickname: upn.split('@')[0],
    userPrincipalName: upn,
    jobTitle: payload.hired.job_title,
    officeLocation: payload.hired.location ?? undefined,
    usageLocation: payload.hired.country || 'US',
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password: `Tmp-${cryptoRandom()}!`,
    },
  };

  const res = await fetch('https://graph.microsoft.com/v1.0/users', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    // Already exists — patch
    const patch = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobTitle: payload.hired.job_title,
          officeLocation: payload.hired.location ?? undefined,
        }),
      },
    );
    const getRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName`,
      { headers: { Authorization: `Bearer ${token.token}` } },
    );
    const existing = (await getRes.json().catch(() => ({}))) as {
      id?: string;
      userPrincipalName?: string;
    };
    await sb
      .from('os_hris_employees')
      .update({
        entra_object_id: existing.id ?? null,
        upn: existing.userPrincipalName ?? upn,
        identity_status: 'enabled',
      })
      .eq('id', payload.employee_id);
    await writeIdentityAudit({
      action: 'entra_user_update',
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      title: `Entra user updated ${upn}`,
      after: { objectId: existing.id, upn, patch_status: patch.status },
      source_system: 'entra',
    });
    return {
      ok: patch.ok || getRes.ok,
      objectId: existing.id ?? null,
      upn,
      detail: `Existing user patched (${patch.status})`,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      detail: `Graph create user HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  }

  const created = (await res.json()) as { id?: string; userPrincipalName?: string };
  await sb
    .from('os_hris_employees')
    .update({
      entra_object_id: created.id ?? null,
      upn: created.userPrincipalName ?? upn,
      identity_status: 'enabled',
    })
    .eq('id', payload.employee_id);

  await writeIdentityAudit({
    action: 'entra_user_create',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: `Entra user created ${upn}`,
    after: { objectId: created.id, upn, device_ownership: ownership },
    source_system: 'entra',
  });

  return {
    ok: true,
    objectId: created.id ?? null,
    upn: created.userPrincipalName ?? upn,
    detail: 'User created',
  };
}

export async function handleEntraUserDisable(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  revoke_sessions?: boolean;
}): Promise<EntraJobResult> {
  const sb = await createPersistClient();
  const { data: emp } = await sb
    .from('os_hris_employees')
    .select('entra_object_id, upn')
    .eq('id', payload.employee_id)
    .maybeSingle();

  if (!graphConfigured()) {
    await sb
      .from('os_hris_employees')
      .update({ identity_status: 'disabled' })
      .eq('id', payload.employee_id);
    await writeIdentityAudit({
      action: 'account_disable',
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      title: 'Entra disable dry-run',
      source_system: 'entra',
      result: 'partial',
    });
    return {
      ok: true,
      skipped: true,
      detail: 'Graph not configured — dry-run disable recorded',
    };
  }

  const token = await getMsGraphToken();
  if (!token.ok) return { ok: false, detail: token.detail };

  const key = emp?.entra_object_id || emp?.upn;
  if (!key) {
    return { ok: false, detail: 'No entra_object_id/upn on employee' };
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(key)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountEnabled: false }),
    },
  );

  if (payload.revoke_sessions && res.ok) {
    await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(key)}/revokeSignInSessions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.token}` },
      },
    );
    await writeIdentityAudit({
      action: 'session_revoke',
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      title: 'Sessions revoked',
      source_system: 'entra',
    });
  }

  await sb
    .from('os_hris_employees')
    .update({ identity_status: 'disabled' })
    .eq('id', payload.employee_id);

  await writeIdentityAudit({
    action: 'account_disable',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: `Entra disable ${key}`,
    after: { http: res.status },
    source_system: 'entra',
    result: res.ok ? 'success' : 'failure',
  });

  return {
    ok: res.ok,
    objectId: emp?.entra_object_id ?? null,
    upn: emp?.upn ?? null,
    detail: res.ok ? 'Disabled' : `HTTP ${res.status}`,
  };
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 12);
}
