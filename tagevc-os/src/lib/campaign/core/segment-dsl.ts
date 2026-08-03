import type { SegmentDefinition, SegmentRule } from './types';

export type ContactLike = Record<string, unknown> & {
  primary_email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  lifecycle?: string | null;
  email_permission?: string | null;
  engagement_score?: number | null;
};

function isRule(x: unknown): x is SegmentRule {
  return !!x && typeof x === 'object' && 'field' in x && ('op' in x || 'operator' in x);
}

function isDef(x: unknown): x is SegmentDefinition {
  return !!x && typeof x === 'object' && 'op' in x && 'rules' in x;
}

function getField(contact: ContactLike, field: string): unknown {
  if (field.startsWith('contact.')) return contact[field.slice(8)];
  return contact[field];
}

function matchRule(contact: ContactLike, rule: SegmentRule): boolean {
  const val = getField(contact, rule.field);
  const op = rule.op || rule.operator || 'eq';
  switch (op) {
    case 'eq':
      return val == rule.value;
    case 'neq':
      return val != rule.value;
    case 'contains':
      return String(val ?? '')
        .toLowerCase()
        .includes(String(rule.value ?? '').toLowerCase());
    case 'gt':
      return Number(val) > Number(rule.value);
    case 'lt':
      return Number(val) < Number(rule.value);
    case 'in':
      return Array.isArray(rule.value) && rule.value.includes(val);
    case 'exists':
      return val != null && val !== '';
    default:
      return false;
  }
}

export function evaluateSegment(
  contact: ContactLike,
  def: SegmentDefinition,
): boolean {
  if (!def.rules?.length) return true;
  const results = def.rules.map((r) => {
    if (isDef(r)) return evaluateSegment(contact, r);
    if (isRule(r)) return matchRule(contact, r);
    return false;
  });
  return def.op === 'or' ? results.some(Boolean) : results.every(Boolean);
}

export function filterContactsBySegment<T extends ContactLike>(
  contacts: T[],
  def: SegmentDefinition,
): T[] {
  return contacts.filter((c) => evaluateSegment(c, def));
}
