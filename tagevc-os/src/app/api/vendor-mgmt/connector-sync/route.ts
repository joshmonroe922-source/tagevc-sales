/**
 * Vendor Management connector dry-run / sync sweep.
 * Auth: CRON_SECRET / DIGEST_SECRET bearer, x-vercel-cron, or VM manage_admins session.
 */

import { NextResponse } from 'next/server';
import { runAllConnectorDryRuns } from '@/lib/vendor-mgmt/connector-jobs';
import { requireVmSession } from '@/lib/vendor-mgmt/session';

async function authorize(request: Request): Promise<
  | { ok: true; source: 'cron' | 'admin'; email: string | null }
  | { ok: false; status: number; error: string }
> {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  const bearer = request.headers.get('authorization');
  const bearerOk =
    Boolean(secret) &&
    Boolean(bearer) &&
    bearer === `Bearer ${secret}`;

  if ((secret && header === secret) || bearerOk) {
    return { ok: true, source: 'cron', email: 'cron@tagevc.com' };
  }
  if (request.headers.get('x-vercel-cron') === '1') {
    return { ok: true, source: 'cron', email: 'cron@tagevc.com' };
  }

  try {
    const session = await requireVmSession('manage_admins');
    return { ok: true, source: 'admin', email: session.email };
  } catch {
    if (secret) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
    return { ok: false, status: 403, error: 'Forbidden' };
  }
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const results = await runAllConnectorDryRuns({ actorEmail: auth.email });
  const syncOk = results.filter((r) => r.syncOk).length;
  const dryRuns = results.filter((r) => r.status === 'dry_run').length;
  const failed = results.filter((r) => !r.ok || r.status === 'blocked').length;
  return NextResponse.json({
    ok: syncOk === results.length && results.length > 0,
    status: syncOk === results.length ? 'live_ok' : dryRuns ? 'dry_run' : 'partial',
    syncOk,
    source: auth.source,
    ran: results.length,
    dryRuns,
    failed,
    results: results.map((r) => ({
      id: r.integrationId,
      system: r.systemName,
      status: r.status,
      dryRun: r.dryRun,
      ok: r.ok,
      syncOk: r.syncOk,
      message: r.message,
    })),
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
