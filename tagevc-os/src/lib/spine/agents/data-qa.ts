/**
 * agent.data_qa — flag stale freshness + missing emails (no paid calls).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createPersistClient } from '../../supabase/persist-client';

export type DataQaFinding = {
  entity_type: 'account' | 'contact';
  entity_id: string;
  issue: 'stale' | 'missing_email' | 'unverified_email';
  detail: string;
};

export type DataQaFlag = {
  kind: string;
  entity_type: string;
  entity_id: string;
  detail: string;
};

const STALE_DAYS = 90;

/** Light in-process QA pass for cron responses (report-only). */
export async function runDataQaPass(
  sb: SupabaseClient,
  orgId: string,
  opts?: { limit?: number },
): Promise<{ flags: DataQaFlag[] }> {
  const limit = opts?.limit ?? 20;
  const cutoff = new Date(
    Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const flags: DataQaFlag[] = [];

  const { data: links } = await sb
    .from('account_org_links')
    .select('account_id')
    .eq('org_id', orgId)
    .limit(200);
  const accountIds = (links ?? []).map((l) => String(l.account_id));
  if (accountIds.length) {
    const { data: accounts } = await sb
      .from('accounts')
      .select('id, name, last_enriched_at')
      .in('id', accountIds)
      .or(`last_enriched_at.is.null,last_enriched_at.lt.${cutoff}`)
      .limit(limit);
    for (const a of accounts ?? []) {
      flags.push({
        kind: 'stale',
        entity_type: 'account',
        entity_id: a.id,
        detail: `${a.name}: last_enriched_at=${a.last_enriched_at ?? 'null'}`,
      });
    }
  }

  const { data: cLinks } = await sb
    .from('contact_org_links')
    .select('contact_id')
    .eq('org_id', orgId)
    .limit(200);
  const contactIds = (cLinks ?? []).map((l) => String(l.contact_id));
  if (contactIds.length) {
    const { data: contacts } = await sb
      .from('contacts')
      .select('id, full_name, primary_email, last_enriched_at')
      .in('id', contactIds)
      .limit(limit * 2);
    for (const c of contacts ?? []) {
      if (!c.primary_email) {
        flags.push({
          kind: 'missing_email',
          entity_type: 'contact',
          entity_id: c.id,
          detail: `${c.full_name}: no primary_email`,
        });
      }
      if (
        !c.last_enriched_at ||
        new Date(c.last_enriched_at).getTime() < new Date(cutoff).getTime()
      ) {
        flags.push({
          kind: 'stale',
          entity_type: 'contact',
          entity_id: c.id,
          detail: `${c.full_name}: stale`,
        });
      }
    }
  }

  return { flags: flags.slice(0, limit) };
}

export async function runDataQa(input?: {
  orgId?: string;
  limit?: number;
}): Promise<
  | { ok: true; findings: DataQaFinding[]; enqueued: number }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient({ mode: 'service' });
    if (!input?.orgId) {
      return { ok: true, findings: [], enqueued: 0 };
    }
    const report = await runDataQaPass(sb, input.orgId, {
      limit: input.limit ?? 50,
    });
    const findings: DataQaFinding[] = report.flags.map((f) => ({
      entity_type: f.entity_type as 'account' | 'contact',
      entity_id: f.entity_id,
      issue: f.kind as DataQaFinding['issue'],
      detail: f.detail,
    }));

    let enqueued = 0;
    const day = new Date().toISOString().slice(0, 10);
    for (const f of findings.filter((x) => x.issue === 'stale').slice(0, 25)) {
      const type =
        f.entity_type === 'account'
          ? 'account.refresh_stale'
          : 'contact.refresh_stale';
      const key = `${type}:${f.entity_id}:${day}`;
      const row: Record<string, unknown> = {
        org_id: input.orgId,
        type,
        payload: {
          [`${f.entity_type}_id`]: f.entity_id,
          source: 'agent.data_qa',
        },
        idempotency_key: key,
        status: 'queued',
      };
      if (f.entity_type === 'account') row.account_id = f.entity_id;
      else row.contact_id = f.entity_id;
      const { error } = await sb
        .from('enrichment_jobs')
        .upsert(row, { onConflict: 'idempotency_key' });
      if (!error) enqueued += 1;
    }

    return { ok: true, findings, enqueued };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'data_qa failed',
    };
  }
}
