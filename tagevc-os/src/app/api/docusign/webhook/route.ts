import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { applyDocuSignWebhook, annotateSignedArchive } from '@/lib/data/document-store';
import { createBroadcastNotification, logActivity } from '@/lib/data/activity';
import { parseConnectPayload } from '@/lib/docusign/connect';
import { insertDocuSignEvent } from '@/lib/docusign/events-repo';
import { archiveSignedDocument } from '@/lib/docusign/signed-docs';
import { captureException } from '@/lib/observability';

/**
 * DocuSign Connect webhook (+ simple mock JSON).
 *
 * Auth (any one when configured):
 * - Header `x-tagevc-webhook-secret` === DOCUSIGN_WEBHOOK_SECRET
 * - HMAC `X-DocuSign-Signature-1` with DOCUSIGN_CONNECT_HMAC_SECRET
 *
 * In production, at least one secret should be set.
 */
function verifyConnectHmac(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const computed = createHmac('sha256', secret).update(rawBody).digest('base64');
  const provided = signatureHeader.trim();
  try {
    const a = Buffer.from(computed);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function authorizeWebhook(
  request: Request,
  rawBody: string,
): { ok: true } | { ok: false; status: number; error: string } {
  const customSecret = process.env.DOCUSIGN_WEBHOOK_SECRET?.trim();
  const hmacSecret = process.env.DOCUSIGN_CONNECT_HMAC_SECRET?.trim();

  if (customSecret) {
    const provided = request.headers.get('x-tagevc-webhook-secret');
    if (provided === customSecret) return { ok: true };
  }

  if (hmacSecret) {
    const sig =
      request.headers.get('x-docusign-signature-1') ||
      request.headers.get('X-DocuSign-Signature-1');
    if (verifyConnectHmac(rawBody, sig, hmacSecret)) return { ok: true };
  }

  if (customSecret || hmacSecret) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[docusign] No DOCUSIGN_WEBHOOK_SECRET or DOCUSIGN_CONNECT_HMAC_SECRET — webhook is open',
    );
  }
  return { ok: true };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = authorizeWebhook(request, rawBody);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = parseConnectPayload(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const doc = applyDocuSignWebhook({
      envelope_id: parsed.envelope_id,
      status: parsed.status as
        | 'sent'
        | 'delivered'
        | 'signed'
        | 'completed'
        | 'declined'
        | 'voided',
    });

    let dealId: string | null = null;
    let ticketId: string | null = null;
    const ref = doc.deal_or_task_id;
    if (ref) {
      if (/^TKT-/i.test(ref)) ticketId = ref;
      else dealId = ref;
    }

    if (parsed.status === 'signed' || parsed.status === 'completed') {
      void logActivity({
        module: 'documents',
        action: `docusign_${parsed.status}`,
        title: `Document ${parsed.status}: ${doc.title}`,
        ref_type: 'document',
        ref_id: doc.doc_id,
        entity_id: doc.entity_id ?? undefined,
      });
      void createBroadcastNotification({
        kind: 'document_signed',
        title: `${doc.title} was ${parsed.status}`,
        body: doc.entity_id ? `Entity ${doc.entity_id}` : undefined,
        href: `/documents/${doc.doc_id}`,
      });
    }

    if (parsed.status === 'voided') {
      void logActivity({
        module: 'documents',
        action: 'docusign_voided',
        title: `Document voided: ${doc.title}`,
        ref_type: 'document',
        ref_id: doc.doc_id,
        entity_id: doc.entity_id ?? undefined,
      });
      void createBroadcastNotification({
        kind: 'document_signed',
        title: `${doc.title} was voided`,
        body: doc.envelope_id ?? undefined,
        href: `/documents/${doc.doc_id}`,
      });
    }

    const eventPersist = await insertDocuSignEvent({
      event_id: parsed.event_id ?? undefined,
      envelope_id: parsed.envelope_id,
      status: parsed.status,
      event_type: parsed.event_type,
      doc_id: doc.doc_id,
      entity_id: doc.entity_id,
      deal_id: dealId,
      ticket_id: ticketId,
      raw_payload: parsed.raw,
    });

    let signedArchive: Awaited<ReturnType<typeof archiveSignedDocument>> | null =
      null;
    if (parsed.status === 'completed') {
      signedArchive = await archiveSignedDocument(doc);
      if (
        signedArchive.ok &&
        signedArchive.library_path &&
        signedArchive.file_name
      ) {
        annotateSignedArchive(doc.doc_id, {
          library_path: signedArchive.library_path,
          file_name: signedArchive.file_name,
          source: signedArchive.source,
        });
      } else if (signedArchive && !signedArchive.ok) {
        console.warn('[docusign] signed archive failed', signedArchive.error);
      }
    }

    return NextResponse.json({
      ok: true,
      doc_id: doc.doc_id,
      status: doc.status,
      library_path: doc.library_path,
      event_persist_ok: eventPersist.ok,
      event_persist_error: eventPersist.ok ? undefined : eventPersist.error,
      signed_archive: signedArchive,
    });
  } catch (e) {
    // Document not in local store — still record the Connect event
    const eventPersist = await insertDocuSignEvent({
      event_id: parsed.event_id ?? undefined,
      envelope_id: parsed.envelope_id,
      status: parsed.status,
      event_type: parsed.event_type,
      raw_payload: parsed.raw,
    });

    const msg = e instanceof Error ? e.message : 'Failed';
    if (msg === 'Envelope not found') {
      console.warn(
        '[docusign] Connect event for unknown envelope',
        parsed.envelope_id,
      );
      return NextResponse.json({
        ok: true,
        acknowledged: true,
        document_matched: false,
        event_persist_ok: eventPersist.ok,
        event_persist_error: eventPersist.ok ? undefined : eventPersist.error,
      });
    }

    captureException(e, { route: 'docusign/webhook' });
    return NextResponse.json(
      { error: msg, event_persist_ok: eventPersist.ok },
      { status: 500 },
    );
  }
}
