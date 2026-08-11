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
import { hydrateTicketStore, listTickets } from '@/lib/data/ticket-store';
import {
  filterMaTargetsAssignedToAssociate,
  isMaTargetAssignedToAssociate,
} from '@/lib/deal-flow/ma/assignment';
import {
  filterReDealsAssignedToSourcer,
  isReDealAssignedToSourcer,
} from '@/lib/deal-flow/re/assignment';
import { canViewDocumentForRole } from '@/lib/documents/visibility';
import {
  buildParentIndex,
  canAccessPipelineEntity,
  getPipelineNullEntityMode,
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
  profileFullName: string | null;
  parentByEntityId: EntityParentIndex;
  nullMode: ReturnType<typeof getPipelineNullEntityMode>;
  /** Entity OS lock — keeps row checks narrowed for firm-wide operators. */
  activeEntityOs: string | null;
};

export async function getPipelineScope(): Promise<PipelineScope> {
  const [session, master] = await Promise.all([
    getSessionContext(),
    ensureMasterData(),
  ]);
  const parentByEntityId = buildParentIndex(master.entities);
  const nullMode = getPipelineNullEntityMode();
  if (!session) {
    return {
      firmWide: false,
      role: null,
      entityId: null,
      profileFullName: null,
      parentByEntityId,
      nullMode,
      activeEntityOs: null,
    };
  }
  return {
    firmWide: isFirmWideAccess(
      session.profile.role,
      session.profile.entity_id,
      session.activeEntityOs,
    ),
    role: session.profile.role,
    entityId: session.profile.entity_id,
    profileFullName: session.profile.full_name,
    parentByEntityId,
    nullMode,
    activeEntityOs: session.activeEntityOs,
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
    scope.nullMode,
    scope.activeEntityOs,
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
  // Always re-read SQL so portal intake tickets appear without a cold start.
  await hydrateTicketStore({ forceSql: true });
  const scope = await getPipelineScope();
  return listTickets().filter((t) => allow(scope, t.entity_id));
}

export async function listScopedDocuments(
  entityId?: string,
): Promise<DocumentRecord[]> {
  const scope = await getPipelineScope();
  return listDocuments(entityId).filter(
    (d) =>
      allow(scope, d.entity_id) && canViewDocumentForRole(scope.role, d),
  );
}

export async function listScopedActiveMaTargets(): Promise<MaTarget[]> {
  const scope = await getPipelineScope();
  const entityScoped = listActiveMaTargets().filter((t) =>
    allow(scope, t.entity_id),
  );
  return filterMaTargetsAssignedToAssociate(entityScoped, {
    role: scope.role,
    profileFullName: scope.profileFullName,
  });
}

/** Detail gate — entity scope + M&A Associate owner assignment. */
export async function canAccessScopedMaTarget(
  target: Pick<MaTarget, 'entity_id' | 'owner'>,
): Promise<boolean> {
  const scope = await getPipelineScope();
  if (!allow(scope, target.entity_id)) return false;
  if (!scope.role) return false;
  return isMaTargetAssignedToAssociate({
    role: scope.role,
    profileFullName: scope.profileFullName,
    target,
  });
}

export async function listScopedActiveReDeals(): Promise<ReDeal[]> {
  const scope = await getPipelineScope();
  const entityScoped = listActiveReDeals().filter((d) =>
    allow(scope, d.entity_id),
  );
  return filterReDealsAssignedToSourcer(entityScoped, {
    role: scope.role,
    profileFullName: scope.profileFullName,
  });
}

/** Detail gate — entity scope + Sourcer assignment. */
export async function canAccessScopedReDeal(
  deal: Pick<ReDeal, 'entity_id' | 'sourcer'>,
): Promise<boolean> {
  const scope = await getPipelineScope();
  if (!allow(scope, deal.entity_id)) return false;
  if (!scope.role) return false;
  return isReDealAssignedToSourcer({
    role: scope.role,
    profileFullName: scope.profileFullName,
    deal,
  });
}

/** Detail gate — returns false when row is out of scope. */
export async function canAccessScopedEntity(
  rowEntityId: string | null | undefined,
): Promise<boolean> {
  const scope = await getPipelineScope();
  return allow(scope, rowEntityId);
}
