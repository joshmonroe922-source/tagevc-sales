/**
 * CoA auto-categorization rules engine — Spec Automation Map / Go-Live ENT-03.
 * Merchant/keyword → entity CoA; persist suggestedAccount on feed rows.
 */

import type {
  BankFeedTxn,
  CategorizationRule,
  EntityCode,
} from '@/lib/af/types';

export const DEFAULT_AUTO_POST_THRESHOLD = 0.85;

/** Seed rules shared across company entities (entityCode '*'). */
export function defaultCategorizationRules(): CategorizationRule[] {
  return [
    {
      id: 'RULE-AWS',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'amazon web services',
      account: '6500',
      direction: 'spend',
      priority: 100,
      active: true,
      label: 'AWS',
    },
    {
      id: 'RULE-AWS-SHORT',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'aws.',
      account: '6500',
      direction: 'spend',
      priority: 95,
      active: true,
      label: 'AWS short',
    },
    {
      id: 'RULE-GOOGLE',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'google',
      account: '6500',
      direction: 'spend',
      priority: 80,
      active: true,
      label: 'Google / GSuite',
    },
    {
      id: 'RULE-MICROSOFT',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'microsoft',
      account: '6500',
      direction: 'spend',
      priority: 80,
      active: true,
      label: 'Microsoft',
    },
    {
      id: 'RULE-GITHUB',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'github',
      account: '6500',
      direction: 'spend',
      priority: 90,
      active: true,
      label: 'GitHub',
    },
    {
      id: 'RULE-VERCEL',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'vercel',
      account: '6500',
      direction: 'spend',
      priority: 90,
      active: true,
      label: 'Vercel',
    },
    {
      id: 'RULE-OPENAI',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'openai',
      account: '6500',
      direction: 'spend',
      priority: 90,
      active: true,
      label: 'OpenAI',
    },
    {
      id: 'RULE-CURSOR',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'cursor',
      account: '6500',
      direction: 'spend',
      priority: 85,
      active: true,
      label: 'Cursor',
    },
    {
      id: 'RULE-SLACK',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'slack',
      account: '6500',
      direction: 'spend',
      priority: 80,
      active: true,
      label: 'Slack',
    },
    {
      id: 'RULE-ZOOM',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'zoom',
      account: '6500',
      direction: 'spend',
      priority: 75,
      active: true,
      label: 'Zoom',
    },
    {
      id: 'RULE-ADOBE',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'adobe',
      account: '6500',
      direction: 'spend',
      priority: 75,
      active: true,
      label: 'Adobe',
    },
    {
      id: 'RULE-META-ADS',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'facebook ads',
      account: '6100',
      direction: 'spend',
      priority: 90,
      active: true,
      label: 'Meta Ads',
    },
    {
      id: 'RULE-GOOGLE-ADS',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'google ads',
      account: '6100',
      direction: 'spend',
      priority: 90,
      active: true,
      label: 'Google Ads',
    },
    {
      id: 'RULE-LINKEDIN',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'linkedin',
      account: '6100',
      direction: 'spend',
      priority: 70,
      active: true,
      label: 'LinkedIn',
    },
    {
      id: 'RULE-INSURANCE',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'insurance',
      account: '6700',
      direction: 'spend',
      priority: 70,
      active: true,
      label: 'Insurance',
    },
    {
      id: 'RULE-LEGAL',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'law firm',
      account: '6400',
      direction: 'spend',
      priority: 70,
      active: true,
      label: 'Legal',
    },
    {
      id: 'RULE-ATTORNEY',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'attorney',
      account: '6400',
      direction: 'spend',
      priority: 70,
      active: true,
      label: 'Attorney',
    },
    {
      id: 'RULE-RENT',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'rent',
      account: '6600',
      direction: 'spend',
      priority: 60,
      active: true,
      label: 'Rent',
    },
    {
      id: 'RULE-WEWORK',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'wework',
      account: '6600',
      direction: 'spend',
      priority: 85,
      active: true,
      label: 'WeWork',
    },
    {
      id: 'RULE-BANK-FEE',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'service charge',
      account: '6900',
      direction: 'spend',
      priority: 90,
      active: true,
      label: 'Bank fee',
    },
    {
      id: 'RULE-BANK-FEE-2',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'monthly fee',
      account: '6900',
      direction: 'spend',
      priority: 90,
      active: true,
      label: 'Monthly fee',
    },
    {
      id: 'RULE-INTEREST-INC',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'interest',
      account: '7000',
      direction: 'deposit',
      priority: 80,
      active: true,
      label: 'Interest income',
    },
    {
      id: 'RULE-PAYROLL',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'gusto',
      account: '6300',
      direction: 'spend',
      priority: 85,
      active: true,
      label: 'Payroll (Gusto)',
    },
    {
      id: 'RULE-ADP',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'adp',
      account: '6300',
      direction: 'spend',
      priority: 85,
      active: true,
      label: 'Payroll (ADP)',
    },
    {
      id: 'RULE-STRIPE',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'stripe',
      account: '4900',
      direction: 'deposit',
      priority: 70,
      active: true,
      label: 'Stripe deposit',
    },
    {
      id: 'RULE-TRANSFER-IGNORE',
      entityCode: '*',
      matchType: 'contains',
      pattern: 'transfer to',
      account: '1090',
      direction: 'either',
      priority: 50,
      active: true,
      label: 'Internal transfer hint',
    },
  ];
}

function matchesPattern(
  haystack: string,
  rule: CategorizationRule,
): boolean {
  const h = haystack.toLowerCase();
  const p = rule.pattern.toLowerCase();
  switch (rule.matchType) {
    case 'exact':
      return h === p;
    case 'starts_with':
      return h.startsWith(p);
    case 'contains':
    default:
      return h.includes(p);
  }
}

function directionOk(amount: number, direction: CategorizationRule['direction']) {
  if (direction === 'either') return true;
  if (direction === 'spend') return amount < 0;
  return amount > 0;
}

export type CategorizeSuggestion = {
  account: string;
  confidence: number;
  ruleId: string;
  label?: string;
};

/**
 * Best matching rule for a feed description.
 * Confidence scales with priority (max 1.0).
 */
export function suggestAccountForFeed(
  txn: Pick<BankFeedTxn, 'description' | 'amount' | 'entityCode' | 'ref'>,
  rules: CategorizationRule[],
): CategorizeSuggestion | null {
  const haystack = `${txn.description} ${txn.ref ?? ''}`.trim();
  const applicable = rules
    .filter((r) => r.active)
    .filter(
      (r) => r.entityCode === '*' || r.entityCode === txn.entityCode,
    )
    .filter((r) => directionOk(txn.amount, r.direction))
    .filter((r) => matchesPattern(haystack, r))
    .sort((a, b) => b.priority - a.priority);

  const best = applicable[0];
  if (!best) return null;
  const confidence = Math.min(1, 0.55 + best.priority / 200);
  return {
    account: best.account,
    confidence,
    ruleId: best.id,
    label: best.label,
  };
}

/** Apply suggestions onto unmatched feed rows (does not post JE). */
export function applySuggestionsToFeeds(
  feedTxns: BankFeedTxn[],
  rules: CategorizationRule[],
): { feedTxns: BankFeedTxn[]; updated: number } {
  let updated = 0;
  const next = feedTxns.map((txn) => {
    if (txn.status !== 'Unmatched') return txn;
    if (txn.journalId) return txn;
    const suggestion = suggestAccountForFeed(txn, rules);
    if (!suggestion) {
      if (txn.suggestedAccount || txn.suggestedConfidence) {
        updated += 1;
        return {
          ...txn,
          suggestedAccount: undefined,
          suggestedConfidence: undefined,
          suggestedRuleId: undefined,
        };
      }
      return txn;
    }
    if (
      txn.suggestedAccount === suggestion.account &&
      txn.suggestedConfidence === suggestion.confidence &&
      txn.suggestedRuleId === suggestion.ruleId
    ) {
      return txn;
    }
    updated += 1;
    return {
      ...txn,
      suggestedAccount: suggestion.account,
      suggestedConfidence: suggestion.confidence,
      suggestedRuleId: suggestion.ruleId,
    };
  });
  return { feedTxns: next, updated };
}

export function upsertCategorizationRule(
  rules: CategorizationRule[],
  rule: CategorizationRule,
): CategorizationRule[] {
  const idx = rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) {
    const copy = [...rules];
    copy[idx] = rule;
    return copy;
  }
  return [...rules, rule];
}

export function learnRuleFromChoice(input: {
  entityCode: EntityCode;
  description: string;
  account: string;
  amount: number;
}): CategorizationRule {
  const words = input.description
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 3);
  const pattern = words.join(' ') || input.description.slice(0, 24).toLowerCase();
  return {
    id: `RULE-LEARN-${Date.now()}`,
    entityCode: input.entityCode,
    matchType: 'contains',
    pattern,
    account: input.account,
    direction: input.amount < 0 ? 'spend' : 'deposit',
    priority: 88,
    active: true,
    label: `Learned: ${pattern}`,
  };
}
