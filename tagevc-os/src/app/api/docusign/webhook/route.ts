import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyDocuSignWebhook } from '@/lib/data/document-store';

/**
 * DocuSign Connect-style webhook stub.
 * POST { envelope_id, status }
 */
export async function POST(request: Request) {
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
