import { ensureMasterData } from '@/lib/data/master-data';
import {
  listActiveDeals,
  listActiveLeads,
  listAllLeads,
  listIcQueue,
  listOpenLeadTasks,
} from '@/lib/data/deal-flow-store';
import { listDocuments } from '@/lib/data/document-store';
import { listActiveMaTargets } from '@/lib/data/ma-store';
import { listActiveReDeals } from '@/lib/data/re-store';
import { listTickets } from '@/lib/data/ticket-store';
import {
  buildParentIndex,
  canAccessPipelineEntity,
  isFirmWideAccess,
  type EntityParentIndex,
} from '@/lib/rbac/entity-scope';
import { getSessionContext } from '@/lib/rbac/session';
import type { AppRole } from '@/lib/types/roles';
import type {
  Deal,
  DocumentRecord,
  IcReview,
  Lead,
  LeadTask,
  MaTarget,
  ReDeal,
  Ticket,
} from '@/lib/types';

export type PipelineScope = {
  firmWide: boolean;
  role: AppRole | null;
  entityId: string | null;
  parentByEntityId: EntityParentIndex;
};

export async function getPipelineScope(): Promise<PipelineScope> {
  const [session, master] = await Promise.all([
    getSessionContext(),
    ensureMasterData(),
  ]);
  const parentByEntityId = buildParentIndex(master.entities);
  if (!session) {
    return {
      firmWide: false,
      role: null,
      entityId: null,
      parentByEntityId,
    };
  }
  return {
    firmWide: isFirmWideAccess(
      session.profile.role,
      session.profile.entity_id,
    ),
    role: session.profile.role,
    entityId: session.profile.entity_id,
    parentByEntityId,
  };
}

function allow(
  scope: PipelineScope,
  rowEntityId: string | null | undefined,
): boolean {
  if (scope.firmWide || !scope.role) return true;
  return canAccessPipelineEntity(
    scope.role,
    scope.entityId,
    rowEntityId,
    scope.parentByEntityId,
  );
}

export async function listScopedActiveLeads(): Promise<Lead[]> {
  const scope = await getPipelineScope();
  return listActiveLeads().filter((l) =>
    allow(scope, l.related_entity_id),
  );
}

export async function listScopedAllLeads(): Promise<Lead[]> {
  const scope = await getPipelineScope();
  return listAllLeads().filter((l) => allow(scope, l.related_entity_id));
}

export async function listScopedActiveDeals(): Promise<Deal[]> {
  const scope = await getPipelineScope();
  return listActiveDeals().filter((d) => allow(scope, d.entity_id));
}

export async function listScopedOpenLeadTasks(): Promise<LeadTask[]> {
  const [scope, leads] = await Promise.all([
    getPipelineScope(),
    listScopedActiveLeads(),
  ]);
  if (scope.firmWide || !scope.role) return listOpenLeadTasks();
  const leadIds = new Set(leads.map((l) => l.lead_id));
  return listOpenLeadTasks().filter((t) => leadIds.has(t.lead_id));
}

export async function listScopedIcQueue(): Promise<IcReview[]> {
  const [scope, deals] = await Promise.all([
    getPipelineScope(),
    listScopedActiveDeals(),
  ]);
  if (scope.firmWide || !scope.role) return listIcQueue();
  const dealIds = new Set(deals.map((d) => d.deal_id));
  return listIcQueue().filter((r) => dealIds.has(r.deal_id));
}

export async function listScopedTickets(): Promise<Ticket[]> {
  const scope = await getPipelineScope();
  return listTickets().filter((t) => allow(scope, t.entity_id));
}

export async function listScopedDocuments(): Promise<DocumentRecord[]> {
  const scope = await getPipelineScope();
  return listDocuments().filter((d) => allow(scope, d.entity_id));
}

export async function listScopedActiveMaTargets(): Promise<MaTarget[]> {
  const scope = await getPipelineScope();
  return listActiveMaTargets().filter((t) => allow(scope, t.entity_id));
}

export async function listScopedActiveReDeals(): Promise<ReDeal[]> {
  const scope = await getPipelineScope();
  return listActiveReDeals().filter((d) => allow(scope, d.entity_id));
}

/** Detail gate — returns false when row is out of scope. */
export async function canAccessScopedEntity(
  rowEntityId: string | null | undefined,
): Promise<boolean> {
  const scope = await getPipelineScope();
  return allow(scope, rowEntityId);
}
