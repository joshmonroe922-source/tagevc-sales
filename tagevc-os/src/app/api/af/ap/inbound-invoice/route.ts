/**
 * Inbound invoice parse webhook (D05).
 * Wire Resend/Postmark/Google Group → this route with AP_INBOUND_WEBHOOK_SECRET.
 */

import { NextResponse } from 'next/server';
import {
  apInboundConfigured,
  resolveEntityFromInvoiceAddress,
} from '@/lib/af/ap/invoice-inbox';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const runtime = 'nodejs';

function authorized(req: Request): boolean {
  const secret = process.env.AP_INBOUND_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const header =
    req.headers.get('x-ap-inbound-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(header && header === secret);
}

export async function POST(req: Request) {
  if (!apInboundConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'AP inbound not configured — set AP_INBOUND_WEBHOOK_SECRET and create entity mailboxes (docs/AP_INVOICE_W9_EMAIL.md)',
      },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const toAddress = String(body.to || body.recipient || '').trim();
  const entityCode =
    resolveEntityFromInvoiceAddress(toAddress) ||
    (typeof body.entity_code === 'string'
      ? (body.entity_code as 'TVC' | 'R619' | 'SHR' | 'INDA')
      : null);

  if (!entityCode) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Could not resolve entity from To: address — use ap+{tag}@…',
      },
      { status: 422 },
    );
  }

  const cadence =
    String(body.cadence || '').toLowerCase() === 'recurring'
      ? 'recurring'
      : 'one_time';

  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_af_inbound_invoices')
      .insert({
        entity_code: entityCode,
        cadence,
        status: 'draft',
        amount_cents:
          body.amount_cents != null ? Number(body.amount_cents) : null,
        currency: String(body.currency || 'USD'),
        external_message_id: body.message_id
          ? String(body.message_id)
          : null,
        from_email: body.from ? String(body.from) : null,
        subject: body.subject ? String(body.subject) : null,
        attachment_path: body.attachment_path
          ? String(body.attachment_path)
          : null,
        raw_meta: body,
      })
      .select('id')
      .single();

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          hint: 'Apply supabase/phase92_ap_w9_invoice_spine.sql',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      id: data?.id,
      entity_code: entityCode,
      status: 'draft',
      message: 'Invoice draft queued for AP approval',
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Inbound persist failed',
      },
      { status: 500 },
    );
  }
}
