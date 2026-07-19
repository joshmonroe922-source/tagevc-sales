import { isAllowListed, matchAllowAction } from '@/lib/shared-services/allow-list';
import { detectForbidHits } from '@/lib/shared-services/forbid-list';
import type {
  AutonomyVersion,
  DiagnoseResult,
  SsService,
  TicketPriority,
} from '@/lib/types';

/** Current shipped autonomy phase — v1 assist scaffolding (AUTO only on allow-list). */
export const CURRENT_POLICY_VERSION: AutonomyVersion = 'v1_assist';

export const CONFIDENCE_AUTO_MIN = 90;
export const CONFIDENCE_DRAFT_MIN = 60;

export type DiagnoseInput = {
  title: string;
  description?: string | null;
  desired_outcome?: string | null;
  service: SsService;
  priority: TicketPriority;
  /** Optional override for shadow testing. */
  hinted_action?: string | null;
};

/**
 * Diagnose step (§7B): classify AUTO / DRAFT / ESCALATE.
 * Server-side policy — never trust client band.
 */
export function diagnoseTicket(input: DiagnoseInput): DiagnoseResult {
  const blob = [
    input.title,
    input.description ?? '',
    input.desired_outcome ?? '',
    input.hinted_action ?? '',
  ].join(' ');

  const forbid_hits = detectForbidHits(blob);
  const proposed =
    (input.hinted_action as string | null) ?? matchAllowAction(blob);
  const on_allow_list = isAllowListed(proposed);

  let confidence = estimateConfidence({
    text: blob,
    service: input.service,
    priority: input.priority,
    on_allow_list,
    forbid_hits: forbid_hits.length,
  });

  // Hard rules
  if (forbid_hits.length > 0 || input.priority === 'P0') {
    confidence = Math.min(confidence, 55);
    return {
      band: 'ESCALATE',
      confidence,
      reasoning: buildReasoning({
        band: 'ESCALATE',
        confidence,
        forbid_hits,
        on_allow_list,
        priority: input.priority,
        proposed,
      }),
      proposed_action: proposed,
      forbid_hits,
      on_allow_list,
      recommendation: escalateRecommendation(forbid_hits, input.priority),
      policy_version: CURRENT_POLICY_VERSION,
    };
  }

  if (on_allow_list && confidence >= CONFIDENCE_AUTO_MIN) {
    return {
      band: 'AUTO',
      confidence,
      reasoning: buildReasoning({
        band: 'AUTO',
        confidence,
        forbid_hits,
        on_allow_list,
        priority: input.priority,
        proposed,
      }),
      proposed_action: proposed,
      forbid_hits,
      on_allow_list,
      recommendation: `AUTO eligible: execute "${proposed}" and log audit row.`,
      policy_version: CURRENT_POLICY_VERSION,
    };
  }

  if (confidence >= CONFIDENCE_DRAFT_MIN) {
    return {
      band: 'DRAFT',
      confidence,
      reasoning: buildReasoning({
        band: 'DRAFT',
        confidence,
        forbid_hits,
        on_allow_list,
        priority: input.priority,
        proposed,
      }),
      proposed_action: proposed,
      forbid_hits,
      on_allow_list,
      recommendation:
        'DRAFT: prepare recommendation for Service Lead — Approve / Edit / Reject before side effects.',
      policy_version: CURRENT_POLICY_VERSION,
    };
  }

  return {
    band: 'ESCALATE',
    confidence,
    reasoning: buildReasoning({
      band: 'ESCALATE',
      confidence,
      forbid_hits,
      on_allow_list,
      priority: input.priority,
      proposed,
    }),
    proposed_action: proposed,
    forbid_hits,
    on_allow_list,
    recommendation:
      'ESCALATE: low confidence or ambiguous — Service Lead / COO / Partner should act with agent pack.',
    policy_version: CURRENT_POLICY_VERSION,
  };
}

function estimateConfidence(args: {
  text: string;
  service: SsService;
  priority: TicketPriority;
  on_allow_list: boolean;
  forbid_hits: number;
}): number {
  let score = 55;
  if (args.on_allow_list) score += 35;
  if (args.text.trim().length > 80) score += 5;
  if (args.text.trim().length > 160) score += 5;
  if (args.priority === 'P3') score += 5;
  if (args.priority === 'P2') score += 2;
  if (args.priority === 'P1') score -= 5;
  if (args.forbid_hits > 0) score = Math.min(score, 40);
  // Ambiguous short tickets
  if (args.text.trim().length < 25) score -= 15;
  return Math.max(0, Math.min(99, score));
}

function buildReasoning(args: {
  band: string;
  confidence: number;
  forbid_hits: string[];
  on_allow_list: boolean;
  priority: TicketPriority;
  proposed: string | null;
}): string {
  const parts = [
    `band=${args.band}`,
    `confidence=${args.confidence}%`,
    `priority=${args.priority}`,
    `allow_list=${args.on_allow_list ? 'yes' : 'no'}`,
    `proposed=${args.proposed ?? 'none'}`,
  ];
  if (args.forbid_hits.length) {
    parts.push(`forbid_hits=${args.forbid_hits.join(',')}`);
  }
  if (args.priority === 'P0') parts.push('rule=P0_always_escalate');
  return parts.join('; ');
}

function escalateRecommendation(
  forbid_hits: string[],
  priority: TicketPriority,
): string {
  if (forbid_hits.length) {
    return `Forbid-list hit (${forbid_hits.join(', ')}): human must execute. Agent may only recommend.`;
  }
  if (priority === 'P0') {
    return 'P0 ticket: never AUTO. Service Lead + COO path; agent provides diagnosis pack only.';
  }
  return 'Escalate to Service Lead with recommendation pack.';
}

/**
 * Guard: assert an action may execute under AUTO.
 * Throws if forbid-list / policy violated.
 */
export function assertCanAutoExecute(args: {
  band: string;
  confidence: number;
  forbid_hits: string[];
  on_allow_list: boolean;
  priority: TicketPriority;
}): void {
  if (args.forbid_hits.length > 0) {
    throw new Error('Forbid-list: action cannot AUTO-execute');
  }
  if (args.priority === 'P0') {
    throw new Error('P0 tickets cannot AUTO-execute');
  }
  if (!args.on_allow_list) {
    throw new Error('Action not on COO allow-list');
  }
  if (args.band !== 'AUTO' || args.confidence < CONFIDENCE_AUTO_MIN) {
    throw new Error('Band/confidence does not permit AUTO');
  }
}
