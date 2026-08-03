import { randomBytes } from 'node:crypto';
import { campaignDb } from '@/lib/campaign/db/client';
import { getCampaign, resolveAudience, transitionCampaign } from '@/lib/campaign/db/repo';
import { getEntitySettings, isCampaignEnabled } from '@/lib/campaign/auth';
import { canSendMarketing } from '@/lib/campaign/core/consent';
import { buildComplianceFooter, injectFooter, marketingHeaders } from '@/lib/campaign/core/footer';
import { renderMergeTemplate } from '@/lib/campaign/core/merge';
import { scoreEngagement } from '@/lib/campaign/core/engagement';
import { resolveDeliveryPlane, submitOwnedMta } from '@/lib/campaign/mta';
import { platformEmailAppUrl } from '@/lib/platform-email/config';

export async function scheduleCampaignSend(input: {
  entityId: string; campaignId: string; actorId: string; replyTo: string; userAccessToken?: string | null; sendAt?: string | null;
}) {
  if (!(await isCampaignEnabled(input.entityId))) throw new Error('Campaign disabled or kill switch');
  const campaign = await getCampaign(input.entityId, input.campaignId);
  if (!campaign) throw new Error('Campaign not found');
  const contacts = await resolveAudience(input.entityId, campaign.audience_type, campaign.audience_id);
  const sb = await campaignDb();
  const { data: send, error } = await sb.from('ecc_sends').insert({
    campaign_id: campaign.id, entity_id: input.entityId, status: 'queued', planned_count: contacts.length,
    idempotency_key: `send:${campaign.id}:${Date.now()}`,
  }).select('*').single();
  if (error) throw new Error(error.message);
  const batchSize = 50;
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize).map((c) => c.id);
    await sb.from('ecc_send_jobs').insert({
      entity_id: input.entityId, send_id: send.id, campaign_id: campaign.id,
      batch_index: Math.floor(i / batchSize), contact_ids: batch, status: 'queued',
      idempotency_key: `send:${send.id}:batch:${Math.floor(i / batchSize)}`,
      scheduled_for: input.sendAt || new Date().toISOString(),
      reply_to: input.replyTo, user_access_token_ref: input.userAccessToken ? 'session' : null,
    });
  }
  // stash token on send metadata via first job — workers need token passed at process time
  await transitionCampaign(input.entityId, input.campaignId, 'sending', input.actorId);
  return { sendId: send.id, planned: contacts.length };
}

export async function processDueSendJobs(opts?: {
  limit?: number; userAccessToken?: string | null; replyTo?: string | null;
}) {
  const sb = await campaignDb();
  const { data: jobs } = await sb.from('ecc_send_jobs').select('*')
    .eq('status', 'queued').lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true }).limit(opts?.limit ?? 10);
  const results = [];
  for (const job of jobs ?? []) {
    const token = opts?.userAccessToken || null;
    const replyTo = opts?.replyTo || job.reply_to || '';
    await sb.from('ecc_send_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job.id);
    try {
      const r = await processJob(job, token, replyTo);
      results.push(r);
      await sb.from('ecc_send_jobs').update({ status: 'completed', finished_at: new Date().toISOString() }).eq('id', job.id);
    } catch (e) {
      await sb.from('ecc_send_jobs').update({
        status: 'failed', finished_at: new Date().toISOString(),
        error: e instanceof Error ? e.message.slice(0, 300) : 'failed',
      }).eq('id', job.id);
      results.push({ jobId: job.id, ok: false });
    }
  }
  return results;
}

async function processJob(job: any, userAccessToken: string | null, replyTo: string) {
  const sb = await campaignDb();
  const settings = await getEntitySettings(job.entity_id);
  const campaign = await getCampaign(job.entity_id, job.campaign_id);
  if (!campaign) throw new Error('campaign missing');
  const plane = resolveDeliveryPlane({ plane: campaign.delivery_plane, hasOwner: Boolean(campaign.owner_id) });
  const ids: string[] = job.contact_ids || [];
  const { data: contacts } = await sb.from('contacts')
    .select('id, primary_email, email_permission, lifecycle, first_name, last_name, full_name, title')
    .in('id', ids);
  let sent = 0, skipped = 0, errors = 0;
  const base = platformEmailAppUrl();
  for (const c of contacts ?? []) {
    if (!c.primary_email) { skipped++; continue; }
    const { data: supp } = await sb.from('ecc_suppressions').select('id').eq('entity_id', job.entity_id).eq('email_normalized', String(c.primary_email).toLowerCase()).maybeSingle();
    const { data: conv } = await sb.from('ecc_conversation_state').select('state').eq('contact_id', c.id).eq('entity_id', job.entity_id).maybeSingle();
    const gate = canSendMarketing({
      email: c.primary_email, permission: c.email_permission, suppressed: Boolean(supp), conversing: conv?.state === 'conversing',
    });
    if (!gate.allow) {
      skipped++;
      await sb.from('ecc_send_messages').insert({
        send_id: job.send_id, campaign_id: job.campaign_id, entity_id: job.entity_id,
        contact_id: c.id, email: c.primary_email, provider: plane === 'owned_mta' ? 'owned_mta' : 'graph',
        status: 'suppressed', skip_reason: gate.reason,
      });
      continue;
    }
    const token = randomBytes(18).toString('base64url');
    const unsub = `${base}/api/campaign/p/prefs/${token}`;
    const merge = renderMergeTemplate(String(campaign.body_html || ''), {
      contact: c as any, account: {}, owner: {}, system: { entity_name: job.entity_id, unsubscribe_url: unsub, preferences_url: unsub },
    });
    const subject = renderMergeTemplate(String(campaign.subject || ''), { contact: c as any, system: { entity_name: job.entity_id } }).html;
    let html = injectFooter(merge.html, buildComplianceFooter({
      physicalAddress: settings.physical_address || 'Tage Venture Capital — San Diego, CA',
      unsubUrl: unsub, prefsUrl: unsub, lifecycle: c.lifecycle, entityName: job.entity_id,
    }));
    const headers = marketingHeaders({
      unsubUrl: `${base}/api/campaign/p/unsub/one-click?token=${token}`,
      listId: `campaigns.${String(job.entity_id).toLowerCase()}.tageplatform`,
      campaignId: job.campaign_id, entityId: job.entity_id,
    });
    const { data: msg } = await sb.from('ecc_send_messages').insert({
      send_id: job.send_id, campaign_id: job.campaign_id, entity_id: job.entity_id,
      contact_id: c.id, email: c.primary_email, provider: plane === 'owned_mta' ? 'owned_mta' : 'graph',
      status: 'queued', subject_rendered: subject, tracking_token: token, metadata_json: { headers },
    }).select('id').single();
    try {
      const result = await submitOwnedMta({
        entityId: job.entity_id, to: c.primary_email, replyTo, subject, html,
        idempotencyKey: `msg:${msg?.id}`, userAccessToken,
        sentByProfileId: campaign.owner_id, campaignId: job.campaign_id,
        plane: plane === 'owned_mta' ? 'owned_mta' : 'controlled_graph',
      });
      if (!result.ok) throw new Error(result.error);
      await sb.from('ecc_send_messages').update({
        status: 'sent', provider_message_id: result.providerMessageId,
        tracking_token: ('trackingToken' in result && result.trackingToken) || token,
        sent_at: new Date().toISOString(),
      }).eq('id', msg!.id);
      await sb.from('ecc_campaign_recipients').upsert({
        campaign_id: job.campaign_id, contact_id: c.id, email: c.primary_email,
        sent_at: new Date().toISOString(), score: scoreEngagement({}), last_activity_at: new Date().toISOString(),
      });
      sent++;
    } catch (e) {
      errors++;
      await sb.from('ecc_send_messages').update({
        status: 'failed', skip_reason: e instanceof Error ? e.message.slice(0, 200) : 'failed',
      }).eq('id', msg!.id);
    }
  }
  await sb.from('ecc_sends').update({
    sent_count: sent, skipped_count: skipped, error_count: errors, status: 'completed', finished_at: new Date().toISOString(),
  }).eq('id', job.send_id);
  // if no more queued jobs, mark campaign sent
  const { count } = await sb.from('ecc_send_jobs').select('*', { count: 'exact', head: true }).eq('campaign_id', job.campaign_id).eq('status', 'queued');
  if (!count) {
    await sb.from('ecc_campaigns').update({
      status: 'sent', sent_at: new Date().toISOString(),
      stats_json: { sent, skipped, errors }, updated_at: new Date().toISOString(),
    }).eq('id', job.campaign_id);
  }
  return { jobId: job.id, sent, skipped, errors };
}
