import { NextResponse } from 'next/server';
import { markCriticalEmailDeliveryPhase59 } from '@/lib/notifications/practical-notifications-phase59-server';
import { createPersistClient } from '@/lib/supabase/persist-client';

/**
 * Digest runner — call via cron or manually.
 * Auth: optional CRON_SECRET / DIGEST_SECRET header `x-tagevc-digest-secret`.
 * When RESEND_API_KEY is set:
 *  - emails users with email_digests + daily/weekly (unread summary)
 *  - emails users with email_critical_digests when unread critical_event > 0
 * Always writes an in-app digest notification summarizing unread counts.
 * Phase 59: records critical email delivery evidence; full_push=false.
 */
export async function POST(request: Request) {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  if (secret) {
    const header = request.headers.get('x-tagevc-digest-secret');
    if (header !== secret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const supabase = await createPersistClient();
    const { data: prefs, error } = await supabase
      .from('os_notification_prefs')
      .select('*');

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error:
            error.message.includes('os_notification_prefs')
              ? 'Apply Phase 13 SQL first'
              : error.message,
        },
        { status: 500 },
      );
    }

    const resendKey = process.env.RESEND_API_KEY;
    const from = process.env.DIGEST_FROM_EMAIL || 'noreply@tagevc.com';
    let emailed = 0;
    let criticalEmailed = 0;
    let notified = 0;

    for (const pref of prefs ?? []) {
      const userId = pref.user_id as string;
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', userId)
        .maybeSingle();
      if (!profile?.email) continue;

      const { count } = await supabase
        .from('app_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null);

      const unread = count ?? 0;

      const { count: criticalCount } = await supabase
        .from('app_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('kind', 'critical_event')
        .is('read_at', null);

      const unreadCritical = criticalCount ?? 0;

      const wantsSummary =
        Boolean(pref.email_digests) &&
        pref.digest_frequency !== 'off' &&
        unread > 0;

      if (wantsSummary) {
        const title = `Digest: ${unread} unread notification${unread === 1 ? '' : 's'}`;
        const body = `You have ${unread} unread item(s) in Tage VC OS. Open Activity to catch up.`;

        await supabase.from('app_notifications').insert({
          notification_id: `NTF-DG-${crypto.randomUUID().slice(0, 8)}`,
          user_id: userId,
          kind: 'digest',
          title,
          body,
          href: '/activity',
        });
        notified += 1;

        if (resendKey) {
          try {
            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from,
                to: [profile.email],
                subject: title,
                text: `${body}\n\nhttps://app.tagevc.com/activity`,
              }),
            });
            if (res.ok) emailed += 1;
          } catch (e) {
            console.error('digest email failed', e);
          }
        }
      }

      // Phase 59: optional critical-only email (not full push).
      const wantsCritical =
        (pref.email_critical_digests == null
          ? true
          : Boolean(pref.email_critical_digests)) &&
        unreadCritical > 0;

      if (wantsCritical && resendKey) {
        const title = `Critical: ${unreadCritical} unread critical event${unreadCritical === 1 ? '' : 's'}`;
        const body = `You have ${unreadCritical} unread critical notification(s) in Tage VC OS. Open Activity to review.`;
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from,
              to: [profile.email],
              subject: title,
              text: `${body}\n\nhttps://app.tagevc.com/activity`,
            }),
          });
          await markCriticalEmailDeliveryPhase59({
            recipientUserId: userId,
            deliveryStatus: res.ok ? 'delivered' : 'failed',
            eventKind: 'critical_digest',
            notificationRef: `NTF-CRIT-${crypto.randomUUID().slice(0, 8)}`,
          });
          if (res.ok) criticalEmailed += 1;
        } catch (e) {
          console.error('critical digest email failed', e);
          await markCriticalEmailDeliveryPhase59({
            recipientUserId: userId,
            deliveryStatus: 'failed',
            eventKind: 'critical_digest',
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      notified,
      emailed,
      critical_emailed: criticalEmailed,
      candidates: prefs?.length ?? 0,
      full_push: false,
      contract_version: 'phase59-v1',
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Digest failed',
      },
      { status: 500 },
    );
  }
}
