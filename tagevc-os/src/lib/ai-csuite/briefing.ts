/**
 * Auto-generated AI C-Suite briefings — structured executive cards on load.
 * Fail-soft: show even if persist fails; never invent KPIs.
 */

import { grokChatCompletion, xaiConfigured, XAI_SETUP_NOTE } from '@/lib/think-tank/llm';
import {
  buildBriefingSystemPrompt,
  buildHqBriefingSystemPrompt,
} from '@/lib/ai-csuite/prompts';
import {
  buildHqContext,
  buildRoleContext,
  type CsuiteContextPack,
} from '@/lib/ai-csuite/context';
import type { AiCsuiteNavRole, AiCsuiteRole } from '@/lib/ai-csuite/roles';
import { createClient } from '@/lib/supabase/server';

async function contextForRole(
  role: AiCsuiteNavRole,
  entityId?: string | null,
): Promise<CsuiteContextPack> {
  if (role === 'hq') return buildHqContext();
  return buildRoleContext(role as AiCsuiteRole, entityId);
}

export const CSUITE_BRIEFING_TTL_MS = 20 * 60 * 1000; // 20 minutes

export const CSUITE_HEALTH_STATUSES = ['green', 'watch', 'red'] as const;
export type CsuiteHealthStatus = (typeof CSUITE_HEALTH_STATUSES)[number];

export type CsuiteBriefing = {
  id: string | null;
  role: AiCsuiteNavRole;
  health_status: CsuiteHealthStatus;
  what_matters: string[];
  top_risk: string;
  primary_action: string;
  summary: string;
  /** CFO-only executive financial report (markdown). */
  financial_report_md: string | null;
  data_gaps: string[];
  as_of: string;
  source: 'live' | 'cached' | 'fallback';
  model: string | null;
  persisted: boolean;
  persist_hint: string | null;
  from_cache: boolean;
};

export type CsuiteBriefingShapeInput = {
  health_status?: unknown;
  what_matters?: unknown;
  top_risk?: unknown;
  primary_action?: unknown;
  summary?: unknown;
  executive_summary?: unknown;
  financial_report_md?: unknown;
  data_gaps?: unknown;
};

const SQL_APPLY_HINT =
  'Apply supabase/phase79_ai_csuite.sql so briefings persist across reloads.';

function isHealthStatus(v: unknown): v is CsuiteHealthStatus {
  return (
    typeof v === 'string' &&
    (CSUITE_HEALTH_STATUSES as readonly string[]).includes(v)
  );
}

/** Pure shape validation — used by generators and tests. */
export function validateCsuiteBriefingShape(
  raw: CsuiteBriefingShapeInput,
): {
  ok: boolean;
  health_status: CsuiteHealthStatus;
  what_matters: string[];
  top_risk: string;
  primary_action: string;
  summary: string;
  financial_report_md: string | null;
  data_gaps: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const health_status = isHealthStatus(raw.health_status)
    ? raw.health_status
    : 'watch';
  if (!isHealthStatus(raw.health_status)) {
    errors.push('health_status must be green|watch|red');
  }

  let what_matters: string[] = [];
  if (Array.isArray(raw.what_matters)) {
    what_matters = raw.what_matters
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, 3);
  } else {
    errors.push('what_matters must be an array of strings');
  }
  while (what_matters.length < 3) {
    what_matters.push('Partial data — no additional signal in pack');
  }

  const top_risk =
    typeof raw.top_risk === 'string' && raw.top_risk.trim()
      ? raw.top_risk.trim()
      : 'Insufficient live signals to name a top risk';
  if (typeof raw.top_risk !== 'string' || !raw.top_risk.trim()) {
    errors.push('top_risk required');
  }

  const primary_action =
    typeof raw.primary_action === 'string' && raw.primary_action.trim()
      ? raw.primary_action.trim()
      : 'Review available SSC facts and confirm next draft action with human gate';
  if (typeof raw.primary_action !== 'string' || !raw.primary_action.trim()) {
    errors.push('primary_action required');
  }

  const summaryRaw =
    (typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary
      : null) ??
    (typeof raw.executive_summary === 'string' && raw.executive_summary.trim()
      ? raw.executive_summary
      : null);
  const summary =
    summaryRaw?.trim() ||
    'Partial data mode — executive summary limited to known context.';
  if (!summaryRaw) errors.push('summary required');

  const financial_report_md =
    typeof raw.financial_report_md === 'string' &&
    raw.financial_report_md.trim()
      ? raw.financial_report_md.trim()
      : null;

  const data_gaps = Array.isArray(raw.data_gaps)
    ? raw.data_gaps
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

  return {
    ok: errors.length === 0,
    health_status,
    what_matters,
    top_risk,
    primary_action,
    summary,
    financial_report_md,
    data_gaps,
    errors,
  };
}

export function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function healthFromPack(pack: CsuiteContextPack): CsuiteHealthStatus {
  if (pack.anomalies.length >= 3) return 'red';
  if (pack.anomalies.length > 0 || pack.data_gaps.length > 2) return 'watch';
  const overdue = pack.overdue_tasks.some((t) => {
    const n = Number((t as { overdue?: unknown }).overdue ?? 0);
    return Number.isFinite(n) && n > 0;
  });
  if (overdue) return 'watch';
  return pack.kpis.some((k) => k.status === 'live') ? 'green' : 'watch';
}

function formatKpiLine(
  k: CsuiteContextPack['kpis'][number],
): string | null {
  if (k.status === 'missing' || k.value == null) return null;
  return `${k.label}: ${k.value} (${k.status})`;
}

/** Deterministic CFO report from pack facts only — never fabricates cash/runway. */
export function buildFallbackFinancialReportMd(
  pack: CsuiteContextPack,
): string {
  const gaps = pack.data_gaps;
  const iesGap = gaps.some((g) => /IES|cash|runway/i.test(g));
  const cashKpi = pack.kpis.find((k) => /cash/i.test(k.key + k.label));
  const runwayKpi = pack.kpis.find((k) => /runway/i.test(k.key + k.label));
  const closeKpi = pack.kpis.find((k) => /close|completion/i.test(k.key + k.label));

  const cashSection =
    cashKpi?.value != null && cashKpi.status !== 'missing'
      ? `- Cash signal: ${cashKpi.value} (${cashKpi.status})`
      : `- Cash / runway: **partial data**${iesGap ? ' — IES live feed not fully attached' : ''}. Do not treat any figure as authoritative until IES sync confirms.`;

  const runwaySection =
    runwayKpi?.value != null && runwayKpi.status !== 'missing'
      ? `- Runway signal: ${runwayKpi.value} (${runwayKpi.status})`
      : `- Runway: not available in this pack.`;

  const closeSection =
    closeKpi?.value != null
      ? `- Close / checklist: ${closeKpi.value}% completion (${closeKpi.status})`
      : `- Close posture: partial — finance checklist glance incomplete.`;

  const subLines =
    pack.subsidiaries.length === 0
      ? ['- No subsidiary signals in pack.']
      : pack.subsidiaries.map((s) => {
          const sig =
            s.signals.length > 0
              ? s.signals.join('; ')
              : 'no live financial signals';
          return `- ${s.name}: ${sig}`;
        });

  const anomalyLines =
    pack.anomalies.length === 0
      ? ['- None flagged in context pack.']
      : pack.anomalies.slice(0, 8).map((a) => {
          const kind = String((a as { kind?: unknown }).kind ?? 'anomaly');
          const title = String(
            (a as { title?: unknown }).title ??
              (a as { count?: unknown }).count ??
              '',
          );
          return `- ${kind}${title ? `: ${title}` : ''}`;
        });

  const overdueLines =
    pack.overdue_tasks.length === 0
      ? ['- No overdue finance SSC rows in pack.']
      : pack.overdue_tasks.slice(0, 8).map((t) => `- ${JSON.stringify(t)}`);

  const ticketLines =
    pack.open_tickets.length === 0
      ? ['- No open finance-tagged tickets in pack.']
      : pack.open_tickets.slice(0, 6).map((t) => {
          const title = String((t as { title?: unknown }).title ?? 'ticket');
          const company = String((t as { company?: unknown }).company ?? '');
          return `- ${title}${company ? ` (${company})` : ''}`;
        });

  return [
    '## Financial Report (partial — facts only)',
    '',
    '### Cash / runway / close posture',
    cashSection,
    runwaySection,
    closeSection,
    '',
    '### Subsidiary financial health',
    ...subLines,
    '',
    '### Anomalies & exceptions',
    ...anomalyLines,
    '',
    '### Overdue finance SSC work',
    ...overdueLines,
    '',
    '### Open finance tickets',
    ...ticketLines,
    '',
    '### Recommended next actions (draft-only — human confirm)',
    '- Review overdue finance SSC tasks and clear blockers.',
    '- Confirm IES connect/sync before quoting cash or runway.',
    '- Propose draft tickets/checklist notes only after Visionary confirm.',
    '',
    gaps.length
      ? `### Data gaps\n${gaps.map((g) => `- ${g}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildFallbackBriefing(
  role: AiCsuiteNavRole,
  pack: CsuiteContextPack,
  opts?: { model?: string | null; error?: string },
): CsuiteBriefing {
  const liveKpis = pack.kpis.map(formatKpiLine).filter(Boolean) as string[];
  const what_matters = [
    liveKpis[0] ?? 'Live KPIs limited — advise from SSC facts only',
    pack.anomalies.length
      ? `${pack.anomalies.length} anomaly signal(s) in pack`
      : 'No anomalies flagged in pack',
    pack.open_tickets.length
      ? `${pack.open_tickets.length} open ticket(s) in role pack`
      : 'No open tickets in role pack',
  ].slice(0, 3);

  const summaryParts = [
    `AI Analysis for ${role.toUpperCase()} in fallback mode.`,
    opts?.error ? `LLM unavailable: ${opts.error}` : null,
    !xaiConfigured() ? XAI_SETUP_NOTE : null,
    pack.data_gaps.length
      ? `Data gaps: ${pack.data_gaps.slice(0, 4).join('; ')}.`
      : 'Context pack loaded with limited signals.',
  ].filter(Boolean);

  return {
    id: null,
    role,
    health_status: healthFromPack(pack),
    what_matters,
    top_risk:
      pack.anomalies.length > 0
        ? `Anomaly pressure: ${String((pack.anomalies[0] as { kind?: string }).kind ?? 'see pack')}`
        : pack.data_gaps[0] ?? 'Missing feeds limit risk ranking',
    primary_action:
      'Draft a human-confirmable follow-up from known SSC facts; do not move money or invent KPIs',
    summary: summaryParts.join(' '),
    financial_report_md:
      role === 'cfo' ? buildFallbackFinancialReportMd(pack) : null,
    data_gaps: [...pack.data_gaps],
    as_of: pack.as_of,
    source: 'fallback',
    model: opts?.model ?? null,
    persisted: false,
    persist_hint: null,
    from_cache: false,
  };
}

/**
 * When data_gaps indicate missing cash/runway/IES, reject fabricated dollar
 * claims in financial_report_md that are not present as live KPI values.
 */
export function financialReportRespectsDataGaps(
  reportMd: string | null | undefined,
  pack: CsuiteContextPack,
): boolean {
  if (!reportMd) return true;
  const gapsMentionIes = pack.data_gaps.some((g) =>
    /IES|cash\/runway|cash\/runway live|not attached|not wired/i.test(g),
  );
  if (!gapsMentionIes) return true;

  const liveCashValues = pack.kpis
    .filter(
      (k) =>
        k.status === 'live' &&
        k.value != null &&
        /cash|runway/i.test(k.key + k.label),
    )
    .map((k) => String(k.value));

  // Dollar amounts like $1,234,567 or $1.2M — only OK if they match a live KPI string
  const dollarMatches = reportMd.match(/\$[\d,.]+(?:\s*[kKmMbB])?/g) ?? [];
  for (const d of dollarMatches) {
    const normalized = d.replace(/[$,\s]/g, '').toLowerCase();
    const ok = liveCashValues.some((v) => {
      const nv = String(v).replace(/[$,\s]/g, '').toLowerCase();
      return nv.includes(normalized) || normalized.includes(nv);
    });
    if (!ok) return false;
  }
  return true;
}

async function requireVisionaryId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'visionary') {
    throw new Error('C-Suite is Visionary-only');
  }
  return profile.id as string;
}

function rowToBriefing(
  row: Record<string, unknown>,
  role: AiCsuiteNavRole,
): CsuiteBriefing {
  const body = (row.body_json ?? {}) as Record<string, unknown>;
  const what = Array.isArray(row.what_matters)
    ? (row.what_matters as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .slice(0, 3)
    : [];
  const snap = (row.context_snapshot ?? {}) as Record<string, unknown>;
  const gaps = Array.isArray(snap.data_gaps)
    ? (snap.data_gaps as unknown[])
        .filter((x): x is string => typeof x === 'string')
    : [];
  return {
    id: row.id ? String(row.id) : null,
    role,
    health_status: isHealthStatus(row.health_status)
      ? row.health_status
      : 'watch',
    what_matters:
      what.length >= 3
        ? what
        : [
            ...what,
            ...Array(Math.max(0, 3 - what.length)).fill(
              'Partial data — no additional signal',
            ),
          ],
    top_risk: String(row.top_risk ?? ''),
    primary_action: String(row.primary_action ?? ''),
    summary:
      typeof body.summary === 'string'
        ? body.summary
        : String(row.body_md ?? '').slice(0, 800),
    financial_report_md:
      typeof body.financial_report_md === 'string'
        ? body.financial_report_md
        : null,
    data_gaps: gaps,
    as_of: String(row.as_of ?? new Date().toISOString()),
    source: 'cached',
    model: typeof body.model === 'string' ? body.model : null,
    persisted: true,
    persist_hint: null,
    from_cache: true,
  };
}

async function loadFreshCachedBriefing(
  role: AiCsuiteNavRole,
  entityId?: string | null,
): Promise<CsuiteBriefing | null> {
  try {
    const supabase = await createClient();
    const since = new Date(Date.now() - CSUITE_BRIEFING_TTL_MS).toISOString();
    let query = supabase
      .from('os_csuite_briefings')
      .select(
        'id, role, as_of, health_status, what_matters, top_risk, primary_action, body_md, body_json, context_snapshot',
      )
      .eq('role', role)
      .eq('period_type', 'on_demand')
      .eq('scope', entityId ? 'company' : 'consolidated')
      .gte('as_of', since)
      .order('as_of', { ascending: false })
      .limit(1);
    query = entityId
      ? query.eq('entity_id', entityId)
      : query.is('entity_id', null);
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return rowToBriefing(data as Record<string, unknown>, role);
  } catch {
    return null;
  }
}

async function persistBriefing(
  briefing: CsuiteBriefing,
  pack: CsuiteContextPack,
  visionaryId: string,
): Promise<{ id: string | null; hint: string | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('os_csuite_briefings')
      .insert({
        role: briefing.role,
        period_type: 'on_demand',
        as_of: briefing.as_of,
        scope: pack.scope,
        entity_id: pack.entity_id,
        health_status: briefing.health_status,
        what_matters: briefing.what_matters,
        top_risk: briefing.top_risk,
        primary_action: briefing.primary_action,
        body_md: [
          briefing.summary,
          briefing.financial_report_md
            ? `\n\n${briefing.financial_report_md}`
            : '',
        ].join(''),
        body_json: {
          summary: briefing.summary,
          financial_report_md: briefing.financial_report_md,
          model: briefing.model,
          source: briefing.source,
        },
        context_snapshot: {
          data_gaps: briefing.data_gaps,
          kpis: pack.kpis,
          anomaly_count: pack.anomalies.length,
        },
        created_by: visionaryId,
      })
      .select('id')
      .maybeSingle();
    if (error || !data) {
      return { id: null, hint: SQL_APPLY_HINT };
    }
    return { id: String(data.id), hint: null };
  } catch {
    return { id: null, hint: SQL_APPLY_HINT };
  }
}

export async function generateCsuiteBriefing(opts: {
  role: AiCsuiteNavRole;
  forceRefresh?: boolean;
  entityId?: string | null;
}): Promise<CsuiteBriefing> {
  const visionaryId = await requireVisionaryId();
  const role = opts.role;

  if (!opts.forceRefresh) {
    const cached = await loadFreshCachedBriefing(role, opts.entityId);
    if (cached) return cached;
  }

  const pack = await contextForRole(role, opts.entityId);
  const system =
    role === 'hq'
      ? buildHqBriefingSystemPrompt()
      : buildBriefingSystemPrompt(role);

  if (!xaiConfigured()) {
    const fallback = buildFallbackBriefing(role, pack, {
      error: XAI_SETUP_NOTE,
    });
    const persist = await persistBriefing(fallback, pack, visionaryId);
    return {
      ...fallback,
      id: persist.id,
      persisted: Boolean(persist.id),
      persist_hint: persist.hint,
    };
  }

  const userContent = `Context JSON (fail-soft; never invent KPIs):\n${JSON.stringify(pack)}\n\nReturn a single JSON object only.`;

  const llm = await grokChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    temperature: 0.25,
  });

  if (!llm.content) {
    const fallback = buildFallbackBriefing(role, pack, {
      model: llm.model,
      error: llm.error ?? 'Empty Grok response',
    });
    const persist = await persistBriefing(fallback, pack, visionaryId);
    return {
      ...fallback,
      id: persist.id,
      persisted: Boolean(persist.id),
      persist_hint: persist.hint,
    };
  }

  const parsed = extractJsonObject(llm.content);
  if (!parsed || typeof parsed !== 'object') {
    const fallback = buildFallbackBriefing(role, pack, {
      model: llm.model,
      error: 'Could not parse briefing JSON',
    });
    const persist = await persistBriefing(fallback, pack, visionaryId);
    return {
      ...fallback,
      id: persist.id,
      persisted: Boolean(persist.id),
      persist_hint: persist.hint,
    };
  }

  const shape = validateCsuiteBriefingShape(
    parsed as CsuiteBriefingShapeInput,
  );
  let financial_report_md =
    role === 'cfo'
      ? shape.financial_report_md ?? buildFallbackFinancialReportMd(pack)
      : null;

  if (
    role === 'cfo' &&
    !financialReportRespectsDataGaps(financial_report_md, pack)
  ) {
    financial_report_md = buildFallbackFinancialReportMd(pack);
  }

  const briefing: CsuiteBriefing = {
    id: null,
    role,
    health_status: shape.health_status,
    what_matters: shape.what_matters,
    top_risk: shape.top_risk,
    primary_action: shape.primary_action,
    summary: shape.summary,
    financial_report_md,
    data_gaps: [
      ...new Set([...(shape.data_gaps.length ? shape.data_gaps : pack.data_gaps)]),
    ],
    as_of: new Date().toISOString(),
    source: 'live',
    model: llm.model,
    persisted: false,
    persist_hint: null,
    from_cache: false,
  };

  const persist = await persistBriefing(briefing, pack, visionaryId);
  return {
    ...briefing,
    id: persist.id,
    persisted: Boolean(persist.id),
    persist_hint: persist.hint,
  };
}
