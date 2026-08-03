import { campaignDb } from '@/lib/campaign/db/client';
export async function getEccHome(entityId: string, userId: string, canViewTeam = false) {
  const sb = await campaignDb();
  const [campaigns, lists, templates, suppressions, pending, hot, domains] = await Promise.all([
    sb.from('ecc_campaigns').select('id', { count: 'exact', head: true }).eq('entity_id', entityId),
    sb.from('ecc_lists').select('id', { count: 'exact', head: true }).eq('entity_id', entityId),
    sb.from('ecc_templates').select('id', { count: 'exact', head: true }).eq('entity_id', entityId),
    sb.from('ecc_suppressions').select('id', { count: 'exact', head: true }).eq('entity_id', entityId),
    sb.from('ecc_campaigns').select('id, name, status').eq('entity_id', entityId).eq('status', 'pending_approval').limit(5),
    sb.from('ecc_campaign_recipients').select('contact_id, email, score, click_count, replied').order('score', { ascending: false }).limit(8),
    sb.from('ecc_sending_domains').select('domain, status').eq('entity_id', entityId),
  ]);
  const payload = {
    stats: {
      campaigns: campaigns.count ?? 0, lists: lists.count ?? 0,
      templates: templates.count ?? 0, suppressed: suppressions.count ?? 0,
    },
    needsApproval: pending.data ?? [],
    hotFollowUps: (hot.data ?? []).map((r) => ({
      contactId: r.contact_id, email: r.email, score: Number(r.score || 0),
      reason: Number(r.click_count) > 0 && !r.replied ? 'Clicked — no reply' : 'Engaged',
    })),
    deliverabilityAlerts: (domains.data ?? []).filter((d) => d.status !== 'verified').map((d) => ({
      kind: 'domain', message: `${d.domain} not verified`,
    })),
    teamPulse: canViewTeam ? { sends: 0, replies: 0, stuckSteps: 0 } : null,
  };
  await sb.from('ecc_command_center_cache').upsert({
    user_id: userId, entity_id: entityId, payload_json: payload, refreshed_at: new Date().toISOString(),
  });
  return payload;
}
