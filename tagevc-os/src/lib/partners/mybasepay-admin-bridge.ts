/**
 * MyBasePay interim admin backoffice bridge (until October official API).
 * Fail-closed: no remote writes unless MYBASEPAY_LIVE=1 + MYBASEPAY_ALLOW_CREATE=1.
 * Secrets stay in env — never log passwords or JWTs.
 */

import {
  isMyBasePayLive,
  mybasepayLoginUrl,
  resolveMyBasePayEntity,
  type MyBasePayResolution,
} from '@/lib/partners/mybasepay-entity';
import {
  MYBASEPAY_WORKER_TYPE_IDS,
  mybasepayAdminLogin,
  mybasepayCreateWorker as mybasepayCreateWorkerRemote,
  mybasepayListWorkersPage,
  type MyBasePayCreateWorkerInput as RemoteCreateInput,
  type MyBasePayWorkerType as RemoteWorkerType,
} from '@/lib/partners/mybasepay-admin';

type AdapterResult =
  | {
      ok: true;
      dryRun: boolean;
      status: 'dry_run' | 'live_ok' | 'failed';
      message: string;
      externalRef?: string;
    }
  | {
      ok: false;
      error: string;
      dryRun?: boolean;
      status: 'dry_run' | 'live_ok' | 'failed';
    };

export type MyBasePayWorkerType = 'W2' | 'IC' | 'International IC' | 'SC';

export type MyBasePayCreateWorkerInput = {
  entityId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  workerType: MyBasePayWorkerType;
  country?: string;
  state: string;
  city: string;
  address: string;
  zip: string;
};

export type MyBasePayUiMap = {
  baseUrl: string;
  loginPath: string;
  apiBase: string;
  loginApiPath: string;
  workersPagedPath: string;
  createWorkerApiPath: string;
  surfaces: Array<{
    key: string;
    path: string;
    purpose: string;
  }>;
  createWorkerFields: string[];
  workerTypes: MyBasePayWorkerType[];
};

function toRemoteWorkerType(t: MyBasePayWorkerType): RemoteWorkerType {
  if (t === 'International IC') return 'INTERNATIONAL_IC';
  return t;
}

/** Static UI + API map from 2026-08-06 backoffice login smoke (no secrets). */
export function mybasepayUiMap(baseUrl?: string): MyBasePayUiMap {
  const root = (baseUrl ?? 'https://backoffice.mybasepay.com').replace(
    /\/+$/,
    '',
  );
  return {
    baseUrl: root,
    loginPath: '/login',
    apiBase: 'https://api.mybasepay.com',
    loginApiPath: '/account-service/user/login',
    workersPagedPath: '/backoffice/workers/paged?pageNumber=0',
    createWorkerApiPath: '/backoffice/workers',
    surfaces: [
      {
        key: 'dashboard',
        path: '/?section=summary',
        purpose: 'Summary: customers, active assignments, timesheet status',
      },
      {
        key: 'customers',
        path: '/customers?section=approved',
        purpose: 'Customer accounts for placements',
      },
      {
        key: 'assignments',
        path: '/assignments?section=all',
        purpose: 'Assignments (my / drafts / templates / partner)',
      },
      {
        key: 'workers',
        path: '/workers?section=workers',
        purpose: 'Workers + contractor companies; create worker modal',
      },
      {
        key: 'partners',
        path: '/partners',
        purpose: 'Partner directory',
      },
      {
        key: 'company_profile',
        path: '/company-profile?section=primary',
        purpose: 'Member company profile (non-secret account metadata)',
      },
      {
        key: 'timesheets',
        path: '/?section=summary',
        purpose: 'Timesheet status report (SoR remains in MyBasePay)',
      },
    ],
    createWorkerFields: [
      'first_name',
      'last_name',
      'email',
      'phone',
      'worker_type',
      'country',
      'state',
      'city',
      'address',
      'zip',
    ],
    workerTypes: ['W2', 'IC', 'International IC', 'SC'],
  };
}

function dryRun(message: string, externalRef?: string): AdapterResult {
  return {
    ok: true,
    dryRun: true,
    status: 'dry_run',
    message,
    externalRef,
  };
}

function fail(error: string): AdapterResult {
  return { ok: false, status: 'failed', error, dryRun: false };
}

/**
 * Capability check for interim bridge — does not create workers.
 * Env posture by default; set MYBASEPAY_SMOKE_NETWORK=1 to hit login + workers page 0.
 */
export async function mybasepaySmokeCheck(entityId: string): Promise<AdapterResult> {
  const resolved = await resolveMyBasePayEntity(entityId);
  if (!resolved.entityId) {
    return fail(
      `MyBasePay refuse: entity ${entityId} is not enabled (ENT-R619 only until opt-in).`,
    );
  }
  if (!resolved.credentialsReady) {
    return dryRun(
      `MyBasePay smoke dry-run for ${resolved.entityId} — set MYBASEPAY_ADMIN_EMAIL + MYBASEPAY_ADMIN_PASSWORD (or MYBASEPAY_API_KEY). Login URL: ${mybasepayLoginUrl()}. LIVE=${isMyBasePayLive() ? '1' : '0'}.`,
      resolved.externalAccountId ?? undefined,
    );
  }
  if (process.env.MYBASEPAY_SMOKE_NETWORK?.trim() === '1') {
    const login = await mybasepayAdminLogin({ force: true });
    if (!login.ok) {
      return fail(
        login.needsMfa
          ? 'MyBasePay login MFA — NEED_HUMAN'
          : login.error,
      );
    }
    const list = await mybasepayListWorkersPage({ pageNumber: 0 });
    if (!list.ok) {
      return fail(list.error);
    }
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message: `MyBasePay network smoke OK for ${resolved.entityId} (login + workers paged). LIVE=${isMyBasePayLive() ? '1' : '0'}; no creates.`,
      externalRef: resolved.externalAccountId ?? undefined,
    };
  }
  if (!isMyBasePayLive()) {
    return dryRun(
      `MyBasePay admin bridge configured for ${resolved.entityId} (${resolved.connectionMode}, source=${resolved.source}). MYBASEPAY_LIVE≠1 — login smoke via scripts/mybasepay-login-smoke.mjs only; no contractor writes.`,
      resolved.externalAccountId ?? undefined,
    );
  }
  return fail(
    'MyBasePay LIVE=1 but create still needs MYBASEPAY_ALLOW_CREATE=1 + proven write path — refuse broad LIVE without create gate.',
  );
}

export async function mybasepayCreateWorker(
  input: MyBasePayCreateWorkerInput,
): Promise<AdapterResult> {
  const remote: RemoteCreateInput = {
    entityId: input.entityId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    workerType: toRemoteWorkerType(input.workerType),
    country: input.country,
    state: input.state,
    city: input.city,
    address: input.address,
    zip: input.zip,
  };
  void MYBASEPAY_WORKER_TYPE_IDS;
  return mybasepayCreateWorkerRemote(remote);
}

export async function mybasepaySyncPull(entityId: string): Promise<AdapterResult> {
  const resolved = await resolveMyBasePayEntity(entityId);
  if (!resolved.entityId) {
    return fail(`MyBasePay refuse sync: entity ${entityId} not bound.`);
  }
  if (!isMyBasePayLive()) {
    return dryRun(
      `MyBasePay sync-pull dry-run for ${resolved.entityId} — workers/assignments/timesheets stay SoR in backoffice until LIVE pull lands.`,
      resolved.externalAccountId ?? undefined,
    );
  }
  if (process.env.MYBASEPAY_ALLOW_CREATE?.trim() !== '1') {
    // Reuse create gate as "write/sync enabled" until split flags exist.
    return fail(
      'MyBasePay LIVE sync-pull not enabled — set MYBASEPAY_ALLOW_CREATE=1 only after deliberate pull implement.',
    );
  }
  return fail(
    'MyBasePay live sync-pull not implemented — interim bridge is login + UI map + gated create.',
  );
}

export function describeMyBasePayResolution(
  resolved: MyBasePayResolution,
): string {
  const email = resolved.adminEmail
    ? `${resolved.adminEmail.slice(0, 3)}…@…`
    : 'unset';
  return [
    `entity=${resolved.entityId ?? 'none'}`,
    `mode=${resolved.connectionMode}`,
    `source=${resolved.source}`,
    `account=${resolved.externalAccountId ?? 'unset'}`,
    `email=${email}`,
    `password=${resolved.hasAdminPassword ? 'set' : 'unset'}`,
    `live=${isMyBasePayLive() ? '1' : '0'}`,
  ].join(' ');
}

export {
  mybasepayAdminLogin,
  mybasepayListWorkersPage,
  clearMyBasePaySessionCache,
} from '@/lib/partners/mybasepay-admin';
