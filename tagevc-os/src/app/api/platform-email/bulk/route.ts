import { NextResponse } from 'next/server';
import { sendBulkTrackedEmail } from '@/lib/platform-email/bulk-compose';
import { getSessionContext } from '@/lib/rbac/session';

export const runtime = 'nodejs';

/**
 * POST { entityId, subject, bodyText|bodyHtml, recipients[], userAccessToken, replyTo }
 * Bulk channel: tracked + Reply-To user.
 */
export async function POST(req: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const userAccessToken = String(body.userAccessToken || '').trim();
  const replyTo = String(body.replyTo || session.profile.email || '').trim();
  const recipients = Array.isArray(body.recipients)
    ? (body.recipients as Array<{ email: string; name?: string }>)
    : [];

  if (!userAccessToken) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'userAccessToken required — delegated Graph token from user M365 connect',
      },
      { status: 422 },
    );
  }
  if (!recipients.length) {
    return NextResponse.json(
      { ok: false, error: 'recipients required' },
      { status: 422 },
    );
  }

  const result = await sendBulkTrackedEmail({
    entityId: String(body.entityId || session.profile.entity_id || 'ENT-FIRM'),
    subject: String(body.subject || ''),
    bodyHtml: body.bodyHtml ? String(body.bodyHtml) : undefined,
    bodyText: body.bodyText ? String(body.bodyText) : undefined,
    recipients,
    userAccessToken,
    replyTo,
    sentByProfileId: session.profile.id,
    campaignId: body.campaignId ? String(body.campaignId) : null,
  });

  return NextResponse.json({ ok: true, ...result });
}
