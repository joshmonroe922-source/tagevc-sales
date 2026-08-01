/**
 * Adapter seams — fail-closed stubs. No fake API credentials.
 */

import { partnerConnectionStatus } from '@/lib/partners/env';
import type { PartnerKey } from '@/lib/partners/catalog';

export type AdapterExecutionStatus = 'dry_run' | 'live_ok' | 'failed';

export type AdapterResult =
  | {
      ok: true;
      dryRun: boolean;
      status: AdapterExecutionStatus;
      message: string;
      externalRef?: string;
    }
  | {
      ok: false;
      error: string;
      dryRun?: boolean;
      status: AdapterExecutionStatus;
    };

/** Live remote work completed — dry-run / scaffold must never count as done. */
export function isAdapterLiveComplete(result: AdapterResult): boolean {
  return result.ok && result.status === 'live_ok' && !result.dryRun;
}

function liveFlag(envKey: string): boolean {
  return process.env[envKey]?.trim() === '1';
}

export async function dialpadProvisionUser(_input: {
  entityId: string;
  email: string;
}): Promise<AdapterResult> {
  if (!liveFlag('DIALPAD_LIVE') || !process.env.DIALPAD_API_KEY?.trim()) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message: 'Dialpad provision stub (set DIALPAD_LIVE=1 + DIALPAD_API_KEY).',
    };
  }
  return {
    ok: false,
    status: 'failed',
    error: 'Dialpad live adapter not implemented — scaffold only.',
  };
}

export async function gustoQueueCommission(_input: {
  entityId: string;
  userExternalId: string;
  amountCents: number;
  invoiceId: string;
}): Promise<AdapterResult> {
  if (!liveFlag('GUSTO_LIVE') || !process.env.GUSTO_API_TOKEN?.trim()) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message:
        'Gusto commission queued locally (stub). Wire invoice-paid → commission → payroll when LIVE.',
    };
  }
  return {
    ok: false,
    status: 'failed',
    error: 'Gusto live commission push not implemented — scaffold only.',
  };
}

export async function gustoProvisionEmployee(_input: {
  entityId: string;
  email?: string;
}): Promise<AdapterResult> {
  if (!liveFlag('GUSTO_LIVE') || !process.env.GUSTO_API_TOKEN?.trim()) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message:
        'Gusto employee provision stub — enable GUSTO_LIVE when payroll API ready.',
    };
  }
  return {
    ok: false,
    status: 'failed',
    error: 'Gusto live employee provision not implemented — scaffold only.',
  };
}

export async function mybasepayCreatePlacementWorker(_input: {
  entityId: string;
  placementId: string;
  workerEmail: string;
}): Promise<AdapterResult> {
  if (partnerConnectionStatus('mybasepay') === 'scaffold') {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message:
        'MyBasePay EOR stub for Recruit 619. Set MYBASEPAY_* when account ready.',
    };
  }
  if (!liveFlag('MYBASEPAY_LIVE')) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message: 'MyBasePay configured but MYBASEPAY_LIVE≠1 — dry-run.',
    };
  }
  return {
    ok: false,
    status: 'failed',
    error: 'MyBasePay live adapter not implemented — scaffold only.',
  };
}

export async function apolloImportCompany(_input: {
  entityId: string;
  domain: string;
}): Promise<AdapterResult> {
  if (!process.env.APOLLO_API_KEY?.trim()) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message: 'Apollo import stub — set APOLLO_API_KEY.',
    };
  }
  if (!liveFlag('APOLLO_LIVE')) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message: 'Apollo key present; APOLLO_LIVE≠1 — dry-run.',
    };
  }
  return {
    ok: false,
    status: 'failed',
    error: 'Apollo live import not implemented — scaffold only.',
  };
}

export async function linkedinRecruiterSyncStub(_input: {
  entityId: string;
}): Promise<AdapterResult> {
  return {
    ok: true,
    dryRun: true,
    status: 'dry_run',
    message:
      'LinkedIn Recruiter two-way sync scaffold — attach account when issued.',
  };
}

export async function appcastPublishStub(_input: {
  entityId: string;
  jobId: string;
}): Promise<AdapterResult> {
  const status = partnerConnectionStatus('appcast');
  if (status === 'scaffold') {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message:
        'Appcast publish lives primarily on Recruit 619 portal feed; spine tracks enablement.',
    };
  }
  return {
    ok: true,
    dryRun: !liveFlag('APPCAST_LIVE'),
    status: liveFlag('APPCAST_LIVE') ? 'live_ok' : 'dry_run',
    message: liveFlag('APPCAST_LIVE')
      ? 'Appcast LIVE — use R619 /api/integrations/appcast paths.'
      : 'Appcast dry-run — APPCAST_LIVE≠1.',
  };
}

export async function marketingPresenceImportStub(
  kind: Extract<
    PartnerKey,
    'google_business' | 'google_analytics' | 'linkedin_company'
  >,
  _input: { entityId: string },
): Promise<AdapterResult> {
  return {
    ok: true,
    dryRun: true,
    status: 'dry_run',
    message: `${kind} import stub — connect OAuth under Marketing → Presence, then enable LIVE.`,
  };
}

export async function dialpadRevokeUser(_input: {
  entityId: string;
  email?: string;
}): Promise<AdapterResult> {
  if (!liveFlag('DIALPAD_LIVE') || !process.env.DIALPAD_API_KEY?.trim()) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message: 'Dialpad revoke stub (set DIALPAD_LIVE=1 + DIALPAD_API_KEY).',
    };
  }
  return {
    ok: false,
    status: 'failed',
    error: 'Dialpad live revoke not implemented — scaffold only.',
  };
}

export async function gustoTerminateEmployee(_input: {
  entityId: string;
  userExternalId?: string;
}): Promise<AdapterResult> {
  if (!liveFlag('GUSTO_LIVE') || !process.env.GUSTO_API_TOKEN?.trim()) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message: 'Gusto terminate stub — enable GUSTO_LIVE when payroll API ready.',
    };
  }
  return {
    ok: false,
    status: 'failed',
    error: 'Gusto live terminate not implemented — scaffold only.',
  };
}

export async function apolloRevokeUser(_input: {
  entityId: string;
  email?: string;
}): Promise<AdapterResult> {
  if (!process.env.APOLLO_API_KEY?.trim() || !liveFlag('APOLLO_LIVE')) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message: 'Apollo seat revoke stub — set APOLLO_API_KEY + APOLLO_LIVE=1.',
    };
  }
  return {
    ok: false,
    status: 'failed',
    error: 'Apollo live revoke not implemented — scaffold only.',
  };
}

export async function marketingPresenceRevokeEditor(_input: {
  entityId: string;
}): Promise<AdapterResult> {
  return {
    ok: true,
    dryRun: true,
    status: 'dry_run',
    message:
      'Marketing presence editor revoke stub — clear OAuth editors under Presence when LIVE.',
  };
}

export async function verifiedFirstPendingStub(_input: {
  entityId: string;
  email?: string;
}): Promise<AdapterResult> {
  if (!liveFlag('VERIFIED_FIRST_LIVE')) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message:
        'Verified First screening stub — set VERIFIED_FIRST_LIVE=1 when ready.',
    };
  }
  return {
    ok: false,
    status: 'failed',
    error: 'Verified First live screening trigger not implemented — scaffold only.',
  };
}

export async function entityCreateAckStub(
  hookId: string,
): Promise<AdapterResult> {
  return {
    ok: true,
    dryRun: true,
    status: 'dry_run',
    message: `${hookId} acknowledged — spine/SQL / admin UI (no remote call).`,
  };
}

/** Map JML / provision hook ids → adapter stubs (fail-closed dry-run until LIVE). */
export async function runPartnerLifecycleHook(
  hookId: string,
  input: {
    entityId: string;
    email?: string;
    userExternalId?: string;
    jobId?: string;
    domain?: string;
  },
): Promise<AdapterResult> {
  const id = hookId.replace(/^partner_/, '');
  switch (id) {
    case 'dialpad_user_stub_if_phone':
    case 'provision_dialpad_user':
      return dialpadProvisionUser({
        entityId: input.entityId,
        email: input.email ?? '',
      });
    case 'dialpad_revoke_stub':
    case 'revoke_dialpad_user':
      return dialpadRevokeUser({
        entityId: input.entityId,
        email: input.email,
      });
    case 'gusto_employee_stub_if_internal':
    case 'provision_gusto_employee':
      return gustoProvisionEmployee({
        entityId: input.entityId,
        email: input.email,
      });
    case 'gusto_terminate_stub':
    case 'terminate_gusto_employee':
      return gustoTerminateEmployee({
        entityId: input.entityId,
        userExternalId: input.userExternalId,
      });
    case 'pending_verified_first_if_required':
      return verifiedFirstPendingStub({
        entityId: input.entityId,
        email: input.email,
      });
    case 'apollo_user_revoke_stub':
      return apolloRevokeUser({
        entityId: input.entityId,
        email: input.email,
      });
    case 'marketing_presence_editor_revoke_stub':
    case 'revoke_google_business_managers_if_sole':
    case 'revoke_linkedin_company_admin_if_sole':
      return marketingPresenceRevokeEditor({ entityId: input.entityId });
    case 'marketing_presence_slots_ensure':
    case 'ensure_google_business_location_slot':
      return marketingPresenceImportStub('google_business', {
        entityId: input.entityId,
      });
    case 'ensure_ga4_property_binding':
      return marketingPresenceImportStub('google_analytics', {
        entityId: input.entityId,
      });
    case 'ensure_linkedin_company_page_binding':
      return marketingPresenceImportStub('linkedin_company', {
        entityId: input.entityId,
      });
    case 'enable_mybasepay_if_recruiting':
      return mybasepayCreatePlacementWorker({
        entityId: input.entityId,
        placementId: 'entity-create',
        workerEmail: input.email ?? 'pending@entity-create',
      });
    case 'ensure_apollo_workspace_binding':
      return apolloImportCompany({
        entityId: input.entityId,
        domain: input.domain ?? 'example.com',
      });
    case 'ensure_appcast_employer_binding':
      return appcastPublishStub({
        entityId: input.entityId,
        jobId: input.jobId ?? 'entity-create',
      });
    case 'ensure_linkedin_recruiter_seat_pool':
      return linkedinRecruiterSyncStub({ entityId: input.entityId });
    case 'partner_spine_enablements_ensure':
    case 'docusign_template_scope_note':
    case 'ensure_dialpad_office':
    case 'seed_screening_entity_defaults':
    case 'ensure_gusto_company_binding':
    case 'ensure_docusign_account_binding':
      return entityCreateAckStub(id);
    default:
      return {
        ok: true,
        dryRun: true,
        status: 'dry_run',
        message: `Unhandled partner hook ${hookId} — recorded as dry-run stub.`,
      };
  }
}
