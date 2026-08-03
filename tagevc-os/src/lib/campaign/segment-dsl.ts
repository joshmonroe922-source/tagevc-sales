/**
 * Segment DSL evaluator — pure functions over contact-like records.
 */

import type { SegmentDefinition, SegmentRule } from '@/lib/campaign/types';

export type SegmentContact = Record<string, unknown> & {
  id: string;
  primary_email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  title?: string | null;
  lifecycle?: string | null;
  email_permission?: string | null;
  engagement_score?: number | null;
};

function getField(contact: SegmentContact, field: string): unknown {
  if (field.includes('.')) {
    const parts = field.split('.');
    let cur: unknown = contact;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }
  return contact[field];
}

function evalLeaf(
  contact: SegmentContact,
  rule: Extract<SegmentRule, { field: string }>,
): boolean {
  const left = getField(contact, rule.field);
  const right = rule.value;
  switch (rule.operator) {
    case 'eq':
      return String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase();
    case 'neq':
      return String(left ?? '').toLowerCase() !== String(right ?? '').toLowerCase();
    case 'contains':
      return String(left ?? '')
        .toLowerCase()
        .includes(String(right ?? '').toLowerCase());
    case 'in':
      return Array.isArray(right)
        ? right.map(String).map((s) => s.toLowerCase()).includes(
            String(left ?? '').toLowerCase(),
          )
        : false;
    case 'gt':
      return Number(left) > Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'exists':
      return left != null && left !== '';
    default:
      return false;
  }
}

export function evalRule(
  contact: SegmentContact,
  rule: SegmentRule,
): boolean {
  if ('op' in rule && 'rules' in rule) {
    if (rule.op === 'and') return rule.rules.every((r) => evalRule(contact, r));
    return rule.rules.some((r) => evalRule(contact, r));
  }
  return evalLeaf(contact, rule as Extract<SegmentRule, { field: string }>);
}

export function evaluateSegment(
  definition: SegmentDefinition,
  contacts: SegmentContact[],
): SegmentContact[] {
  return contacts.filter((c) => evalRule(c, definition));
}

export function estimateSegmentCount(
  definition: SegmentDefinition,
  contacts: SegmentContact[],
): { count: number; sample: SegmentContact[] } {
  const matched = evaluateSegment(definition, contacts);
  return { count: matched.length, sample: matched.slice(0, 10) };
}

export function parseSegmentDefinition(raw: unknown): SegmentDefinition {
  if (
    raw &&
    typeof raw === 'object' &&
    'op' in raw &&
    Array.isArray((raw as SegmentDefinition).rules)
  ) {
    return raw as SegmentDefinition;
  }
  return { op: 'and', rules: [] };
}
