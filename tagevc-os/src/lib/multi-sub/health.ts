/** Parent multi-sub health + verification scenarios (P6). */

import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';
import type { Ticket } from '@/lib/types';

export const MS_P6_CONTRACT_VERSION = 'ms-p6-v1' as const;

/** Eight dual-sub readiness scenarios required by the mission. */
export const MULTI_SUB_VERIFICATION_SCENARIOS = [
  {
    key: 'registry_r619_inda',
    label: 'ENT-R619 + ENT-INDA registered (ENT-002 aliases to ENT-INDA)',
  },
  {
    key: 'ticket_entity_required',
    label: 'New tickets require entity_id (fail-closed)',
  },
  {
    key: 'inbox_entity_service_filter',
    label: 'SS inbox filters by entity + service',
  },
  {
    key: 'subsidiary_ticket_api',
    label: 'Subsidiary API create/status/list (least privilege)',
  },
  {
    key: 'messaging_home_membership',
    label: 'Messaging home-entity membership + directory badges',
  },
  {
    key: 'cross_entity_messaging_policy',
    label: 'Cross-entity DM/room policy enforcement',
  },
  {
    key: 'lifecycle_jml_engine',
    label: 'Joiner/mover/leaver same engine for R619 + INDA',
  },
  {
    key: 'parent_health_panels',
    label: 'Parent health: tickets/SLA, messaging fails, lifecycle',
  },
] as const;

export type MultiSubScenarioKey =
  (typeof MULTI_SUB_VERIFICATION_SCENARIOS)[number]['key'];

export type MultiSubHealthReport = {
  contract_version: typeof MS_P6_CONTRACT_VERSION;
  money_auto_approve: false;
  ticket_volume_by_entity: Record<string, number>;
  ticket_sla_by_entity: Record<
    string,
    { open: number; breached: number; p0: number }
  >;
  messaging_provision_failures: number;
  lifecycle_success: number;
  lifecycle_failure: number;
  feed_status: 'ok' | 'partial' | 'missing' | 'unknown';
  todo: string | null;
};

export function buildMultiSubHealthFromTickets(
  tickets: Ticket[],
  extras?: {
    messaging_provision_failures?: number;
    lifecycle_success?: number;
    lifecycle_failure?: number;
    feed_status?: MultiSubHealthReport['feed_status'];
  },
): MultiSubHealthReport {
  const ticket_volume_by_entity: Record<string, number> = {};
  const ticket_sla_by_entity: MultiSubHealthReport['ticket_sla_by_entity'] = {};
  const now = Date.now();

  for (const t of tickets) {
    if (t.status === 'Closed' || t.status === 'Resolved') continue;
    const ent = resolveCanonicalEntityId(t.entity_id) ?? 'ENT-FIRM';
    ticket_volume_by_entity[ent] = (ticket_volume_by_entity[ent] ?? 0) + 1;
    const bucket = ticket_sla_by_entity[ent] ?? {
      open: 0,
      breached: 0,
      p0: 0,
    };
    bucket.open += 1;
    if (t.sla_due_at && Date.parse(t.sla_due_at) < now) bucket.breached += 1;
    if (t.priority === 'P0') bucket.p0 += 1;
    ticket_sla_by_entity[ent] = bucket;
  }

  const feed = extras?.feed_status ?? 'partial';
  return {
    contract_version: MS_P6_CONTRACT_VERSION,
    money_auto_approve: false,
    ticket_volume_by_entity,
    ticket_sla_by_entity,
    messaging_provision_failures: extras?.messaging_provision_failures ?? 0,
    lifecycle_success: extras?.lifecycle_success ?? 0,
    lifecycle_failure: extras?.lifecycle_failure ?? 0,
    feed_status: feed,
    todo:
      feed === 'ok'
        ? null
        : 'TODO: wire live messaging/lifecycle feeds when SQL applied in env',
  };
}
