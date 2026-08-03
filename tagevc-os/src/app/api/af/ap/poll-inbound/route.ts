import { NextResponse } from 'next/server';
import { pollApInboundMailbox } from '@/lib/af/ap/inbound-poller';

export const runtime = 'nodejs';

/**
 * Cron / manual: GET or POST with CRON_SECRET / AP_INBOUND_WEBHOOK_SECRET.
 */
function authorized(req: Request): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret =
    process.env.CRON_SECRET?.trim() ||
    process.env.DIGEST_SECRET?.trim() ||
    process.env.AP_INBOUND_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const header =
    req.headers.get('x-cron-secret') ||
    req.headers.get('x-ap-inbound-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(header && header === secret);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const result = await pollApInboundMailbox({ top: 40 });
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

export async function POST(req: Request) {
  return GET(req);
}
