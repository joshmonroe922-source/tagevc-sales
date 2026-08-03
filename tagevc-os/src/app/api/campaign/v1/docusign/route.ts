import { requireCampaignAuth } from '@/lib/campaign/auth';
import { listLibraryDocumentsForEntity } from '@/lib/campaign/docusign/library';
import { queueSendEnvelope, dispatchEnvelopeAction } from '@/lib/campaign/docusign-port';
import { dispatchQueuedEnvelopes } from '@/lib/campaign/journey-runner';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

/** Library picker for journey send_envelope nodes. */
export async function GET(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    const url = new URL(req.url);
    const q = url.searchParams.get('q') || undefined;
    const data = await listLibraryDocumentsForEntity(auth.entityId, q);
    return jsonOk({ data });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

/**
 * Queue or dispatch DocuSign from ECC.
 * body.action = queue | dispatch | dispatch_queued
 */
export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    if (!auth.permissions.marketer) {
      return jsonError('FORBIDDEN', 'Marketer role required', 403);
    }
    const body = await readJson<{
      action?: 'queue' | 'dispatch' | 'dispatch_queued';
      library_document_id?: string;
      contact_ids?: string[];
      campaign_id?: string;
      enrollment_id?: string;
      action_id?: string;
      explicit_human_confirm?: boolean;
      email_message?: string;
    }>(req);

    const action = body.action || 'queue';

    if (action === 'dispatch_queued') {
      if (!body.explicit_human_confirm) {
        return jsonError(
          'VALIDATION',
          'explicit_human_confirm required to dispatch live DocuSign',
        );
      }
      const results = await dispatchQueuedEnvelopes({
        entityId: auth.entityId,
        actorId: auth.userId,
        explicitHumanConfirm: true,
      });
      return jsonOk({ data: results });
    }

    if (action === 'dispatch' && body.action_id) {
      if (!body.explicit_human_confirm) {
        return jsonError(
          'VALIDATION',
          'explicit_human_confirm required to dispatch live DocuSign',
        );
      }
      const result = await dispatchEnvelopeAction({
        actionId: body.action_id,
        actorId: auth.userId,
        explicitHumanConfirm: true,
      });
      if (!result.ok) return jsonError('VALIDATION', result.error, 422);
      return jsonOk({ data: result });
    }

    const result = await queueSendEnvelope({
      entityId: auth.entityId,
      libraryDocumentId: String(body.library_document_id || ''),
      contactIds: body.contact_ids || [],
      campaignId: body.campaign_id || null,
      enrollmentId: body.enrollment_id || null,
      emailMessage: body.email_message || null,
      actorId: auth.userId,
      explicitHumanConfirm: Boolean(body.explicit_human_confirm),
      queueOnly: !body.explicit_human_confirm,
    });
    if (!result.ok) return jsonError('VALIDATION', result.error, 422);
    return jsonOk({ data: result }, 201);
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
