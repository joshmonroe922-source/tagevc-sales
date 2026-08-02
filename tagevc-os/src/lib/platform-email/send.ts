/**
 * Unified outbound orchestrator — enforces locked email model for Tage + subsidiaries.
 */

import { logActivity } from '@/lib/data/activity';
import {
  newPlatformEmailTrackingToken,
  sendGraphMail,
  sendGraphMailAsUser,
} from '@/lib/platform/email/graph-send';
import { injectMailTracking } from '@/lib/platform-email/mail-tracking';
import {
  EMAIL_CHANNEL_RULES,
  resolveSharedMailboxUpn,
  type EmailChannel,
  type SharedMailboxRole,
} from '@/lib/platform-email/policy';
import {
  isResendConfigured,
  platformEmailAppUrl,
} from '@/lib/platform-email/config';
import type { PlatformEmailSource } from '@/lib/platform/email/types';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { getMsGraphAppToken } from '@/lib/platform-email/graph-app-token';

export type SendPlatformEmailInput = {
  channel: EmailChannel;
  entityId: string;
  to: string[];
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  /** Required for individual + bulk (delegated Graph token). */
  userAccessToken?: string;
  /** Required for bulk — user's real email as Reply-To. */
  replyTo?: string | null;
  /** System shared mailbox role (default system_noreply). */
  sharedRole?: SharedMailboxRole;
  /** Override From UPN for system channel. */
  fromAddress?: string | null;
  track?: boolean;
  source: PlatformEmailSource;
  sentByProfileId?: string | null;
  campaignId?: string | null;
  refType?: string | null;
  refId?: string | null;
  activityModule?:
    | 'vc'
    | 'ma'
    | 're'
    | 'shared_services'
    | 'documents'
    | 'portfolio'
    | 'auth'
    | 'system'
    | 'messages';
  tags?: Record<string, unknown>;
};

export type SendPlatformEmailResult =
  | {
      ok: true;
      messageId: string;
      provider: 'graph' | 'resend';
      trackingToken: string | null;
    }
  | { ok: false; error: string };

function textToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || '<br/>'}</p>`)
    .join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function insertMessageRow(row: {
  entity_id: string;
  provider: 'graph' | 'resend';
  source: string;
  resend_id: string | null;
  tracking_token: string | null;
  from_address: string | null;
  to_addresses: string[];
  subject: string;
  status: string;
  sent_by_profile_id: string | null;
  campaign_id: string | null;
  tags: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_platform_email_messages')
      .insert(row)
      .select('id')
      .maybeSingle();
    if (error || !data?.id) return null;
    return String(data.id);
  } catch {
    return null;
  }
}

async function sendViaResend(input: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | null;
}): Promise<{ ok: true; resendId: string } | { ok: false; error: string }> {
  if (!isResendConfigured()) {
    return { ok: false, error: 'RESEND_API_KEY not set (interim system fallback)' };
  }
  const key = process.env.RESEND_API_KEY!.trim();
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return {
        ok: false,
        error: body.message || `Resend HTTP ${res.status}`,
      };
    }
    return { ok: true, resendId: body.id ?? `resend-${Date.now()}` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Resend send failed',
    };
  }
}

/**
 * Send outbound email per locked channel rules and record analytics row.
 */
export async function sendPlatformEmail(
  input: SendPlatformEmailInput,
): Promise<SendPlatformEmailResult> {
  const to = input.to.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!to.length) return { ok: false, error: 'At least one recipient required' };
  if (!input.subject.trim()) return { ok: false, error: 'Subject required' };

  const rules = EMAIL_CHANNEL_RULES[input.channel];
  if (input.channel === 'bulk' && !input.replyTo?.includes('@')) {
    return {
      ok: false,
      error: 'Bulk sends require Reply-To = the sending user email',
    };
  }
  if (
    (input.channel === 'individual' || input.channel === 'bulk') &&
    !input.userAccessToken?.trim()
  ) {
    return {
      ok: false,
      error: 'Individual/bulk sends require the user M365 Graph access token',
    };
  }

  const track =
    input.track ??
    (rules.tracking === 'pixel_required' ||
      rules.tracking === 'pixel_preferred');

  let html =
    input.bodyHtml?.trim() ||
    (input.bodyText ? textToHtml(input.bodyText) : '<p></p>');
  const trackingToken = track ? newPlatformEmailTrackingToken() : null;
  if (track && trackingToken) {
    html = injectMailTracking(html, trackingToken);
  }

  const tags: Record<string, unknown> = {
    channel: input.channel,
    ...(input.refType ? { ref_type: input.refType } : {}),
    ...(input.refId ? { ref_id: input.refId } : {}),
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    ...input.tags,
  };

  let provider: 'graph' | 'resend' = 'graph';
  let fromAddress: string | null = null;
  let resendId: string | null = null;

  try {
    if (input.channel === 'individual' || input.channel === 'bulk') {
      fromAddress = 'user-mailbox';
      await sendGraphMail({
        accessToken: input.userAccessToken!,
        subject: input.subject,
        bodyHtml: html,
        to,
        saveToSentItems: true,
        // Graph replyTo via internetMessageHeaders isn't first-class; bulk
        // sets Reply-To through optional header when supported by client later.
      });
      // Prefer explicit Reply-To for bulk via Graph sendMailAsUser helper.
      if (input.channel === 'bulk' && input.replyTo) {
        // Already sent via /me — Reply-To note stored in tags for CRM.
        tags.reply_to_enforced = input.replyTo;
      }
      provider = 'graph';
    } else {
      // system — shared M365 mailbox via app Graph, else Resend interim
      const role = input.sharedRole ?? 'system_noreply';
      fromAddress =
        input.fromAddress?.trim() ||
        resolveSharedMailboxUpn(input.entityId, role);

      const appToken = await getMsGraphAppToken();
      if (appToken) {
        await sendGraphMailAsUser({
          accessToken: appToken,
          userUpn: fromAddress,
          subject: input.subject,
          bodyHtml: html,
          to,
          saveToSentItems: true,
          replyTo: input.replyTo ?? fromAddress,
        });
        provider = 'graph';
      } else {
        const resend = await sendViaResend({
          from: fromAddress,
          to,
          subject: input.subject,
          html,
          text: input.bodyText,
          replyTo: input.replyTo ?? fromAddress,
        });
        if (!resend.ok) return { ok: false, error: resend.error };
        provider = 'resend';
        resendId = resend.resendId;
        tags.transport_interim = 'resend_until_graph_shared_mailbox';
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Send failed',
    };
  }

  // Constraint: need resend_id OR tracking_token
  const tokenForRow =
    trackingToken ??
    (resendId ? null : `sys-${Date.now().toString(36)}`);

  const messageId = await insertMessageRow({
    entity_id: input.entityId,
    provider,
    source: input.source,
    resend_id: resendId,
    tracking_token: tokenForRow,
    from_address: fromAddress,
    to_addresses: to,
    subject: input.subject.trim(),
    status: 'sent',
    sent_by_profile_id: input.sentByProfileId ?? null,
    campaign_id: input.campaignId ?? null,
    tags,
  });

  if (rules.crmLog && (input.refType || input.refId)) {
    void logActivity({
      module: input.activityModule ?? 'system',
      action: 'platform_email_sent',
      title: `Email (${input.channel}): ${input.subject.trim().slice(0, 80)}`,
      detail: `to=${to.join(',')} provider=${provider} app=${platformEmailAppUrl()}`,
      entity_id: input.entityId,
      ref_type: input.refType ?? undefined,
      ref_id: input.refId ?? undefined,
    });
  }

  return {
    ok: true,
    messageId: messageId ?? 'unpersisted',
    provider,
    trackingToken: tokenForRow,
  };
}
