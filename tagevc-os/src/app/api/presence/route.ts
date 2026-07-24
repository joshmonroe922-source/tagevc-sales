import { NextResponse } from 'next/server';
import {
  getAvailability,
  isEffectivelyDnd,
  listActiveSoftAlerts,
  upsertAvailability,
  type AvailabilityStatus,
} from '@/lib/messaging/availability';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const dynamic = 'force-dynamic';

/**
 * Cross-portal presence contract for Recruit 619 / Instant NDA shells.
 * Auth: Authorization: Bearer ${TAGE_PRESENCE_SECRET}
 * Body/query identify user by email (same Microsoft identity across portals).
 *
 * Calendar signals (documented in ms-calendar-presence.ts):
 * - mailboxSettings.timeZone
 * - calendarView showAs in {busy,oof,workingElsewhere}
 */
function authorized(req: Request): boolean {
  const secret = process.env.TAGE_PRESENCE_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

async function profileIdForEmail(email: string): Promise<string | null> {
  const sb = await createPersistClient();
  const { data } = await sb
    .from('profiles')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized — set TAGE_PRESENCE_SECRET' },
      { status: 401 },
    );
  }
  const url = new URL(req.url);
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, error: 'email required' }, { status: 400 });
  }
  const profileId = await profileIdForEmail(email);
  if (!profileId) {
    return NextResponse.json({ ok: false, error: 'profile not found' }, { status: 404 });
  }
  const avail = await getAvailability(profileId);
  const alerts = await listActiveSoftAlerts(profileId, false);
  const dnd = isEffectivelyDnd(avail);
  return NextResponse.json({
    ok: true,
    profileId,
    status: avail?.status === 'dnd' || dnd ? 'dnd' : 'available',
    source: avail?.source ?? 'manual',
    microsoftTimezone: avail?.microsoft_timezone ?? null,
    alerts: dnd
      ? alerts.filter((a) => a.kind === 'urgent_dnd' || a.priority === 'urgent')
      : alerts,
    messagesUrl:
      (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.tagevc.com') +
      '/messages',
  });
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized — set TAGE_PRESENCE_SECRET' },
      { status: 401 },
    );
  }
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    status?: AvailabilityStatus;
  } | null;
  const email = (body?.email ?? '').trim().toLowerCase();
  const status = body?.status;
  if (!email || (status !== 'available' && status !== 'dnd')) {
    return NextResponse.json(
      { ok: false, error: 'email and status (available|dnd) required' },
      { status: 400 },
    );
  }
  const profileId = await profileIdForEmail(email);
  if (!profileId) {
    return NextResponse.json({ ok: false, error: 'profile not found' }, { status: 404 });
  }
  const saved = await upsertAvailability({
    profileId,
    status,
    source: 'manual',
  });
  if (!saved.ok) {
    return NextResponse.json(saved, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    status: saved.row.status,
    source: saved.row.source,
  });
}
