/**
 * Go-Live Setup wizard — Spec - Go Live Setup.
 * Gates production until ORG + ENT required steps Done.
 */

import { AF_ENTITIES, AF_GO_LIVE } from '@/lib/af/master-data';
import type {
  EntityCode,
  SetupChecklistItem,
  SetupStepStatus,
} from '@/lib/af/types';

export type GoLiveProgress = {
  orgPct: number;
  entityPct: Record<EntityCode, number>;
  overallPct: number;
  productionUnlocked: boolean;
  blockedSteps: SetupChecklistItem[];
};

const ORG_ID = 'tage-vc';

export function buildInitialChecklist(): SetupChecklistItem[] {
  const items: SetupChecklistItem[] = AF_GO_LIVE.org.map((s) => ({
    orgId: ORG_ID,
    entityCode: 'ORG',
    stepId: s.id,
    status: 'Not started' as SetupStepStatus,
  }));

  for (const entity of AF_ENTITIES) {
    for (const step of AF_GO_LIVE.entity) {
      if (step.subsOnly && entity.code === 'TVC') continue;
      items.push({
        orgId: ORG_ID,
        entityCode: entity.code,
        stepId: step.id,
        status: 'Not started',
      });
    }
  }
  return items;
}

export function getStepMeta(stepId: string) {
  const org = AF_GO_LIVE.org.find((s) => s.id === stepId);
  if (org) return { ...org, scope: 'org' as const };
  const ent = AF_GO_LIVE.entity.find((s) => s.id === stepId);
  if (ent) return { ...ent, scope: 'entity' as const };
  return null;
}

function isRequired(stepId: string, entityCode: EntityCode | 'ORG'): boolean {
  if (entityCode === 'ORG') {
    return AF_GO_LIVE.org.find((s) => s.id === stepId)?.required ?? false;
  }
  const step = AF_GO_LIVE.entity.find((s) => s.id === stepId);
  if (!step) return false;
  if (step.id === 'ENT-11' && entityCode === 'TVC') return false;
  return step.required;
}

function pctDone(items: SetupChecklistItem[]): number {
  const required = items.filter((i) => isRequired(i.stepId, i.entityCode));
  if (!required.length) return 100;
  const done = required.filter(
    (i) => i.status === 'Done' || i.status === 'Skipped',
  ).length;
  return Math.round((done / required.length) * 100);
}

export function computeGoLiveProgress(
  checklist: SetupChecklistItem[],
): GoLiveProgress {
  const orgItems = checklist.filter((i) => i.entityCode === 'ORG');
  const entityPct = {} as Record<EntityCode, number>;
  const blockedSteps: SetupChecklistItem[] = [];

  for (const e of AF_ENTITIES) {
    const items = checklist.filter((i) => i.entityCode === e.code);
    entityPct[e.code] = pctDone(items);
    for (const item of items) {
      if (
        isRequired(item.stepId, e.code) &&
        (item.status === 'Blocked' || item.status === 'Not started')
      ) {
        blockedSteps.push(item);
      }
    }
  }

  for (const item of orgItems) {
    if (
      isRequired(item.stepId, 'ORG') &&
      item.status !== 'Done' &&
      item.status !== 'Skipped'
    ) {
      blockedSteps.push(item);
    }
  }

  const orgPct = pctDone(orgItems);
  const entityValues = Object.values(entityPct);
  const overallPct = Math.round(
    (orgPct + entityValues.reduce((a, b) => a + b, 0)) /
      (1 + entityValues.length),
  );

  const productionUnlocked =
    orgPct === 100 && entityValues.every((p) => p === 100);

  return {
    orgPct,
    entityPct,
    overallPct,
    productionUnlocked,
    blockedSteps,
  };
}

/** Gate Send Invoice / Pay Bill / Enable Feed until required steps Done. */
export function canEnableProductionAction(
  checklist: SetupChecklistItem[],
  entityCode: EntityCode,
  action: 'send_invoice' | 'pay_bill' | 'enable_feed',
): { allowed: boolean; reason?: string } {
  const progress = computeGoLiveProgress(checklist);
  if (progress.productionUnlocked) return { allowed: true };

  const entityItems = checklist.filter((i) => i.entityCode === entityCode);
  const requiredIncomplete = entityItems.filter(
    (i) =>
      isRequired(i.stepId, entityCode) &&
      i.status !== 'Done' &&
      i.status !== 'Skipped',
  );

  if (action === 'send_invoice') {
    const att = entityItems.find((i) => i.stepId === 'ENT-06');
    if (att && att.status !== 'Done') {
      return {
        allowed: false,
        reason: 'Upload Wire + I-9 attachment PDFs (ENT-06) before sending invoices.',
      };
    }
  }

  if (action === 'enable_feed') {
    const feed = entityItems.find((i) => i.stepId === 'ENT-03');
    if (feed && feed.status !== 'Done') {
      return {
        allowed: false,
        reason: 'Complete bank feed setup wizard (ENT-03) first.',
      };
    }
  }

  if (requiredIncomplete.length > 0) {
    return {
      allowed: false,
      reason: `Complete go-live steps for ${entityCode} (${requiredIncomplete[0].stepId}…).`,
    };
  }

  return { allowed: true };
}

export function markStepDone(
  checklist: SetupChecklistItem[],
  entityCode: EntityCode | 'ORG',
  stepId: string,
  completedBy = 'system',
): SetupChecklistItem[] {
  return checklist.map((item) =>
    item.entityCode === entityCode && item.stepId === stepId
      ? {
          ...item,
          status: 'Done' as const,
          completedAt: new Date().toISOString(),
          completedBy,
        }
      : item,
  );
}
