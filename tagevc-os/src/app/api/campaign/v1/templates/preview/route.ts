import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { getBrandKit } from '@/lib/campaign/db/repo';
import {
  buildComplianceFooter,
  injectFooter,
} from '@/lib/campaign/core/footer';
import { renderMergeTemplate } from '@/lib/campaign/core/merge';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    const body = await readJson<{
      contact_id?: string;
      subject?: string;
      html?: string;
    }>(req);
    const sb = await campaignDb();
    let contact: Record<string, unknown> = {
      first_name: 'Alex',
      last_name: 'Sample',
      full_name: 'Alex Sample',
      primary_email: 'alex@example.com',
      title: 'Operator',
      lifecycle: 'Active',
    };
    if (body.contact_id) {
      const { data } = await sb
        .from('contacts')
        .select('*')
        .eq('id', body.contact_id)
        .maybeSingle();
      if (data) contact = data as Record<string, unknown>;
    }
    const brand = await getBrandKit(auth.entityId);
    const ctx = {
      contact,
      account: {},
      owner: { full_name: 'You', email: 'you@example.com' },
      system: {
        unsubscribe_url: '#unsub',
        preferences_url: '#prefs',
        entity_name: auth.entityId,
        current_date: new Date().toISOString().slice(0, 10),
      },
    };
    const subject = renderMergeTemplate(body.subject || '', ctx);
    const bodyR = renderMergeTemplate(body.html || '', ctx);
    const footer = buildComplianceFooter({
      physicalAddress: brand?.physical_address || 'Address on file',
      unsubscribeUrl: '#unsub',
      preferencesUrl: '#prefs',
      lifecycle: String(contact.lifecycle || ''),
      entityName: auth.entityId,
    });
    return jsonOk({
      data: {
        subject: subject.rendered,
        html: injectFooter(bodyR.rendered, footer),
        missing_fields: [...subject.missing, ...bodyR.missing],
      },
    });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
