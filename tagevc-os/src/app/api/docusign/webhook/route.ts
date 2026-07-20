import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyDocuSignWebhook } from '@/lib/data/document-store';
import { createBroadcastNotification, logActivity } from '@/lib/data/activity';

/**
 * DocuSign Connect-style webhook.
 * POST { envelope_id, status }
 * Optional header: x-tagevc-webhook-secret (required when DOCUSIGN_WEBHOOK_SECRET is set)
 */
export async function POST(request: Request) {
  const secret = process.env.DOCUSIGN_WEBHOOK_SECRET;
  if (secret) {
    const provided = request.headers.get('x-tagevc-webhook-secret');
    if (provided !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn(
      'DOCUSIGN_WEBHOOK_SECRET is not set — webhook is open. Set it in Vercel.',
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = z
    .object({
      envelope_id: z.string().min(1),
      status: z.enum([
        'sent',
        'delivered',
        'signed',
        'completed',
        'declined',
        'voided',
      ]),
    })
    .safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    const doc = applyDocuSignWebhook(parsed.data);

    if (parsed.data.status === 'signed' || parsed.data.status === 'completed') {
      void logActivity({
        module: 'documents',
        action: `docusign_${parsed.data.status}`,
        title: `Document ${parsed.data.status}: ${doc.title}`,
        ref_type: 'document',
        ref_id: doc.doc_id,
        entity_id: doc.entity_id ?? undefined,
      });
      void createBroadcastNotification({
        kind: 'document_signed',
        title: `${doc.title} was ${parsed.data.status}`,
        body: doc.entity_id ? `Entity ${doc.entity_id}` : undefined,
        href: `/documents/${doc.doc_id}`,
      });
    }

    return NextResponse.json({
      ok: true,
      doc_id: doc.doc_id,
      status: doc.status,
      library_path: doc.library_path,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed' },
      { status: 404 },
    );
  }
}
