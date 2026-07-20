import { NextResponse } from 'next/server';
import { pullLiveEngagement } from '@/lib/shared-services/marketing-engagement';
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
    Boolean(secret) &&
    Boolean(bearer) &&
    bearer === `Bearer ${secret}`;

  if ((secret && header === secret) || bearerOk) {
    return { ok: true, source: 'cron' };
  }

  const gate = await guardPermission('write:marketing');
  if (gate.ok) return { ok: true, source: 'admin' };

  if (secret) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: false, status: 403, error: gate.error };
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(
      Number(url.searchParams.get('limit') ?? 15) || 15,
      40,
    );
    const { results, pulled, failed } = await pullLiveEngagement({ limit });
    return NextResponse.json({
      ok: true,
      source: auth.source,
      pulled,
      failed,
      results,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    captureException(e, { route: 'marketing/engagement-pull' });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'pull failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
