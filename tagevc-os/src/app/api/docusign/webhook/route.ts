import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import {
  annotateSignedArchive,
  applyDocuSignWebhook,
  listDocuments,
} from '@/lib/data/document-store';
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
    // Account-level + org-level Connect keys may differ; allow comma-separated secrets.
    const secrets = hmacSecret
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (secrets.some((secret) => verifyConnectHmac(rawBody, sig, secret))) {
      return { ok: true };
    }
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

  const matched = listDocuments().find(
    (candidate) => candidate.envelope_id === parsed.envelope_id,
  );
  if (!matched) {
    const eventPersist = await insertDocuSignEvent({
      event_id: parsed.event_id ?? undefined,
      envelope_id: parsed.envelope_id,
      status: parsed.status,
      event_type: parsed.event_type,
      raw_payload: parsed.raw,
    });
    if (!eventPersist.ok) {
      return NextResponse.json(
        { error: eventPersist.error, event_persist_ok: false },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      acknowledged: true,
      document_matched: false,
      event_persist_ok: true,
    });
  }

  const ref = matched.deal_or_task_id;
  const ticketId = ref && /^TKT-/i.test(ref) ? ref : null;
  const dealId = ref && !ticketId ? ref : null;
  const eventPersist = await insertDocuSignEvent({
    event_id: parsed.event_id ?? undefined,
    envelope_id: parsed.envelope_id,
    status: parsed.status,
    event_type: parsed.event_type,
    doc_id: matched.doc_id,
    entity_id: matched.entity_id,
    deal_id: dealId,
    ticket_id: ticketId,
    raw_payload: parsed.raw,
  });
  if (!eventPersist.ok) {
    return NextResponse.json(
      { error: eventPersist.error, event_persist_ok: false },
      { status: 503 },
    );
  }
  const projectionAlreadyApplied =
    matched.status.toLowerCase() ===
    (parsed.status === 'completed'
      ? 'completed'
      : parsed.status === 'signed'
        ? 'signed'
        : parsed.status);
  const suppressReplayEffects =
    eventPersist.replayed && projectionAlreadyApplied;

  try {
    const doc = projectionAlreadyApplied
      ? matched
      : applyDocuSignWebhook({
          envelope_id: parsed.envelope_id,
          status: parsed.status as
            | 'sent'
            | 'delivered'
            | 'signed'
            | 'completed'
            | 'declined'
            | 'voided',
        });

    if (
      !suppressReplayEffects &&
      (parsed.status === 'signed' || parsed.status === 'completed')
    ) {
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

    if (!suppressReplayEffects && parsed.status === 'voided') {
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

    let signedArchive: Awaited<ReturnType<typeof archiveSignedDocument>> | null =
      null;
    if (parsed.status === 'completed') {
      signedArchive = await archiveSignedDocument(doc, {
        providerStatus: parsed.status,
        sourceRequestId:
          parsed.event_id ??
          `connect:${createHash('sha256').update(rawBody).digest('hex')}`,
      });
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

      // Phase 28: email CoC when archived (best-effort)
      if (
        (signedArchive?.coc?.ok && !signedArchive.coc.replayed) ||
        (signedArchive?.ok && !signedArchive.replayed)
      ) {
        try {
          const { emailCertificateOfCompletion } = await import(
            '@/lib/docusign/coc-email'
          );
          const cocMail = await emailCertificateOfCompletion({
            envelope_id: parsed.envelope_id,
            doc_id: doc.doc_id,
            include_ops: true,
          });
          if (!cocMail.ok && !cocMail.skipped) {
            console.warn('[docusign] CoC email', cocMail.detail);
          }
        } catch (e) {
          console.warn('[docusign] CoC email failed', e);
        }
      }

      // Library → send → attach: apply stashed target on completed envelopes
      if (!suppressReplayEffects) {
        try {
          const { applyStashedLibraryAttach } = await import(
            '@/lib/docusign/attach-from-send'
          );
          const attached = await applyStashedLibraryAttach({
            docId: doc.doc_id,
            envelopeId: parsed.envelope_id,
          });
          if (!attached.ok) {
            console.warn('[docusign] attach apply', attached.error);
          }
        } catch (e) {
          console.warn('[docusign] attach apply failed', e);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      doc_id: doc.doc_id,
      status: doc.status,
      library_path: doc.library_path,
      event_persist_ok: eventPersist.ok,
      event_replayed: eventPersist.replayed,
      signed_archive: signedArchive,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    captureException(e, { route: 'docusign/webhook' });
    return NextResponse.json(
      { error: msg, event_persist_ok: true },
      { status: 500 },
    );
  }
}
