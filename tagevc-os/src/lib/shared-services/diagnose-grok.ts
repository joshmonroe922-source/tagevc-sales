/**
 * Optional Grok-enhanced diagnose for tickets.
 * Always runs rule-based diagnose first; Grok may enrich summary + proposed_actions.
 * Never overrides a forbid-list ESCALATE to AUTO.
 */

import { diagnoseTicket, type DiagnoseInput } from '@/lib/shared-services/diagnose';
import { isAllowListed } from '@/lib/shared-services/allow-list';
import { grokChatCompletion, xaiConfigured } from '@/lib/think-tank/llm';
import type { DiagnoseResult } from '@/lib/types';

export type ProposedActionStep = {
  code: string;
  label: string;
  requires_human: boolean;
  note?: string;
};

export type EnrichedDiagnose = DiagnoseResult & {
  diagnose_summary: string;
  proposed_actions: ProposedActionStep[];
  escalation_reason: string;
  ai_enriched: boolean;
};

function ruleSummary(d: DiagnoseResult, input: DiagnoseInput): string {
  return [
    `Band ${d.band} at ${d.confidence}% confidence.`,
    d.proposed_action
      ? `Proposed action: ${d.proposed_action}.`
      : 'No allow-listed action matched.',
    d.forbid_hits.length
      ? `Forbid hits: ${d.forbid_hits.join(', ')}.`
      : 'No forbid-list hits.',
    d.recommendation,
    `Title: ${input.title}`,
  ].join(' ');
}

function ruleProposedActions(d: DiagnoseResult): ProposedActionStep[] {
  if (!d.proposed_action) return [];
  return [
    {
      code: d.proposed_action,
      label: d.proposed_action,
      requires_human: d.band !== 'AUTO',
      note: d.recommendation,
    },
  ];
}

/**
 * Rule-based diagnose + optional Grok enrichment.
 * Grok cannot promote forbid/P0 tickets into AUTO.
 */
export async function diagnoseTicketEnriched(
  input: DiagnoseInput,
): Promise<EnrichedDiagnose> {
  const base = diagnoseTicket(input);
  const fallback: EnrichedDiagnose = {
    ...base,
    diagnose_summary: ruleSummary(base, input),
    proposed_actions: ruleProposedActions(base),
    escalation_reason:
      base.band === 'ESCALATE'
        ? base.forbid_hits.length
          ? `Forbid-list: ${base.forbid_hits.join(', ')}`
          : input.priority === 'P0'
            ? 'P0 always escalates'
            : 'Low confidence or ambiguous'
        : '',
    ai_enriched: false,
  };

  const enabled =
    process.env.TICKET_GROK_DIAGNOSE_ENABLED !== '0' &&
    process.env.TICKET_GROK_DIAGNOSE_ENABLED !== 'false';
  if (!enabled || !xaiConfigured()) return fallback;

  try {
    const system = [
      'You are Tage OS ticket diagnose assistant.',
      'Classify operational tickets into AUTO, DRAFT, or ESCALATE.',
      'AUTO only for pure technical, reversible, low blast-radius work.',
      'NEVER AUTO: money, DocuSign send, role/permission, HR termination, credit file writes, secrets, data deletion.',
      'Return JSON only: { "band": "AUTO"|"DRAFT"|"ESCALATE", "confidence": 0-100, "summary": string, "proposed_actions": [{"code":string,"label":string,"requires_human":boolean,"note":string}], "escalation_reason": string }',
      'Do not claim you performed gated actions.',
    ].join('\n');

    const user = JSON.stringify({
      title: input.title,
      description: input.description,
      desired_outcome: input.desired_outcome,
      service: input.service,
      priority: input.priority,
      rule_band: base.band,
      rule_confidence: base.confidence,
      rule_proposed: base.proposed_action,
      forbid_hits: base.forbid_hits,
    });

    const llm = await grokChatCompletion({
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const raw = llm.content ?? '';
    if (!raw) return fallback;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as {
      band?: string;
      confidence?: number;
      summary?: string;
      proposed_actions?: ProposedActionStep[];
      escalation_reason?: string;
    };

    // Never let Grok override forbid / P0 escalate downward to AUTO
    let band = base.band;
    if (
      base.band !== 'ESCALATE' &&
      (parsed.band === 'AUTO' || parsed.band === 'DRAFT' || parsed.band === 'ESCALATE')
    ) {
      // Only allow demotion toward safer (ESCALATE > DRAFT > AUTO) or same
      if (parsed.band === 'ESCALATE') band = 'ESCALATE';
      else if (parsed.band === 'DRAFT' && base.band === 'AUTO') band = 'DRAFT';
      else if (parsed.band === base.band) band = base.band;
      else if (
        parsed.band === 'AUTO' &&
        base.band === 'DRAFT' &&
        base.on_allow_list &&
        isAllowListed(base.proposed_action)
      ) {
        // Keep rule AUTO gate — do not promote DRAFT→AUTO via LLM alone
        band = 'DRAFT';
      }
    }

    const actions = Array.isArray(parsed.proposed_actions)
      ? parsed.proposed_actions.slice(0, 8)
      : fallback.proposed_actions;

    return {
      ...base,
      band,
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(99, Math.round(parsed.confidence)))
          : base.confidence,
      diagnose_summary: (parsed.summary || fallback.diagnose_summary).slice(0, 2000),
      proposed_actions: actions,
      escalation_reason: (parsed.escalation_reason || fallback.escalation_reason).slice(
        0,
        500,
      ),
      recommendation: parsed.summary
        ? `${base.recommendation}\n\nAI: ${parsed.summary}`.slice(0, 2000)
        : base.recommendation,
      ai_enriched: true,
    };
  } catch {
    return fallback;
  }
}
