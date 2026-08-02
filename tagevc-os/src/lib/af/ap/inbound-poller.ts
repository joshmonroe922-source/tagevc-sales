/**
 * AP inbound poller seam — Graph list messages on host mailbox filtered by AP aliases.
 * Does not invent mailbox credentials; uses app-only Graph token when configured.
 */

import { getMsGraphAppToken } from '@/lib/platform-email/graph-app-token';
import {
  aliasAddressFor,
  M365_HOST_MAILBOX,
  resolveWorkflowFromAddress,
} from '@/lib/platform-email/m365-aliases';
import { resolveEntityFromInvoiceAddress } from '@/lib/af/ap/invoice-inbox';
import { createPersistClient } from '@/lib/supabase/persist-client';

export type ApInboundPollResult = {
  ok: boolean;
  scanned: number;
  ingested: number;
  skipped: number;
  error?: string;
};

function graphConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_SECRET?.trim(),
  );
}

/**
 * Poll host mailbox for unread messages To: AP / W-9 aliases.
 * Posts normalized rows into os_af_inbound_invoices when table exists.
 */
export async function pollApInboundMailbox(opts?: {
  top?: number;
}): Promise<ApInboundPollResult> {
  if (!graphConfigured()) {
    return {
      ok: false,
      scanned: 0,
      ingested: 0,
      skipped: 0,
      error:
        'MS Graph app credentials missing — set MS_GRAPH_TENANT_ID/CLIENT_ID/SECRET',
    };
  }

  try {
    const token = await getMsGraphAppToken();
    if (!token) {
      return {
        ok: false,
        scanned: 0,
        ingested: 0,
        skipped: 0,
        error: 'graph_token_failed',
      };
    }

    const host = M365_HOST_MAILBOX;
    const top = opts?.top ?? 25;
    const filter = encodeURIComponent('isRead eq false');
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(host)}/messages?$top=${top}&$filter=${filter}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return {
        ok: false,
        scanned: 0,
        ingested: 0,
        skipped: 0,
        error: `graph_http_${res.status}`,
      };
    }

    const json = (await res.json()) as {
      value?: Array<{
        id: string;
        subject?: string;
        bodyPreview?: string;
        receivedDateTime?: string;
        toRecipients?: Array<{ emailAddress?: { address?: string } }>;
        from?: { emailAddress?: { address?: string; name?: string } };
      }>;
    };

    const messages = json.value ?? [];
    let ingested = 0;
    let skipped = 0;
    const sb = await createPersistClient();
    const apAlias = aliasAddressFor('ap').toLowerCase();

    for (const m of messages) {
      const tos = (m.toRecipients ?? [])
        .map((t) => t.emailAddress?.address || '')
        .filter(Boolean);
      const matched = tos.find((a) => {
        const wf = resolveWorkflowFromAddress(a);
        return wf === 'ap' || a.toLowerCase() === apAlias;
      });
      if (!matched) {
        skipped += 1;
        continue;
      }

      const entity =
        resolveEntityFromInvoiceAddress(matched) ||
        resolveEntityFromInvoiceAddress(apAlias);
      const fromAddr = m.from?.emailAddress?.address || null;

      const { error } = await sb.from('os_af_inbound_invoices').upsert(
        {
          provider_message_id: m.id,
          entity_code: entity || 'TVC',
          to_address: matched,
          from_address: fromAddr,
          subject: m.subject || null,
          preview: m.bodyPreview || null,
          received_at: m.receivedDateTime || new Date().toISOString(),
          status: 'received',
          source: 'graph_poller',
        },
        { onConflict: 'provider_message_id' },
      );
      if (error) skipped += 1;
      else ingested += 1;
    }

    return {
      ok: true,
      scanned: messages.length,
      ingested,
      skipped,
    };
  } catch (e) {
    return {
      ok: false,
      scanned: 0,
      ingested: 0,
      skipped: 0,
      error: e instanceof Error ? e.message : 'poll_failed',
    };
  }
}
