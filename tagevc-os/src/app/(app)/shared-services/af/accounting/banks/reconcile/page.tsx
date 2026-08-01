import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink } from '@/components/af/af-ui';
import { ReconcileQueue } from '@/components/af/reconcile-queue';
import { getAfStore, getCoa, runCategorizationRules } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';
import type { EntityCode } from '@/lib/af';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function ReconcilePage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, qs } = await resolveAfEntityParam(searchParams);
  // Ensure suggestions are fresh when opening reconcile
  runCategorizationRules();
  const store = getAfStore();
  const feeds = entityId
    ? store.feedTxns.filter((t) => t.entityCode === entityId)
    : store.feedTxns;

  const matched = feeds
    .filter((t) => t.status === 'Matched')
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: t.amount,
      entityCode: t.entityCode,
      bankAccountId: t.bankAccountId,
      status: t.status,
      suggestedAccount: t.suggestedAccount,
      suggestedConfidence: t.suggestedConfidence,
      matchedPaymentId: t.matchedPaymentId,
      journalId: t.journalId,
      excludedReason: t.excludedReason,
    }));
  const exceptions = feeds
    .filter((t) => t.status === 'Unmatched')
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: t.amount,
      entityCode: t.entityCode,
      bankAccountId: t.bankAccountId,
      status: t.status,
      suggestedAccount: t.suggestedAccount,
      suggestedConfidence: t.suggestedConfidence,
      matchedPaymentId: t.matchedPaymentId,
      journalId: t.journalId,
      excludedReason: t.excludedReason,
    }));
  const excluded = feeds
    .filter((t) => t.status === 'Excluded')
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: t.amount,
      entityCode: t.entityCode,
      bankAccountId: t.bankAccountId,
      status: t.status,
      suggestedAccount: t.suggestedAccount,
      suggestedConfidence: t.suggestedConfidence,
      matchedPaymentId: t.matchedPaymentId,
      journalId: t.journalId,
      excludedReason: t.excludedReason,
    }));

  const entities = (
    entityId ? [entityId] : ['TVC', 'R619', 'SHR', 'INDA']
  ) as EntityCode[];
  const coaByEntity: Record<
    string,
    Array<{ number: string; name: string; type: string }>
  > = {};
  for (const code of entities) {
    coaByEntity[code] = getCoa(code).map((a) => ({
      number: a.number,
      name: a.name,
      type: a.type,
    }));
  }

  const openBills = store.bills
    .filter((b) => b.status !== 'Paid' && b.status !== 'Rejected')
    .filter((b) => !entityId || b.entityCode === entityId)
    .map((b) => ({
      id: b.id,
      number: b.number,
      vendorName: b.vendorName,
      entityCode: b.entityCode,
      remaining: b.amount - b.amountPaid,
    }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Banks · Reconcile"
        title="Bank reconciliation"
        description="Exception queue: accept CoA suggestion, pick account, confirm bill (PATH B), or exclude. Matched payment links never re-post AP."
        secondaryActions={
          <AfBackLink
            href={`/shared-services/af/accounting/banks${qs}`}
            label="Banks"
          />
        }
      />
      <ReconcileQueue
        matched={matched}
        exceptions={exceptions}
        excluded={excluded}
        coaByEntity={coaByEntity}
        openBills={openBills}
      />
      <p className="text-xs text-muted-foreground">
        Receipt OCR is staged for a later slice — card receipt matching will
        attach via AP uploads once OCR lands.
      </p>
    </div>
  );
}
