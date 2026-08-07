import { NextResponse } from 'next/server';
import { IDENTITY_CONTRACT_VERSION } from '@/lib/identity/types';
import { runIdentityWorkerBatch } from '@/lib/identity/workers/dispatch';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

async function authorize(request: Request): Promise<
  | { ok: true; source: 'cron' | 'admin' }
  | { ok: false; status: number; error: string }
> {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  const bearer = request.headers.get('authorization');
  const bearerOk =
    Boolean(secret) && Boolean(bearer) && bearer === `Bearer ${secret}`;
  if ((secret && header === secret) || bearerOk) {
    return { ok: true, source: 'cron' };
  }
  const gate = await guardPermission('write:it_assets');
  if (gate.ok) return { ok: true, source: 'admin' };
  if (secret) return { ok: false, status: 401, error: 'Unauthorized' };
  return { ok: false, status: 403, error: gate.error };
}

/** Drain identity_worker_jobs (entra / intune / entitlement / notify). */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, money_auto_approve: false },
      { status: auth.status },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      commands?: string[];
    };
    const result = await runIdentityWorkerBatch({
      limit: body.limit ?? 10,
      commands: body.commands,
    });
    return NextResponse.json({
      ok: true,
      contract_version: IDENTITY_CONTRACT_VERSION,
      money_auto_approve: false as const,
      source: auth.source,
      ...result,
    });
  } catch (e) {
    captureException(e, { route: 'identity/worker POST' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'worker failed',
        money_auto_approve: false,
        // Soft preview when SQL not applied
        todo: 'TODO: apply supabase/phase97_identity_device_lifecycle.sql',
      },
      { status: 500 },
    );
  }
}
