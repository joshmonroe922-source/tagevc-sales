/**
 * Personal (Visionary-only) + business credit management.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeAuditEvent } from '@/lib/audit/write';
import { entityDisplayName } from '@/lib/entities/display-name';

export type PersonalCreditProfile = {
  id: string;
  owner_profile_id: string;
  experian_score: number | null;
  equifax_score: number | null;
  transunion_score: number | null;
  score_as_of: string | null;
  source: 'manual' | 'connector';
  notes: string;
};

export type PersonalCreditItem = {
  id: string;
  profile_id: string;
  kind: 'open_item' | 'negative' | 'dispute' | 'inquiry' | 'other';
  bureau: 'experian' | 'equifax' | 'transunion' | 'other' | null;
  title: string;
  status: 'open' | 'in_progress' | 'resolved' | 'waived';
  amount: number | null;
  notes: string;
};

export type PersonalCreditAction = {
  id: string;
  profile_id: string;
  title: string;
  status: 'todo' | 'doing' | 'done' | 'skipped';
  sort_order: number;
  due_at: string | null;
  notes: string;
};

export type BusinessCreditProfile = {
  id: string;
  entity_id: string;
  company_name: string;
  duns_number: string | null;
  duns_status: 'unknown' | 'not_started' | 'pending' | 'active' | 'stale' | 'issue';
  dn_b_score: string | null;
  experian_biz_score: string | null;
  equifax_biz_score: string | null;
  report_as_of: string | null;
  monitoring_cadence: 'monthly' | 'quarterly' | 'annual';
  next_review_at: string | null;
  negative_notes: string;
  source: 'manual' | 'connector';
};

export type BusinessCreditChecklistItem = {
  id: string;
  entity_id: string;
  title: string;
  status: 'todo' | 'doing' | 'done' | 'skipped';
  due_at: string | null;
  notes: string;
};

async function auditCreditAccess(surface: string) {
  await writeAuditEvent({
    action: 'credit_access',
    title: `Credit Management access · ${surface}`,
    object_type: 'credit',
    object_id: surface,
    metadata: { surface },
  });
}

export async function getOrCreatePersonalCreditProfile(
  ownerProfileId: string,
): Promise<{ profile: PersonalCreditProfile | null; error?: string }> {
  try {
    const sb = await createPersistClient();
    const { data: existing } = await sb
      .from('os_personal_credit_profiles')
      .select('*')
      .eq('owner_profile_id', ownerProfileId)
      .maybeSingle();
    if (existing) {
      await auditCreditAccess('personal');
      return {
        profile: {
          id: String(existing.id),
          owner_profile_id: String(existing.owner_profile_id),
          experian_score:
            existing.experian_score === null
              ? null
              : Number(existing.experian_score),
          equifax_score:
            existing.equifax_score === null
              ? null
              : Number(existing.equifax_score),
          transunion_score:
            existing.transunion_score === null
              ? null
              : Number(existing.transunion_score),
          score_as_of: existing.score_as_of
            ? String(existing.score_as_of).slice(0, 10)
            : null,
          source: (existing.source as 'manual' | 'connector') || 'manual',
          notes: String(existing.notes ?? ''),
        },
      };
    }
    const { data, error } = await sb
      .from('os_personal_credit_profiles')
      .insert({ owner_profile_id: ownerProfileId })
      .select('*')
      .single();
    if (error || !data) {
      return { profile: null, error: error?.message ?? 'Create failed' };
    }
    await auditCreditAccess('personal');
    // Seed starter improvement checklist
    await sb.from('os_personal_credit_actions').insert([
      {
        profile_id: data.id,
        title: 'Pull all three bureau reports (manual this month)',
        sort_order: 10,
      },
      {
        profile_id: data.id,
        title: 'List negatives / collections and dispute status',
        sort_order: 20,
      },
      {
        profile_id: data.id,
        title: 'Autopay revolving cards; keep utilization under 30%',
        sort_order: 30,
      },
    ]);
    return {
      profile: {
        id: String(data.id),
        owner_profile_id: ownerProfileId,
        experian_score: null,
        equifax_score: null,
        transunion_score: null,
        score_as_of: null,
        source: 'manual',
        notes: '',
      },
    };
  } catch (e) {
    return {
      profile: null,
      error: e instanceof Error ? e.message : 'Personal credit failed',
    };
  }
}

export async function updatePersonalCreditScores(input: {
  profileId: string;
  experian_score?: number | null;
  equifax_score?: number | null;
  transunion_score?: number | null;
  score_as_of?: string | null;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { error } = await sb
      .from('os_personal_credit_profiles')
      .update({
        experian_score: input.experian_score ?? null,
        equifax_score: input.equifax_score ?? null,
        transunion_score: input.transunion_score ?? null,
        score_as_of: input.score_as_of ?? null,
        notes: input.notes ?? '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.profileId);
    if (error) return { ok: false, error: error.message };
    await writeAuditEvent({
      action: 'credit_update',
      title: 'Personal credit scores updated',
      object_type: 'personal_credit',
      object_id: input.profileId,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export async function listPersonalCreditItems(
  profileId: string,
): Promise<PersonalCreditItem[]> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_personal_credit_items')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });
    return (data ?? []).map((r) => ({
      id: String(r.id),
      profile_id: String(r.profile_id),
      kind: r.kind as PersonalCreditItem['kind'],
      bureau: (r.bureau as PersonalCreditItem['bureau']) ?? null,
      title: String(r.title),
      status: r.status as PersonalCreditItem['status'],
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
      notes: String(r.notes ?? ''),
    }));
  } catch {
    return [];
  }
}

export async function listPersonalCreditActions(
  profileId: string,
): Promise<PersonalCreditAction[]> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_personal_credit_actions')
      .select('*')
      .eq('profile_id', profileId)
      .order('sort_order', { ascending: true });
    return (data ?? []).map((r) => ({
      id: String(r.id),
      profile_id: String(r.profile_id),
      title: String(r.title),
      status: r.status as PersonalCreditAction['status'],
      sort_order: Number(r.sort_order ?? 0),
      due_at: r.due_at ? String(r.due_at).slice(0, 10) : null,
      notes: String(r.notes ?? ''),
    }));
  } catch {
    return [];
  }
}

export async function addPersonalCreditItem(input: {
  profileId: string;
  kind: PersonalCreditItem['kind'];
  title: string;
  bureau?: PersonalCreditItem['bureau'];
  amount?: number | null;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { error } = await sb.from('os_personal_credit_items').insert({
      profile_id: input.profileId,
      kind: input.kind,
      title: input.title.trim(),
      bureau: input.bureau ?? null,
      amount: input.amount ?? null,
      notes: input.notes ?? '',
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'failed' };
  }
}

export async function setPersonalCreditActionStatus(input: {
  actionId: string;
  status: PersonalCreditAction['status'];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { error } = await sb
      .from('os_personal_credit_actions')
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq('id', input.actionId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'failed' };
  }
}

/** Plain-language coaching only — not legal advice. */
export function personalCreditNextActions(input: {
  profile: PersonalCreditProfile;
  items: PersonalCreditItem[];
  actions: PersonalCreditAction[];
}): string[] {
  const tips: string[] = [];
  const scores = [
    input.profile.experian_score,
    input.profile.equifax_score,
    input.profile.transunion_score,
  ].filter((s): s is number => typeof s === 'number');
  if (scores.length === 0) {
    tips.push(
      'Add your latest Experian / Equifax / TransUnion scores (manual is fine). Connectors can come later.',
    );
  }
  const openNeg = input.items.filter(
    (i) =>
      ['negative', 'dispute', 'open_item'].includes(i.kind) &&
      ['open', 'in_progress'].includes(i.status),
  );
  if (openNeg.length > 0) {
    tips.push(
      `You have ${openNeg.length} open credit item(s). Prioritize disputes with documentation, then payment plans on valid balances.`,
    );
  }
  const todos = input.actions.filter((a) => a.status === 'todo');
  if (todos[0]) {
    tips.push(`Next checklist item: ${todos[0].title}`);
  }
  tips.push(
    'Coaching only — not legal, credit-repair, or financial advice. Confirm bureau rules before disputing.',
  );
  return tips.slice(0, 5);
}

export async function listBusinessCreditProfiles(opts?: {
  entityId?: string | null;
  parentPlusSubs?: boolean;
  auditAccess?: boolean;
}): Promise<{ rows: BusinessCreditProfile[]; error?: string }> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_business_credit_profiles')
      .select('*')
      .order('entity_id', { ascending: true });
    if (opts?.entityId && !opts.parentPlusSubs) {
      q = q.eq('entity_id', opts.entityId);
    }
    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };
    const rows = (data ?? []).map((r) => ({
      id: String(r.id),
      entity_id: String(r.entity_id),
      company_name: entityDisplayName(String(r.entity_id)),
      duns_number: (r.duns_number as string) ?? null,
      duns_status: r.duns_status as BusinessCreditProfile['duns_status'],
      dn_b_score: (r.dn_b_score as string) ?? null,
      experian_biz_score: (r.experian_biz_score as string) ?? null,
      equifax_biz_score: (r.equifax_biz_score as string) ?? null,
      report_as_of: r.report_as_of
        ? String(r.report_as_of).slice(0, 10)
        : null,
      monitoring_cadence:
        r.monitoring_cadence as BusinessCreditProfile['monitoring_cadence'],
      next_review_at: r.next_review_at
        ? String(r.next_review_at).slice(0, 10)
        : null,
      negative_notes: String(r.negative_notes ?? ''),
      source: (r.source as 'manual' | 'connector') || 'manual',
    }));
    if (opts?.auditAccess !== false) {
      await auditCreditAccess('business');
    }
    return { rows };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'Business credit list failed',
    };
  }
}

export function businessCreditAlerts(
  profiles: BusinessCreditProfile[],
): Array<{ entity_id: string; company_name: string; message: string }> {
  const alerts: Array<{
    entity_id: string;
    company_name: string;
    message: string;
  }> = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const p of profiles) {
    if (!p.duns_number || p.duns_status === 'not_started') {
      alerts.push({
        entity_id: p.entity_id,
        company_name: p.company_name,
        message: 'Missing or not-started DUNS — start early for app-store entities',
      });
    }
    if (p.duns_status === 'stale' || p.duns_status === 'issue') {
      alerts.push({
        entity_id: p.entity_id,
        company_name: p.company_name,
        message: `DUNS status: ${p.duns_status}`,
      });
    }
    if (p.next_review_at && p.next_review_at < today) {
      alerts.push({
        entity_id: p.entity_id,
        company_name: p.company_name,
        message: `Review overdue (due ${p.next_review_at})`,
      });
    }
    if (p.negative_notes.trim()) {
      alerts.push({
        entity_id: p.entity_id,
        company_name: p.company_name,
        message: 'Has negative notes on file',
      });
    }
  }
  return alerts;
}

export async function upsertBusinessCreditProfile(input: {
  entity_id: string;
  duns_number?: string | null;
  duns_status?: BusinessCreditProfile['duns_status'];
  dn_b_score?: string | null;
  experian_biz_score?: string | null;
  equifax_biz_score?: string | null;
  report_as_of?: string | null;
  monitoring_cadence?: BusinessCreditProfile['monitoring_cadence'];
  next_review_at?: string | null;
  negative_notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { error } = await sb.from('os_business_credit_profiles').upsert(
      {
        entity_id: input.entity_id,
        duns_number: input.duns_number ?? null,
        duns_status: input.duns_status ?? 'unknown',
        dn_b_score: input.dn_b_score ?? null,
        experian_biz_score: input.experian_biz_score ?? null,
        equifax_biz_score: input.equifax_biz_score ?? null,
        report_as_of: input.report_as_of ?? null,
        monitoring_cadence: input.monitoring_cadence ?? 'quarterly',
        next_review_at: input.next_review_at ?? null,
        negative_notes: input.negative_notes ?? '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'entity_id' },
    );
    if (error) return { ok: false, error: error.message };
    await writeAuditEvent({
      action: 'credit_update',
      title: `Business credit updated · ${entityDisplayName(input.entity_id)}`,
      object_type: 'business_credit',
      object_id: input.entity_id,
      entity_id: input.entity_id,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'failed' };
  }
}

export async function listBusinessCreditChecklist(
  entityId: string,
): Promise<BusinessCreditChecklistItem[]> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_business_credit_checklist')
      .select('*')
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true });
    return (data ?? []).map((r) => ({
      id: String(r.id),
      entity_id: String(r.entity_id),
      title: String(r.title),
      status: r.status as BusinessCreditChecklistItem['status'],
      due_at: r.due_at ? String(r.due_at).slice(0, 10) : null,
      notes: String(r.notes ?? ''),
    }));
  } catch {
    return [];
  }
}

/** Fail-soft D&B / bureau connector scaffold. */
export async function fetchBusinessCreditConnectorScaffold(entityId: string): Promise<{
  ok: false;
  skipped: true;
  detail: string;
}> {
  const enabled =
    process.env.DNB_API_ENABLED === '1' || process.env.DNB_API_ENABLED === 'true';
  if (!enabled || !process.env.DNB_API_KEY) {
    return {
      ok: false,
      skipped: true,
      detail: `D&B connector not configured for ${entityDisplayName(entityId)}. Set DNB_API_ENABLED=1 and DNB_API_KEY when ready. No fake scores.`,
    };
  }
  return {
    ok: false,
    skipped: true,
    detail: 'D&B live fetch scaffold — wire endpoint when credentials verified.',
  };
}
