/**
 * Site research agent scaffold (C9) — public website meta only (no scraping auth).
 * Enqueues suggested contact creates; never auto-writes locked fields.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

export async function runSiteResearch(accountId: string): Promise<
  | { ok: true; suggestions: number; title: string | null }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const { data: account } = await sb
      .from('accounts')
      .select('id, website, canonical_domain, name')
      .eq('id', accountId)
      .maybeSingle();
    if (!account) return { ok: false, error: 'account not found' };

    const url =
      account.website ||
      (account.canonical_domain
        ? `https://${account.canonical_domain}`
        : null);
    if (!url) return { ok: false, error: 'no website/domain' };

    let title: string | null = null;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'TageOS-SiteResearch/1.0' },
      });
      if (res.ok) {
        const html = (await res.text()).slice(0, 80_000);
        const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        title = m?.[1]?.trim().slice(0, 200) || null;
      }
    } catch {
      /* soft */
    }

    const { data: link } = await sb
      .from('account_org_links')
      .select('org_id')
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle();

    let suggestions = 0;
    if (link?.org_id && title) {
      const { error } = await sb.from('suggested_updates').insert({
        org_id: link.org_id,
        entity_type: 'account',
        entity_id: accountId,
        field_name: 'description',
        suggested_value: `Site title: ${title}`,
        confidence: 0.4,
        status: 'pending',
        rationale: 'agent.site_research public fetch',
      });
      if (!error) suggestions = 1;
    }

    if (link?.org_id) {
      await sb.from('enrichment_jobs').insert({
        org_id: link.org_id,
        type: 'account.site_research',
        payload: { account_id: accountId, url, title },
        idempotency_key: `account.site_research:${accountId}:${new Date().toISOString().slice(0, 10)}`,
        account_id: accountId,
        status: 'succeeded',
        progress_pct: 100,
        progress_message: title || 'no title',
        finished_at: new Date().toISOString(),
      });
    }

    return { ok: true, suggestions, title };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'site_research_failed',
    };
  }
}
