/**
 * Email Certificate of Completion to signers / ops (Phase 28).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { getSignedFileDownloadUrl } from '@/lib/docusign/signed-docs';
import { logActivity } from '@/lib/data/activity';

export async function emailCertificateOfCompletion(input: {
  envelope_id: string;
  doc_id?: string | null;
  recipients?: string[];
  /** Extra ops recipients from DOCUSIGN_COC_EMAIL_TO */
  include_ops?: boolean;
}): Promise<{
  ok: boolean;
  emailed: number;
  skipped?: boolean;
  detail: string;
}> {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return {
      ok: false,
      emailed: 0,
      skipped: true,
      detail: 'RESEND_API_KEY not set — CoC email skipped',
    };
  }

  const from = process.env.DIGEST_FROM_EMAIL || 'noreply@tagevc.com';
  const opsTo = (process.env.DOCUSIGN_COC_EMAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const sb = await createPersistClient();
  const { data: cocRow } = await sb
    .from('os_docusign_signed_files')
    .select('storage_path, file_name, content_base64, content_type')
    .eq('envelope_id', input.envelope_id)
    .eq('file_kind', 'certificate')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cocRow) {
    return {
      ok: false,
      emailed: 0,
      detail: 'No CoC file archived for envelope',
    };
  }

  let downloadUrl: string | null = null;
  if (cocRow.storage_path) {
    downloadUrl = await getSignedFileDownloadUrl(
      String(cocRow.storage_path),
      7 * 24 * 3600,
    );
  }

  const to = new Set<string>();
  for (const r of input.recipients ?? []) {
    if (r.includes('@')) to.add(r.trim().toLowerCase());
  }
  if (input.include_ops !== false) {
    for (const o of opsTo) to.add(o.toLowerCase());
  }

  // Pull signer emails from document if available
  if (input.doc_id) {
    try {
      const { getDocument } = await import('@/lib/data/document-store');
      const doc = getDocument(input.doc_id);
      for (const s of doc?.signers ?? []) {
        if (s.email?.includes('@')) to.add(s.email.trim().toLowerCase());
      }
    } catch {
      /* optional */
    }
  }

  if (to.size === 0) {
    return {
      ok: false,
      emailed: 0,
      skipped: true,
      detail:
        'No CoC recipients — set DOCUSIGN_COC_EMAIL_TO or pass signer emails',
    };
  }

  const subject = `Certificate of Completion · ${input.envelope_id}`;
  const text = [
    `A Certificate of Completion is available for envelope ${input.envelope_id}.`,
    input.doc_id ? `Document: ${input.doc_id}` : null,
    downloadUrl
      ? `Download (expires in 7 days):\n${downloadUrl}`
      : 'Download from the DocuSign hub in Tage VC OS.',
    '',
    'https://app.tagevc.com/shared-services/legal/docusign',
  ]
    .filter(Boolean)
    .join('\n');

  const attachments: Array<{
    filename: string;
    content: string;
  }> = [];
  if (cocRow.content_base64 && String(cocRow.content_base64).length < 4_500_000) {
    attachments.push({
      filename: String(cocRow.file_name || 'certificate.pdf'),
      content: String(cocRow.content_base64),
    });
  }

  let emailed = 0;
  const errors: string[] = [];
  for (const recipient of to) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject,
          text,
          ...(attachments.length ? { attachments } : {}),
        }),
      });
      if (res.ok) emailed += 1;
      else {
        const body = await res.text().catch(() => '');
        errors.push(`${recipient}: HTTP ${res.status} ${body.slice(0, 80)}`);
      }
    } catch (e) {
      errors.push(
        `${recipient}: ${e instanceof Error ? e.message : 'send failed'}`,
      );
    }
  }

  // Best-effort log table (phase28 SQL)
  try {
    await sb.from('os_docusign_coc_emails').insert({
      envelope_id: input.envelope_id,
      doc_id: input.doc_id ?? null,
      recipients: [...to],
      emailed_count: emailed,
      detail: errors.length ? errors.join('; ') : 'ok',
    });
  } catch {
    /* table may not exist yet */
  }

  void logActivity({
    module: 'documents',
    action: 'docusign_coc_email',
    title: `CoC email: ${emailed}/${to.size} for ${input.envelope_id}`,
    ref_type: 'document',
    ref_id: input.doc_id ?? input.envelope_id,
  });

  return {
    ok: emailed > 0,
    emailed,
    detail:
      emailed > 0
        ? `Emailed CoC to ${emailed} recipient(s)`
        : errors[0] || 'CoC email failed',
  };
}
