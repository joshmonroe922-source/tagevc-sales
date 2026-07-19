import type { DealPath, LeadStage } from './types';

/**
 * Operator-led VC norms mapped to Tage pipeline stages.
 * Sources: Affinity / Carta / VC Lab / Allied VP deal-flow practice —
 * thesis-fit triage, short opinionated notes, refs before conviction,
 * documented pass reasons, clear term alignment before docs.
 */
export type StageGuidance = {
  /** One-line best practice (column tooltip / summary). */
  focus: string;
  /** Short prompt shown on kanban cards. */
  cardTip: string;
  /** Decision question for this stage. */
  decision: string;
  /** Checklist items for deal detail “Focus for this stage” panel. */
  checklist: string[];
  /** Optional Launch | Partner | Exit nuance. */
  pathTips?: Partial<Record<DealPath, string>>;
};

export const STAGE_GUIDANCE: Record<LeadStage, StageGuidance> = {
  new: {
    focus: 'Log company, founder, source, thesis path, and a dated next step before the inbox eats it.',
    cardTip: 'Capture source + thesis fit',
    decision: 'Does this plausibly fit Launch, Partner, or Exit?',
    checklist: [
      'Company / founder contact + source channel recorded',
      'Thesis path set (Launch | Partner | Exit)',
      'One-line description of what they do',
      'Owner assigned and next action dated',
    ],
    pathTips: {
      launch: 'Early team + wedge into a real workflow — not just a cool product.',
      partner: 'Strategic distribution / tech / capital fit with Tage or portfolio.',
      exit: 'Confidential intake; note readiness and why they want liquidity now.',
    },
  },
  qualified: {
    focus: 'Screen fast against thesis — advance only if there is signal for a first call; otherwise pass with a reason.',
    cardTip: 'Thesis screen; book or pass',
    decision: 'Is there enough signal for a founder conversation?',
    checklist: [
      'Stage / check-size / geography fit the fund',
      'Market large enough for venture-scale outcomes (or Exit thesis holds)',
      'Credible founder wedge or Partner strategic fit',
      'Short, opinionated screen note in Notes (not “interesting AI…”)',
    ],
    pathTips: {
      launch: 'Look for pull: usage, pilots, waitlist quality — not vanity logos.',
      partner: 'Can Tage uniquely help distribution, tech, or capital access?',
      exit: 'Buyer landscape and timeline realistic? Any obvious deal-breakers?',
    },
  },
  call_booked: {
    focus: 'Use the call to test team, urgency, and “why Tage” — leave with advance, pass, or a dated follow-up.',
    cardTip: 'Test team + why Tage',
    decision: 'Worth deeper diligence, or a clean pass?',
    checklist: [
      'Prep 3–5 thesis-specific questions before the call',
      'Assess team credibility and decision-maker access',
      'Clarify round timing, ask, and competitive process',
      'Log outcome + next step the same day',
    ],
    pathTips: {
      launch: 'Is the pain workflow-critical or a nice-to-have analytics layer?',
      partner: 'Map concrete partnership path (channel, product, capital).',
      exit: 'Confirm confidentiality expectations and process owner.',
    },
  },
  diligence: {
    focus: 'Validate the thesis with customer/founder refs, market proof, and risks — draft the memo as you work.',
    cardTip: 'Refs + risks → memo',
    decision: 'What would need to be true to invest (or close an Exit)?',
    checklist: [
      'Customer / user references (or buyer interest for Exit)',
      'Founder / management references where material',
      'Market / competitive notes and key risks + mitigants',
      'Deal memo draft started (thesis, terms sketch, portfolio fit)',
    ],
    pathTips: {
      launch: 'Reference checks are non-negotiable before conviction.',
      partner: 'Diligence the partnership economics and execution capacity.',
      exit: 'Legal / structure red flags early; protect confidentiality.',
    },
  },
  term_sheet: {
    focus: 'Align ownership, rights, and path-specific structure before full legal docs — no ambiguity on must-haves.',
    cardTip: 'Align terms before docs',
    decision: 'Are economics and control rights clear enough to paper?',
    checklist: [
      'Check size, ownership target, and valuation / structure agreed in principle',
      'Key rights listed (liq pref, pro rata, board / information, employment)',
      'Path-specific terms noted (studio, partnership, or Exit mechanics)',
      'Counsel engaged only after commercial terms are aligned',
    ],
    pathTips: {
      launch: 'Standard early-stage terms where possible; flag unusual asks.',
      partner: 'Spell out partnership deliverables alongside capital terms.',
      exit: 'LOI / exclusivity / earnout / escrow expectations in writing.',
    },
  },
  closed_won: {
    focus: 'Hand off cleanly to onboarding / portfolio with owner, docs, and first milestones.',
    cardTip: 'Handoff + first milestones',
    decision: 'Is ops ready to own the relationship day one?',
    checklist: [
      'Final docs and wire / close checklist complete',
      'Portfolio / onboarding owner assigned',
      'First 30-day milestones or intro plan logged',
      'CRM stage and notes reflect the live relationship',
    ],
    pathTips: {
      launch: 'Route into New Start-Up / studio onboarding.',
      partner: 'Confirm partnership kickoff owner and success metrics.',
      exit: 'Close file cleanly; archive sensitive notes appropriately.',
    },
  },
  closed_lost: {
    focus: 'Record why the deal was lost (timing, terms, competition) so sourcing and pricing improve.',
    cardTip: 'Log loss reason',
    decision: 'What should we change next time?',
    checklist: [
      'Loss reason noted (timing / terms / competition / fit)',
      'Competitive outcome captured if known',
      'Relationship status: nurture later vs. archive',
      'Any process lesson for the team',
    ],
  },
  passed: {
    focus: 'Pass with a crisp reason — protect founder goodwill and keep a nurture path when thesis may reopen.',
    cardTip: 'Pass reason + nurture?',
    decision: 'Archive cold, or monitor for a later thesis fit?',
    checklist: [
      'Written pass reason (thesis, stage, team, market, timing)',
      'Founder response sent when a relationship exists',
      'Nurture / revisit date set if “not now”',
      'Source channel quality noted for pipeline reviews',
    ],
  },
};

export function stagePathTip(stage: LeadStage, path: DealPath): string | null {
  return STAGE_GUIDANCE[stage].pathTips?.[path] ?? null;
}
