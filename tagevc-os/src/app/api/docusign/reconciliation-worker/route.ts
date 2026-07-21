import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import { reconcileDocuSignEnvelopes } from '@/lib/docusign/reconciliation-repo';

async function authorize(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || '';
  if (
    secret &&
    (request.headers.get('authorization') === `Bearer ${secret}` ||
      request.headers.get('x-tagevc-digest-secret') === secret)
  ) {
    return { ok: true as const, trigger: 'cron' as const, actor: null };
  }
  const gate = await guardPermission('write:documents');
  return gate.ok
    ? {
        ok: true as const,
        trigger: 'manual' as const,
        actor: gate.profile.id,
      }
    : { ok: false as const, error: gate.error };
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }
  const result = await reconcileDocuSignEnvelopes({
    trigger: auth.trigger,
    requestedBy: auth.actor,
    days: 30,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
