import { NextResponse } from 'next/server';
import { refreshExpiringTokens } from '@/lib/shared-services/marketing-token-refresh';
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
      Number(url.searchParams.get('limit') ?? 20) || 20,
      50,
    );
    const { results } = await refreshExpiringTokens(limit);
    return NextResponse.json({
      ok: true,
      source: auth.source,
      refreshed: results.filter((r) => r.ok && r.refreshed).length,
      failed: results.filter((r) => !r.ok).length,
      results,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    captureException(e, { route: 'marketing/token-refresh' });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'refresh failed' },
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
