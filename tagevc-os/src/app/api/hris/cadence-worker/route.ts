import { NextResponse } from 'next/server';
import {
  runHrisCadence,
  type HrisCadenceKind,
} from '@/lib/hris/cadence-runner';
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
  if (request.headers.get('x-vercel-cron') === '1' && !secret) {
    return { ok: true, source: 'cron' };
  }

  const gate = await guardPermission('write:shared_services');
  if (gate.ok) return { ok: true, source: 'admin' };
  if (secret) return { ok: false, status: 401, error: 'Unauthorized' };
  return { ok: false, status: 403, error: gate.error };
}

function parseKind(request: Request): HrisCadenceKind {
  const raw = new URL(request.url).searchParams.get('kind')?.trim() ?? 'full';
  if (raw === 'timing' || raw === 'escalate' || raw === 'full') return raw;
  return 'full';
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }
  const kind = parseKind(request);
  const result = await runHrisCadence({
    run_kind: kind,
    trigger_source: auth.source === 'cron' ? 'cron' : 'api',
  });
  return NextResponse.json({
    ...result,
    source: auth.source,
    fetched_at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
