import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import { enqueueScheduledPaidWindows } from '@/lib/shared-services/marketing-paid-backfill';

async function authorize(request: Request) {
  const secret = process.env.CRON_SECRET || '';
  if (secret && request.headers.get('authorization') === `Bearer ${secret}`) {
    return { ok: true as const, source: 'cron' as const, actor: null };
  }
  const gate = await guardPermission('write:marketing');
  return gate.ok
    ? { ok: true as const, source: 'manual' as const, actor: gate.profile.id }
    : { ok: false as const, error: gate.error };
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }
  const result = await enqueueScheduledPaidWindows({
    source: auth.source,
    requestedBy: auth.actor,
  });
  return NextResponse.json(
    { ok: result.errors.length === 0, ...result },
    { status: result.errors.length === 0 ? 200 : 500 },
  );
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
