/** Shared Services operator board helpers (P4). */

import { entityDisplayName } from '@/lib/entities/display-name';
import {
  parentVsSubsidiaryLabel,
  resolveCanonicalEntityId,
} from '@/lib/multi-sub/entity-registry';
import type { Ticket } from '@/lib/types';

export const MS_P4_CONTRACT_VERSION = 'ms-p4-v1' as const;

export type SsOperatorBoard = {
  contract_version: typeof MS_P4_CONTRACT_VERSION;
  money_auto_approve: false;
  by_service: Record<string, number>;
  by_entity: Record<string, number>;
  by_priority: Record<string, number>;
  parent_open: number;
  subsidiary_open: number;
  context_labels: {
    parent: string;
    subsidiary_r619: string;
    subsidiary_inda: string;
  };
};

export function buildSsOperatorBoard(tickets: Ticket[]): SsOperatorBoard {
  const by_service: Record<string, number> = {};
  const by_entity: Record<string, number> = {};
  const by_priority: Record<string, number> = {};
  let parent_open = 0;
  let subsidiary_open = 0;

  for (const t of tickets) {
    if (t.status === 'Closed' || t.status === 'Resolved') continue;
    by_service[t.service] = (by_service[t.service] ?? 0) + 1;
    by_priority[t.priority] = (by_priority[t.priority] ?? 0) + 1;
    const canon = resolveCanonicalEntityId(t.entity_id) ?? 'ENT-FIRM';
    by_entity[canon] = (by_entity[canon] ?? 0) + 1;
    const kind = parentVsSubsidiaryLabel(t.entity_id);
    if (kind === 'parent' || kind === 'unscoped') parent_open += 1;
    else subsidiary_open += 1;
  }

  return {
    contract_version: MS_P4_CONTRACT_VERSION,
    money_auto_approve: false,
    by_service,
    by_entity,
    by_priority,
    parent_open,
    subsidiary_open,
    context_labels: {
      parent: 'Tage (parent)',
      subsidiary_r619: 'Recruit 619',
      subsidiary_inda: 'Instant NDA',
    },
  };
}

export function ticketContextHeader(ticket: {
  entity_id?: string | null;
  company_name?: string | null;
  ticket_id: string;
}): {
  entity_code: string | null;
  entity_label: string;
  scope: 'parent' | 'subsidiary' | 'unscoped';
  headline: string;
} {
  const scope = parentVsSubsidiaryLabel(ticket.entity_id);
  const entity_code = resolveCanonicalEntityId(ticket.entity_id);
  const entity_label = entityDisplayName({
    entity_id: ticket.entity_id,
    company_name: ticket.company_name,
  });
  const scopeLabel =
    scope === 'parent'
      ? 'Parent · Tage'
      : scope === 'subsidiary'
        ? `Subsidiary · ${entity_label}`
        : 'Unscoped';
  return {
    entity_code,
    entity_label,
    scope,
    headline: scopeLabel,
  };
}

export function suggestAssignee(input: {
  entity_id: string | null | undefined;
  service: string;
  priority: string;
}): { assignee: string | null; escalate_to: string | null } {
  const canon = resolveCanonicalEntityId(input.entity_id) ?? 'ENT-FIRM';
  const key = `${canon}:${input.service}:${input.priority}`;
  const rules: Record<string, { assignee: string; escalate_to: string }> = {
    'ENT-R619:IT:P0': {
      assignee: 'IT Shared Services',
      escalate_to: 'COO — Ops Lead',
    },
    'ENT-R619:IT:P1': {
      assignee: 'IT Shared Services',
      escalate_to: 'Service Lead',
    },
    'ENT-INDA:IT:P0': {
      assignee: 'IT Shared Services',
      escalate_to: 'COO — Ops Lead',
    },
    'ENT-INDA:Legal:P1': {
      assignee: 'Legal Shared Services',
      escalate_to: 'Counsel Ops',
    },
    'ENT-FIRM:Finance:P0': {
      assignee: 'Finance Shared Services',
      escalate_to: 'COO — Ops Lead',
    },
  };
  const hit = rules[key];
  if (hit) return { assignee: hit.assignee, escalate_to: hit.escalate_to };
  return {
    assignee: `${input.service} Shared Services`,
    escalate_to: 'Service Lead',
  };
}
