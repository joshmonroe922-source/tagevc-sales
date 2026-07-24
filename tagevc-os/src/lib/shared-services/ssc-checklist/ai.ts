/**
 * SSC AI assistance — rule-based baseline + optional OpenAI enrichment (draft only).
 * No autonomous money movement, legal send/sign, or destructive access revocation.
 */

import {
  functionLabel,
  statusLabel,
  type SscAiBriefing,
  type SscChecklistTaskRow,
  type SscMonitoringSummary,
} from './types';

const GUARDRAILS = [
  'No autonomous money movement',
  'No unsupervised legal send/sign',
  'No destructive access revocation beyond approved flows',
  'Human approval required on high-risk actions',
];

export function buildSscAiBriefing(input: {
  tasks: SscChecklistTaskRow[];
  monitoring: SscMonitoringSummary[];
  periodLabel: string;
  functionFilter: string;
}): SscAiBriefing {
  const open = input.tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'waived',
  );
  const overdue = open.filter((t) => t.is_overdue);
  const blocked = open.filter((t) => t.status === 'blocked');
  const critical = open.filter(
    (t) => t.risk_level === 'critical' || t.risk_level === 'high',
  );

  const ordered = [...open].sort((a, b) => {
    const riskRank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
    const aR = riskRank[a.risk_level];
    const bR = riskRank[b.risk_level];
    if (aR !== bR) return aR - bR;
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
    return (a.due_date ?? '').localeCompare(b.due_date ?? '');
  });

  const recommended_order = ordered.slice(0, 8).map((t) => {
    const flag = t.is_overdue ? 'OVERDUE · ' : '';
    return `${flag}${t.title} (${t.company_name}) — ${statusLabel(t.status)}`;
  });

  const next_actions = ordered.slice(0, 5).map((t) => {
    if (t.status === 'blocked') {
      return `Unblock “${t.title}” for ${t.company_name}: add evidence or escalate ticket.`;
    }
    if (t.is_overdue) {
      return `Complete overdue “${t.title}” (${t.company_name}) or waive with note.`;
    }
    return `Start “${t.title}” for ${t.company_name}; attach ticket/doc evidence when done.`;
  });

  const firm = input.monitoring.find((m) => m.function_key === 'all');
  const pct = firm?.completion_pct ?? 0;
  const summary = [
    `${functionLabel(input.functionFilter as 'all')} · ${input.periodLabel}: ${open.length} open task(s), ${overdue.length} overdue, ${blocked.length} blocked.`,
    critical.length
      ? `${critical.length} high/critical-risk item(s) need human attention first.`
      : 'No critical-risk open items in this view.',
    `Firm completion ~${pct}%.`,
  ].join(' ');

  const impact =
    overdue.length > 0
      ? 'Overdue SSC work raises close, access, compliance, and brand risk across parent and subsidiaries. Prioritize critical/high items before period end.'
      : blocked.length > 0
        ? 'Blocked items stall period readiness; clear blockers with evidence or escalate via Shared Services tickets.'
        : 'Period readiness looks manageable; keep cadence and attach evidence as tasks close.';

  return {
    summary,
    recommended_order,
    next_actions,
    impact,
    guardrails: GUARDRAILS,
    provider: 'rules',
  };
}

/** Optional LLM polish — falls back to rules on any failure. Draft only. */
export async function buildSscAiBriefingAsync(input: {
  tasks: SscChecklistTaskRow[];
  monitoring: SscMonitoringSummary[];
  periodLabel: string;
  functionFilter: string;
}): Promise<SscAiBriefing> {
  const base = buildSscAiBriefing(input);
  const key = process.env.OPENAI_API_KEY?.trim();
  const enabled =
    process.env.SSC_AI_PROVIDER?.trim() === 'openai' ||
    process.env.MARKETING_AI_PROVIDER?.trim() === 'openai';
  if (!key || !enabled) return base;

  try {
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
    const prompt = [
      'You are an SSC operations aide for Tage VC. Return JSON only with keys: summary, impact, recommended_order (string[] max 8), next_actions (string[] max 5).',
      'Draft recommendations only. Never authorize money movement, legal send/sign, or destructive access revocation.',
      `Period: ${input.periodLabel}. Function filter: ${input.functionFilter}.`,
      `Baseline summary: ${base.summary}`,
      `Open tasks: ${JSON.stringify(
        input.tasks
          .filter((t) => t.status !== 'done' && t.status !== 'waived')
          .slice(0, 20)
          .map((t) => ({
            title: t.title,
            company: t.company_name,
            status: t.status,
            overdue: t.is_overdue,
            risk: t.risk_level,
          })),
      )}`,
    ].join('\n');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'SSC draft assistant. Human confirmation required on high-risk actions.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) return base;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<SscAiBriefing>;
    return {
      summary: String(parsed.summary ?? base.summary),
      impact: String(parsed.impact ?? base.impact),
      recommended_order: Array.isArray(parsed.recommended_order)
        ? parsed.recommended_order.map(String).slice(0, 8)
        : base.recommended_order,
      next_actions: Array.isArray(parsed.next_actions)
        ? parsed.next_actions.map(String).slice(0, 5)
        : base.next_actions,
      guardrails: GUARDRAILS,
      provider: 'openai',
    };
  } catch {
    return base;
  }
}

export function draftAuditFinding(input: {
  title: string;
  company_name: string;
  status: string;
  evidence_note?: string | null;
}): string {
  const base = `Finding (draft): ${input.title} for ${input.company_name} is currently “${input.status}”.`;
  const evidence = input.evidence_note?.trim()
    ? ` Evidence note: ${input.evidence_note.trim()}.`
    : ' Attach ticket, doc, or note evidence before closing.';
  return `${base}${evidence} Human confirmation required — do not auto-close high-risk controls.`;
}

export function suggestTaskNextAction(task: SscChecklistTaskRow): string {
  if (task.status === 'done' || task.status === 'waived') {
    return 'No action — already closed.';
  }
  if (task.status === 'blocked') {
    return `Blocked: document blocker for ${task.company_name}, link a ticket, then return to in progress.`;
  }
  if (task.is_overdue) {
    return `Overdue: complete “${task.title}” today or escalate to ${task.owner_role}.`;
  }
  if (task.status === 'not_started') {
    return `Start “${task.title}” for ${task.company_name}; set in progress and gather evidence.`;
  }
  return `Finish “${task.title}” and attach evidence (ticket/doc/note) before marking done.`;
}
