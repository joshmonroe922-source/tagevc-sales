/**
 * Send orchestrator — approve → materialize → consent filter → batch send.
 * Bulk plane: Graph controlled send (Reply-To user + tracking) per locked model.
 * Owned MTA when ECC_POSTAL_* configured and plane=owned_mta.
 */

import { randomBytes } from 'node:crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { canSendMarketing } from '@/lib/campaign/consent';
import { getEntitySettings, isCampaignEnabled } from '@/lib/campaign/flags';
import {
  buildComplianceFooter,
  buildMarketingHeaders,
  injectComplianceFooter,
} from '@/lib/campaign/footer';
import { renderMergeTemplate, type MergeContext } from '@/lib/campaign/merge';
import { computeEngagementScore } from '@/lib/campaign/engagement';
import { getOwnedMtaAdapter, resolveDeliveryPlane } from '@/lib/campaign/mta';
import { sendPlatformEmail } from '@/lib/platform-email/send';
import { platformEmailAppUrl } from '@/lib/platform-email/config';

function trackingToken(): string {
  return randomBytes(18).toString('base64url');
}

export async function transitionCampaign(input: {
  campaignId: string;
  entityId: string;
  actorId: string;
  to: string;
  comment?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data: camp } = await sb
    .from('ecc_campaigns')
    .select('id, status, entity_id')
    .eq('id', input.campaignId)
    .maybeSingle();
  if (!camp || camp.entity_id !== input.entityId) {
    return { ok: false, error: 'Campaign not found' };
  }

  const from = String(camp.status);
  await sb
    .from('ecc_campaigns')
    .update({
      status: input.to,
      approval_state: input.to,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.campaignId);

  await sb.from('ecc_campaign_approvals').insert({
    campaign_id: input.campaignId,
    from_state: from,
    to_state: input.to,
    actor_id: input.actorId,
    comment: input.comment ?? null,
  });

  await sb.from('ecc_audit_log').insert({
    entity_id: input.entityId,
    actor_id: input.actorId,
    action: `campaign.${input.to}`,
    object_type: 'campaign',
    object_id: input.campaignId,
    before_json: { status: from },
    after_json: { status: input.to },
  });

  return { ok: true };
}

async function resolveAudienceContactIds(input: {
  entityId: string;
  audienceType: string | null;
  audienceId: string | null;
}): Promise<Array<{ contactId: string; email: string }>> {
  const sb = await createPersistClient({ mode: 'service' });
  if (input.audienceType === 'list' && input.audienceId) {
    const { data: members } = await sb
      .from('ecc_list_members')
      .select('contact_id')
      .eq('list_id', input.audienceId);
    const ids = (members ?? []).map((m) => String(m.contact_id));
    if (!ids.length) return [];
    const { data: contacts } = await sb
      .from('contacts')
      .select('id, primary_email')
      .in('id', ids);
    return (contacts ?? [])
      .filter((c) => c.primary_email)
      .map((c) => ({
        contactId: String(c.id),
        email: String(c.primary_email),
      }));
  }
  if (input.audienceType === 'segment' && input.audienceId) {
    const { data: members } = await sb
      .from('ecc_segment_members')
      .select('contact_id')
      .eq('segment_id', input.audienceId)
      .is('exited_at', null);
    const ids = (members ?? []).map((m) => String(m.contact_id));
    if (!ids.length) return [];
    const { data: contacts } = await sb
      .from('contacts')
      .select('id, primary_email')
      .in('id', ids);
    return (contacts ?? [])
      .filter((c) => c.primary_email)
      .map((c) => ({
        contactId: String(c.id),
        email: String(c.primary_email),
      }));
  }
  return [];
}

export async function executeCampaignSend(input: {
  campaignId: string;
  entityId: string;
  actorId: string;
  userAccessToken?: string;
  replyTo?: string;
  batchSize?: number;
}): Promise<
  | {
      ok: true;
      sendId: string;
      planned: number;
      sent: number;
      skipped: number;
      errors: number;
    }
  | { ok: false; error: string }
> {
  if (!(await isCampaignEnabled(input.entityId))) {
    return { ok: false, error: 'Campaign module disabled or kill switch on' };
  }

  const settings = await getEntitySettings(input.entityId);
  if (settings.kill_switch) {
    return { ok: false, error: 'Kill switch active' };
  }

  const sb = await createPersistClient({ mode: 'service' });
  const { data: camp } = await sb
    .from('ecc_campaigns')
    .select('*')
    .eq('id', input.campaignId)
    .maybeSingle();
  if (!camp || camp.entity_id !== input.entityId) {
    return { ok: false, error: 'Campaign not found' };
  }
  if (!['approved', 'scheduled', 'sending'].includes(String(camp.status))) {
    return { ok: false, error: 'Campaign must be approved/scheduled to send' };
  }

  const recipients = await resolveAudienceContactIds({
    entityId: input.entityId,
    audienceType: camp.audience_type,
    audienceId: camp.audience_id,
  });

  const { data: sendRow, error: sendErr } = await sb
    .from('ecc_sends')
    .insert({
      campaign_id: input.campaignId,
      entity_id: input.entityId,
      status: 'running',
      planned_count: recipients.length,
    })
    .select('id')
    .single();
  if (sendErr || !sendRow) {
    return { ok: false, error: sendErr?.message || 'send row failed' };
  }

  await sb
    .from('ecc_campaigns')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', input.campaignId);

  const plane = resolveDeliveryPlane({
    plane: (camp.delivery_plane as 'graph' | 'owned_mta' | 'auto') || 'auto',
    sequenceType: camp.campaign_type,
    hasOwner: Boolean(camp.owner_id),
  });

  const baseUrl = platformEmailAppUrl();
  const brandAddress =
    settings.physical_address ||
    'Tage Venture Capital — San Diego, CA';

  let sent = 0;
  let skipped = 0;
  let errors = 0;
  const batchSize = input.batchSize ?? 50;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    for (const recip of batch) {
      const gate = await canSendMarketing({
        entityId: input.entityId,
        contactId: recip.contactId,
        email: recip.email,
      });
      if (!gate.allow) {
        skipped += 1;
        await sb.from('ecc_send_messages').insert({
          send_id: sendRow.id,
          campaign_id: input.campaignId,
          entity_id: input.entityId,
          contact_id: recip.contactId,
          email: recip.email,
          provider: plane,
          status: 'suppressed',
          skip_reason: gate.reason,
        });
        continue;
      }

      const token = trackingToken();
      const unsubUrl = `${baseUrl}/api/campaign/p/prefs/${token}`;
      const prefsUrl = unsubUrl;

      const { data: contact } = await sb
        .from('contacts')
        .select(
          'id, first_name, last_name, full_name, primary_email, title, lifecycle',
        )
        .eq('id', recip.contactId)
        .maybeSingle();

      const mergeCtx: MergeContext = {
        contact: (contact as Record<string, unknown>) ?? {},
        account: {},
        owner: {},
        system: {
          entity_name: input.entityId,
          unsubscribe_url: unsubUrl,
          preferences_url: prefsUrl,
        },
      };

      const subjectRendered = renderMergeTemplate(
        String(camp.subject || ''),
        mergeCtx,
      ).rendered;
      let body = renderMergeTemplate(
        String(camp.body_html || ''),
        mergeCtx,
      ).rendered;
      const footer = buildComplianceFooter({
        physicalAddress: brandAddress,
        unsubUrl,
        prefsUrl,
        lifecycle: contact?.lifecycle,
        entityName: input.entityId,
      });
      body = injectComplianceFooter(body, footer);

      const headers = buildMarketingHeaders({
        unsubUrl: `${baseUrl}/api/campaign/p/unsub/one-click`,
        listId: `campaigns.${input.entityId.toLowerCase()}.tageplatform`,
        campaignId: input.campaignId,
        entityId: input.entityId,
      });

      const { data: msgRow } = await sb
        .from('ecc_send_messages')
        .insert({
          send_id: sendRow.id,
          campaign_id: input.campaignId,
          entity_id: input.entityId,
          contact_id: recip.contactId,
          email: recip.email,
          provider: plane,
          status: 'queued',
          subject_rendered: subjectRendered,
          tracking_token: token,
          metadata_json: { headers },
        })
        .select('id')
        .single();

      try {
        if (plane === 'owned_mta' && process.env.ECC_POSTAL_API_URL) {
          const mta = getOwnedMtaAdapter();
          const result = await mta.submit({
            idempotencyKey: `send:${sendRow.id}:${recip.contactId}`,
            entityId: input.entityId,
            from: {
              name: 'Campaigns',
              email: `news@mail.${input.entityId.toLowerCase()}.local`,
            },
            replyTo: input.replyTo ?? null,
            envelopeTo: [recip.email],
            subject: subjectRendered,
            html: body,
            headers,
          });
          if (!result.ok) throw new Error(result.error);
          await sb
            .from('ecc_send_messages')
            .update({
              status: 'sent',
              provider_message_id: result.providerMessageId,
              sent_at: new Date().toISOString(),
            })
            .eq('id', msgRow!.id);
        } else {
          if (!input.userAccessToken) {
            throw new Error('userAccessToken required for Graph bulk plane');
          }
          const result = await sendPlatformEmail({
            channel: 'bulk',
            entityId: input.entityId,
            to: [recip.email],
            subject: subjectRendered,
            bodyHtml: body,
            userAccessToken: input.userAccessToken,
            replyTo: input.replyTo,
            track: true,
            source: 'ecc_campaign',
            sentByProfileId: input.actorId,
            campaignId: input.campaignId,
            refType: 'ecc_campaign',
            refId: input.campaignId,
            activityModule: 'shared_services',
            tags: {
              ecc_send_message_id: msgRow?.id,
              ecc_campaign_id: input.campaignId,
            },
          });
          if (!result.ok) throw new Error(result.error);
          await sb
            .from('ecc_send_messages')
            .update({
              status: 'sent',
              provider_message_id: result.messageId,
              platform_message_id: result.messageId,
              tracking_token: result.trackingToken || token,
              sent_at: new Date().toISOString(),
            })
            .eq('id', msgRow!.id);
        }

        const score = computeEngagementScore({});
        await sb.from('ecc_campaign_recipients').upsert({
          campaign_id: input.campaignId,
          contact_id: recip.contactId,
          email: recip.email,
          sent_at: new Date().toISOString(),
          score,
          last_activity_at: new Date().toISOString(),
        });
        sent += 1;
      } catch (e) {
        errors += 1;
        await sb
          .from('ecc_send_messages')
          .update({
            status: 'failed',
            skip_reason:
              e instanceof Error ? e.message.slice(0, 200) : 'send_failed',
          })
          .eq('id', msgRow!.id);
      }
    }
  }

  await sb
    .from('ecc_sends')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      sent_count: sent,
      skipped_count: skipped,
      error_count: errors,
    })
    .eq('id', sendRow.id);

  await sb
    .from('ecc_campaigns')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      stats_json: { sent, skipped, errors, planned: recipients.length },
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.campaignId);

  return {
    ok: true,
    sendId: String(sendRow.id),
    planned: recipients.length,
    sent,
    skipped,
    errors,
  };
}
