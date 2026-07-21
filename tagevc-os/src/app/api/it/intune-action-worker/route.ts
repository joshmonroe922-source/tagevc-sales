import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import { processIntuneActions } from '@/lib/shared-services/it-intune-worker';

async function authorize(request: Request, cronOnly = false) {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || '';
  if (
    secret &&
    (request.headers.get('authorization') === `Bearer ${secret}` ||
      request.headers.get('x-tagevc-digest-secret') === secret)
  ) {
    return true;
  }
  if (cronOnly) return false;
  const gate = await guardPermission('action:intune_retire');
  return gate.ok;
}

async function run(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const result = await processIntuneActions();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: Request) {
  if (!(await authorize(request, true))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const result = await processIntuneActions();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(request: Request) {
  return run(request);
}
