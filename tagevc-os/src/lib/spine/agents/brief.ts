/**
 * Account brief (C10) — structured markdown from graph fields.
 * No paid LLM required; optional OPENAI later.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

export async function generateAccountBrief(accountId: string): Promise<
  | { ok: true; markdown: string }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const { data: account, error } = await sb
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .maybeSingle();
    if (error || !account) {
      return { ok: false, error: error?.message || 'account not found' };
    }

    const { data: people } = await sb
      .from('employments')
      .select('title, contacts(full_name, primary_email, title)')
      .eq('account_id', accountId)
      .eq('is_current', true)
      .limit(25);

    const lines: string[] = [
      `# ${account.name}`,
      '',
      `- **Domain:** ${account.canonical_domain || '—'}`,
      `- **Industry:** ${account.industry || '—'}`,
      `- **Employees (enrich):** ${account.employee_count ?? '—'}`,
      `- **Enrich status:** ${account.enrich_status || '—'}`,
      `- **Last enriched:** ${account.last_enriched_at || 'never'}`,
      '',
      '## People (current)',
    ];

    for (const row of people ?? []) {
      const c = row.contacts as unknown as {
        full_name: string;
        primary_email: string | null;
        title: string | null;
      } | null;
      if (!c) continue;
      lines.push(
        `- ${c.full_name} — ${row.title || c.title || '—'} · ${c.primary_email || 'no email'}`,
      );
    }

    if (!(people ?? []).length) {
      lines.push('_No current employments yet._');
    }

    lines.push(
      '',
      '## Next actions',
      '- Refresh enrich / expand people when LIVE providers ready',
      '- Suggest hierarchy on account org chart',
      '- Open Cmd-K to jump to related contacts',
    );

    return { ok: true, markdown: lines.join('\n') };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'brief_failed',
    };
  }
}
