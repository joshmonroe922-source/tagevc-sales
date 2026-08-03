import { requireCampaignAuth } from '@/lib/campaign/auth';
import { createAiAssistDraft } from '@/lib/campaign/intelligence';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    if (!auth.permissions.marketer) return jsonError('FORBIDDEN', 'Marketer role required', 403);
    const body = await readJson<{
      kind?: 'subject' | 'body' | 'rewrite';
      source_text?: string;
      tone?: 'professional' | 'warm' | 'direct' | 'executive';
      brand_voice?: string;
      campaign_id?: string;
      template_id?: string;
    }>(req);
    if (!body.source_text?.trim()) return jsonError('VALIDATION', 'source_text required');
    const result = await createAiAssistDraft(auth.entityId, auth.userId, {
      kind: body.kind,
      sourceText: body.source_text,
      tone: body.tone,
      brandVoice: body.brand_voice,
      campaignId: body.campaign_id,
      templateId: body.template_id,
    });
    return jsonOk({
      data: {
        ...result,
        auto_send_allowed: false,
      },
    }, 201);
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
