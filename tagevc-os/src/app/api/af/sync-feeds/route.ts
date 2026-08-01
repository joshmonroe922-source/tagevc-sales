/**
 * Daily (and on-demand) A&F bank feed sync:
 * Plaid sync → payment auto-match → CoA rules → auto-post above threshold.
 *
 * Auth: CRON_SECRET / DIGEST_SECRET bearer, x-vercel-cron, or write:shared_services.
 */

import { NextResponse } from 'next/server';
import {
  autoMatchFeeds,
  autoPostHighConfidenceFeeds,
  hydrateAfStore,
  runCategorizationRules,
  syncAllConnectedCompanyFeeds,
  DEFAULT_AUTO_POST_THRESHOLD,
} from '@/lib/af';
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
  if (request.headers.get('x-vercel-cron') === '1') {
    return { ok: true, source: 'cron' };
  }

  const gate = await guardPermission('write:shared_services');
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

  await hydrateAfStore();

  const url = new URL(request.url);
  const threshold = Number(
    url.searchParams.get('threshold') ?? DEFAULT_AUTO_POST_THRESHOLD,
  );
  const skipAutoPost = url.searchParams.get('skipAutoPost') === '1';

  const sync = await syncAllConnectedCompanyFeeds();
  const matched = autoMatchFeeds();
  const suggested = runCategorizationRules();
  const auto = skipAutoPost
    ? { posted: 0, errors: [] as string[] }
    : autoPostHighConfidenceFeeds(
        Number.isFinite(threshold) ? threshold : DEFAULT_AUTO_POST_THRESHOLD,
      );

  try {
    const { writeAuditEvent } = await import('@/lib/audit/write');
    await writeAuditEvent({
      action: 'af_feed_sync',
      title: `A&F feed sync · ${sync.ok ? 'ok' : 'partial'}`,
      object_type: 'af_feed_sync',
      object_id: new Date().toISOString().slice(0, 10),
      metadata: {
        trigger: auth.source,
        banks: sync.banks,
        imported: sync.imported,
        matched,
        suggested,
        autoPosted: auto.posted,
        autoErrors: auto.errors.slice(0, 10),
      },
    });
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    ok: sync.ok,
    trigger: auth.source,
    sync,
    matched,
    suggested,
    autoPosted: auto.posted,
    autoErrors: auto.errors,
    message: `${sync.message} · matched ${matched} · suggested ${suggested} · auto-posted ${auto.posted}`,
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
