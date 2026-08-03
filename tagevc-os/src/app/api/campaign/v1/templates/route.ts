import { requireCampaignAuth } from '@/lib/campaign/auth';
import { listTemplates } from '@/lib/campaign/db/repo';
import { DEFAULT_MERGE_FIELDS, renderMergeTemplate } from '@/lib/campaign/core/merge';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';
export async function GET(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    if (new URL(req.url).searchParams.get('merge_fields') === '1') {
      return jsonOk({ fields: DEFAULT_MERGE_FIELDS });
    }
    return jsonOk({ templates: await listTemplates(auth.entityId) });
  } catch (e) { return jsonError('UNAUTHORIZED', e instanceof Error ? e.message : 'Unauthorized', 401); }
}
export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    const body = await readJson(req);
    if (body.action === 'preview') {
      const ctx = {
        contact: { first_name: 'Alex', last_name: 'Rivera', full_name: 'Alex Rivera', primary_email: 'alex@example.com', title: 'VP Ops' },
        account: { name: 'Acme', canonical_domain: 'acme.com' },
        owner: { full_name: 'Josh Monroe', email: 'joshmonroe@tagevc.com' },
        system: { entity_name: auth.entityId },
      };
      const subject = renderMergeTemplate(String(body.subject || ''), ctx);
      const html = renderMergeTemplate(String(body.html || ''), ctx);
      return jsonOk({ subject: subject.html, html: html.html, missing_fields: [...subject.missing, ...html.missing] });
    }
    return jsonError('VALIDATION', 'Unknown action', 422);
  } catch (e) { return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400); }
}
