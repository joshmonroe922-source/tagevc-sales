import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import type { ResendTag } from './email.ts';

export type RecordOutboundEmailInput = {
  resendId: string;
  to: string | string[];
  subject: string;
  source: string;
  leadId?: string | null;
  replyTo?: string | null;
  fromAddress?: string | null;
  tags?: ResendTag[] | Record<string, string>;
  sentBy?: string | null;
  status?: string;
};

function tagsToObject(
  tags?: ResendTag[] | Record<string, string>,
): Record<string, string> {
  if (!tags) return {};
  if (Array.isArray(tags)) {
    return Object.fromEntries(tags.map((t) => [t.name, t.value]));
  }
  return { ...tags };
}

export async function recordOutboundEmail(
  supabase: SupabaseClient,
  input: RecordOutboundEmailInput,
): Promise<string | null> {
  const to = (Array.isArray(input.to) ? input.to : [input.to])
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const from =
    input.fromAddress ??
    Deno.env.get('RESEND_FROM_EMAIL') ??
    'Tage Venture Capital <hello@tagevc.com>';

  const { data, error } = await supabase
    .from('sales_email_messages')
    .upsert(
      {
        resend_id: input.resendId,
        lead_id: input.leadId ?? null,
        source: input.source,
        from_address: from,
        to_addresses: to,
        subject: input.subject,
        reply_to: input.replyTo ?? null,
        tags: tagsToObject(input.tags),
        status: input.status ?? 'sent',
        sent_by: input.sentBy ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'resend_id' },
    )
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('recordOutboundEmail failed', error);
    return null;
  }
  return data?.id ?? null;
}
