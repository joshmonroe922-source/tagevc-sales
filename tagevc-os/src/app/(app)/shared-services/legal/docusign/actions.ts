'use server';

import { revalidatePath } from 'next/cache';
import { applyDocuSignWebhook } from '@/lib/data/document-store';
import { insertDocuSignEvent } from '@/lib/docusign/events-repo';
import { voidEnvelope } from '@/lib/docusign/envelopes';
import { backfillSignedFilesToStorage } from '@/lib/docusign/signed-docs';
import { logActivity } from '@/lib/data/activity';
import { guardPermission } from '@/lib/rbac/session';

export type DocuSignActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function revalidateDocuSign() {
  revalidatePath('/shared-services/legal/docusign');
  revalidatePath('/documents');
}

export async function voidEnvelopeAction(
  envelopeId: string,
  reason: string,
): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;

  const id = envelopeId.trim();
  if (!id) return { ok: false, error: 'envelope_id required' };

  const api = await voidEnvelope(id, reason || 'Voided via Tage VC OS');
  if (!api.ok) return api;

  try {
    applyDocuSignWebhook({ envelope_id: id, status: 'voided' });
  } catch {
    // Envelope may be Connect-only / unknown locally — still log event
  }

  await insertDocuSignEvent({
    envelope_id: id,
    status: 'voided',
    event_type: 'envelope-voided',
    raw_payload: { reason, source: 'hub' },
  });

  void logActivity({
    module: 'documents',
    action: 'docusign_voided',
    title: `Envelope voided: ${id.slice(0, 18)}`,
    ref_type: 'document',
    ref_id: id,
  });

  revalidateDocuSign();
  return { ok: true, message: `Voided ${id}` };
}

export async function backfillSignedStorageAction(): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;

  const res = await backfillSignedFilesToStorage({ limit: 25 });
  revalidateDocuSign();
  return {
    ok: true,
    message: `Backfill: ${res.uploaded} uploaded, ${res.failed} failed (${res.processed} processed)`,
  };
}
