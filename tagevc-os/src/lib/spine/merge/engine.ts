/**
 * Merge engine — user beats agent; locked fields → suggested_updates only.
 * Rules R1–R7 from Database Refresh.xlsx / 03_Schema_SQL.
 */

import type { MergeFieldInput, MergeSource } from '@/lib/spine/db/types';

const WATERFALL_RANK: Record<string, number> = {
  user: 100,
  zerobounce: 90,
  hunter: 70,
  apollo: 60,
  pdl: 55,
  website: 40,
  import: 30,
  agent: 20,
};

export type MergeDecision =
  | {
      action: 'write';
      field: string;
      value: string;
      source: MergeSource;
      confidence: number;
    }
  | {
      action: 'suggest';
      field: string;
      value: string;
      source: MergeSource;
      confidence: number;
      reason: string;
    }
  | { action: 'skip'; field: string; reason: string };

function rank(source: string | null | undefined): number {
  if (!source) return 0;
  return WATERFALL_RANK[source] ?? 10;
}

export function decideMergeField(input: MergeFieldInput): MergeDecision {
  const value = (input.value ?? '').trim();
  if (!value) {
    return { action: 'skip', field: input.field, reason: 'empty_value' };
  }

  if (input.field === 'primary_email' || input.field.endsWith('_email')) {
    const status = (input.emailStatus ?? 'unknown').toLowerCase();
    if (status !== 'valid' && !(status === 'catch_all' && input.allowCatchAll)) {
      return {
        action: 'skip',
        field: input.field,
        reason: `email_unverified:${status}`,
      };
    }
  }

  const existing = (input.existingValue ?? '').trim();
  const locked = Boolean(input.locked || input.existingLocked);
  const existingSource = input.existingSource ?? null;

  if (locked || existingSource === 'user') {
    if (existing && existing === value) {
      return { action: 'skip', field: input.field, reason: 'unchanged_locked' };
    }
    return {
      action: 'suggest',
      field: input.field,
      value,
      source: input.source,
      confidence: input.confidence ?? 0.5,
      reason: locked ? 'field_locked' : 'user_owned',
    };
  }

  if (!existing) {
    return {
      action: 'write',
      field: input.field,
      value,
      source: input.source,
      confidence: input.confidence ?? 0.7,
    };
  }

  if (existing === value) {
    return { action: 'skip', field: input.field, reason: 'unchanged' };
  }

  const incomingRank = rank(input.source);
  const existingRank = rank(existingSource);
  if (incomingRank > existingRank) {
    return {
      action: 'write',
      field: input.field,
      value,
      source: input.source,
      confidence: input.confidence ?? 0.6,
    };
  }

  return {
    action: 'suggest',
    field: input.field,
    value,
    source: input.source,
    confidence: input.confidence ?? 0.5,
    reason: 'lower_or_equal_waterfall_rank',
  };
}

export function decideMergeBatch(fields: MergeFieldInput[]): MergeDecision[] {
  return fields.map(decideMergeField);
}

/** R7 dedupe keys — first match wins. */
export function contactDedupeScore(a: {
  email?: string | null;
  linkedin?: string | null;
  fullName?: string | null;
  accountId?: string | null;
}, b: {
  email?: string | null;
  linkedin?: string | null;
  fullName?: string | null;
  accountId?: string | null;
}): number {
  const ea = (a.email || '').toLowerCase().trim();
  const eb = (b.email || '').toLowerCase().trim();
  if (ea && eb && ea === eb) return 1;
  const la = (a.linkedin || '').toLowerCase().trim();
  const lb = (b.linkedin || '').toLowerCase().trim();
  if (la && lb && la === lb) return 0.98;
  const na = (a.fullName || '').toLowerCase().trim();
  const nb = (b.fullName || '').toLowerCase().trim();
  if (na && nb && na === nb && a.accountId && a.accountId === b.accountId) {
    return 0.92;
  }
  return 0;
}
