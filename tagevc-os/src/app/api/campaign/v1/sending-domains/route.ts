import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

export async function GET() {
  try {
    const auth = await requireCampaignAuth();
    const sb = await campaignDb();
    const { data } = await sb
      .from('ecc_sending_domains')
      .select('*')
      .eq('entity_id', auth.entityId);
    return jsonOk({ data: data ?? [] });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireCampaignAuth();
    const body = await readJson<{ domain?: string; subdomain?: string }>(req);
    if (!body.domain) return jsonError('VALIDATION', 'domain required');
    const sb = await campaignDb();
    const domain = body.domain.trim().toLowerCase();
    const { data, error } = await sb
      .from('ecc_sending_domains')
      .insert({
        entity_id: auth.entityId,
        domain,
        subdomain: body.subdomain || 'mail',
        status: 'pending',
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return jsonOk({
      data,
      dns_records: [
        { type: 'TXT', host: domain, value: 'v=spf1 include:postal.tageplatform.com ~all' },
        { type: 'CNAME', host: `tage._domainkey.${domain}`, value: 'tage.dkim.tageplatform.com' },
        { type: 'TXT', host: `_dmarc.${domain}`, value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@tagevc.com' },
      ],
    }, 201);
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}
