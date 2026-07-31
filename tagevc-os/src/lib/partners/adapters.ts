/**
 * Adapter seams — fail-closed stubs. No fake API credentials.
 */

import { partnerConnectionStatus } from '@/lib/partners/env';
import type { PartnerKey } from '@/lib/partners/catalog';

export type AdapterResult =
  | { ok: true; dryRun: boolean; message: string; externalRef?: string }
  | { ok: false; error: string; dryRun?: boolean };

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
      message: 'Dialpad provision stub (set DIALPAD_LIVE=1 + DIALPAD_API_KEY).',
    };
  }
  return {
    ok: false,
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
      message:
        'Gusto commission queued locally (stub). Wire invoice-paid → commission → payroll when LIVE.',
    };
  }
  return {
    ok: false,
    error: 'Gusto live commission push not implemented — scaffold only.',
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
      message:
        'MyBasePay EOR stub for Recruit 619. Set MYBASEPAY_* when account ready.',
    };
  }
  if (!liveFlag('MYBASEPAY_LIVE')) {
    return {
      ok: true,
      dryRun: true,
      message: 'MyBasePay configured but MYBASEPAY_LIVE≠1 — dry-run.',
    };
  }
  return {
    ok: false,
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
      message: 'Apollo import stub — set APOLLO_API_KEY.',
    };
  }
  if (!liveFlag('APOLLO_LIVE')) {
    return {
      ok: true,
      dryRun: true,
      message: 'Apollo key present; APOLLO_LIVE≠1 — dry-run.',
    };
  }
  return {
    ok: false,
    error: 'Apollo live import not implemented — scaffold only.',
  };
}

export async function linkedinRecruiterSyncStub(_input: {
  entityId: string;
}): Promise<AdapterResult> {
  return {
    ok: true,
    dryRun: true,
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
      message:
        'Appcast publish lives primarily on Recruit 619 portal feed; spine tracks enablement.',
    };
  }
  return {
    ok: true,
    dryRun: !liveFlag('APPCAST_LIVE'),
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
    message: `${kind} import stub — connect OAuth under Marketing → Presence, then enable LIVE.`,
  };
}
