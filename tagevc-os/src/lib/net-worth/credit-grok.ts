/**
 * Grok Credit Advisor — Visionary-only, FICO 8 / FICO 10 biased.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeAuditEvent } from '@/lib/audit/write';
import { grokChatCompletion, xaiConfigured } from '@/lib/think-tank/llm';
import { listBusinessCreditProfiles } from '@/lib/net-worth/credit';
import { getFirmAumSnapshot } from '@/lib/net-worth/assets';
import { loadDualPersonCreditBundle } from '@/lib/net-worth/personal-credit';
import { primaryFico10, primaryFico8 } from '@/lib/net-worth/credit-parse';
import type { CreditGrokMessageDto as CreditGrokMessage } from '@/lib/net-worth/credit-types';
import { FICO_REVIEW_STARTER } from '@/lib/net-worth/credit-grok-constants';

export type { CreditGrokMessage };
export { FICO_REVIEW_STARTER };

export function buildCreditAdvisorSystemPrompt(contextBlock: string): string {
  return [
    'You are Grok Credit Advisor for Tage VC Visionary (Josh Monroe).',
    'Audience: household personal credit for Josh Monroe and Lauren Monroe, plus Tage business credit.',
    '',
    'Scoring bias (mandatory):',
    '- Treat FICO Score 8 as the primary widely-used score today.',
    '- Treat FICO Score 10 as the forward-looking score to optimize toward.',
    '- Call out differences across Equifax / Experian / TransUnion when present.',
    '- Cover Auto and Bankcard industry scores when available.',
    '',
    'Analysis priorities (ranked levers):',
    '1) Utilization (per-card and aggregate)',
    '2) New hard inquiries',
    '3) Age of accounts / average age',
    '4) Negative items / collections / charge-offs',
    '5) Credit mix',
    '6) Timing of applications',
    '',
    'Output format:',
    '- Short executive summary',
    '- FICO 8 vs FICO 10 view per person',
    '- Ranked actions: Quick wins, then 30/60/90-day moves',
    '- Business credit notes for Tage + subsidiaries (DUNS / monitoring)',
    '',
    'Hard rules:',
    '- Educational only — not legal, credit-repair, or financial advice.',
    '- Do NOT file disputes or applications.',
    '- Do NOT invent scores. If a field is missing, say so.',
    '- Never discuss this content as if visible to non-Visionary roles.',
    '',
    'Current context (Visionary-only):',
    contextBlock,
  ].join('\n');
}

export async function assembleCreditAdvisorContext(): Promise<string> {
  const bundle = await loadDualPersonCreditBundle({ silent: true });
  const biz = await listBusinessCreditProfiles({ auditAccess: false });
  const aum = await getFirmAumSnapshot().catch(() => null);

  const lines: string[] = [];
  for (const key of ['josh_monroe', 'lauren_monroe'] as const) {
    const row = bundle.byPerson[key];
    if (!row) continue;
    const s = row.subject;
    const L = row.latest;
    lines.push(`## ${s.display_name} (${s.relationship})`);
    if (s.relationship === 'spouse') {
      lines.push(
        'Consent note: Household consent for personal financial management.',
      );
    }
    if (!L) {
      lines.push('No snapshots yet — needs guided myFICO or Experian import.');
      continue;
    }
    lines.push(
      `Latest: source=${L.source} bureau=${L.bureau} pulled=${L.pulled_at.slice(0, 10)} stale=${L.stale}`,
    );
    lines.push(
      `FICO 8=${primaryFico8(L.scores) ?? 'n/a'} · FICO 10=${primaryFico10(L.scores) ?? 'n/a'}`,
    );
    lines.push(
      `Auto 8=${L.scores.fico_auto_8 ?? 'n/a'} · Auto 10=${L.scores.fico_auto_10 ?? 'n/a'} · Bankcard 8=${L.scores.fico_bankcard_8 ?? 'n/a'} · Bankcard 10=${L.scores.fico_bankcard_10 ?? 'n/a'}`,
    );
    lines.push(
      `Per bureau FICO 8: EQ=${L.scores.equifax_fico_8 ?? 'n/a'} EX=${L.scores.experian_fico_8 ?? 'n/a'} TU=${L.scores.transunion_fico_8 ?? 'n/a'}`,
    );
    lines.push(
      `Per bureau FICO 10: EQ=${L.scores.equifax_fico_10 ?? 'n/a'} EX=${L.scores.experian_fico_10 ?? 'n/a'} TU=${L.scores.transunion_fico_10 ?? 'n/a'}`,
    );
    const sum = L.summary;
    lines.push(
      `Utilization=${sum.utilization_pct ?? 'n/a'}% · inquiries_12m=${sum.inquiries_12m ?? 'n/a'} · negatives=${sum.negative_items_count ?? 'n/a'} · collections=${sum.collections ?? 'n/a'}`,
    );
    if (row.scoreTrend8.length > 1) {
      lines.push(`FICO 8 trend: ${row.scoreTrend8.join(' → ')}`);
    }
    if (row.scoreTrend10.length > 1) {
      lines.push(`FICO 10 trend: ${row.scoreTrend10.join(' → ')}`);
    }
  }

  lines.push('## Business credit (Tage + subsidiaries)');
  for (const b of biz.rows) {
    lines.push(
      `${b.company_name}: DUNS=${b.duns_number ?? 'missing'} status=${b.duns_status} cadence=${b.monitoring_cadence} notes=${b.negative_notes || 'none'}`,
    );
  }

  // Phase 75: per-bureau business snapshots (D&B / Experian Business / Equifax Business)
  try {
    const { listBusinessBureauCompanies } = await import(
      '@/lib/net-worth/business-credit-bureaus'
    );
    const { BUSINESS_BUREAUS, BUSINESS_BUREAU_LABELS, primaryBusinessScore } =
      await import('@/lib/net-worth/business-credit-types');
    const { companies } = await listBusinessBureauCompanies();
    if (companies.length) {
      lines.push('## Business bureau snapshots (multi-bureau)');
      for (const c of companies) {
        const parts: string[] = [];
        for (const bureau of BUSINESS_BUREAUS) {
          const snap = c.byBureau[bureau];
          if (!snap) {
            parts.push(`${BUSINESS_BUREAU_LABELS[bureau]}: no data`);
            continue;
          }
          const p = primaryBusinessScore(bureau, snap.scores);
          parts.push(
            `${BUSINESS_BUREAU_LABELS[bureau]}: ${p.label}=${p.value ?? 'n/a'} pulled=${snap.pulled_at.slice(0, 10)}${snap.stale ? ' (stale)' : ''}${snap.summary.public_records ? ` public_records=${snap.summary.public_records}` : ''}`,
          );
        }
        lines.push(`${c.company_name} — ${parts.join(' · ')}`);
      }
    }
  } catch {
    /* fail-soft — advisor works without bureau tables */
  }

  if (aum) {
    lines.push(
      `## Firm AUM (excludes private I-quadrant): $${Math.round(aum.total).toLocaleString()} · ${aum.label}`,
    );
  }

  if (bundle.alerts.length) {
    lines.push('## Open personal credit alerts');
    for (const a of bundle.alerts.slice(0, 12)) {
      lines.push(`- ${a.title}`);
    }
  }

  return lines.join('\n');
}

export async function listCreditGrokMessages(
  limit = 40,
): Promise<CreditGrokMessage[]> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_personal_credit_grok_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(limit);
    return (data ?? [])
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        id: String(m.id),
        role: m.role as 'user' | 'assistant',
        content: String(m.content),
        model: (m.model as string) ?? null,
        created_at: String(m.created_at),
      }));
  } catch {
    return [];
  }
}

export async function sendCreditGrokMessage(input: {
  message: string;
  actorId: string | null;
}): Promise<
  | { ok: true; user: CreditGrokMessage; assistant: CreditGrokMessage }
  | { ok: false; error: string }
> {
  const enabled =
    process.env.PERSONAL_CREDIT_GROK_ENABLED !== '0' &&
    process.env.PERSONAL_CREDIT_GROK_ENABLED !== 'false';
  if (!enabled) {
    return { ok: false, error: 'PERSONAL_CREDIT_GROK_ENABLED is off' };
  }
  if (!xaiConfigured()) {
    return {
      ok: false,
      error: 'Set XAI_API_KEY (or GROK_API_KEY) for Grok Credit Advisor',
    };
  }

  const text = input.message.trim();
  if (text.length < 2) return { ok: false, error: 'Message required' };

  try {
    const sb = await createPersistClient();
    const context = await assembleCreditAdvisorContext();
    const system = buildCreditAdvisorSystemPrompt(context);

    const { data: userRow, error: userErr } = await sb
      .from('os_personal_credit_grok_messages')
      .insert({
        role: 'user',
        content: text.slice(0, 8000),
        created_by: input.actorId,
      })
      .select('*')
      .single();
    if (userErr || !userRow) {
      return { ok: false, error: userErr?.message ?? 'Could not save message' };
    }

    const history = await listCreditGrokMessages(20);
    const messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = [
      { role: 'system', content: system },
      ...history.slice(-12).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const result = await grokChatCompletion({ messages, temperature: 0.35 });
    if (!result.content) {
      return { ok: false, error: result.error ?? 'Empty Grok response' };
    }

    const { data: asst, error: asstErr } = await sb
      .from('os_personal_credit_grok_messages')
      .insert({
        role: 'assistant',
        content: result.content.slice(0, 16000),
        model: result.model,
        created_by: input.actorId,
      })
      .select('*')
      .single();
    if (asstErr || !asst) {
      return { ok: false, error: asstErr?.message ?? 'Could not save reply' };
    }

    await writeAuditEvent({
      action: 'credit_grok',
      title: 'Grok Credit Advisor turn',
      object_type: 'credit_grok',
      object_id: String(asst.id),
      metadata: { model: result.model, user_chars: text.length },
    });

    return {
      ok: true,
      user: {
        id: String(userRow.id),
        role: 'user',
        content: String(userRow.content),
        model: null,
        created_at: String(userRow.created_at),
      },
      assistant: {
        id: String(asst.id),
        role: 'assistant',
        content: String(asst.content),
        model: (asst.model as string) ?? null,
        created_at: String(asst.created_at),
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Grok failed',
    };
  }
}
