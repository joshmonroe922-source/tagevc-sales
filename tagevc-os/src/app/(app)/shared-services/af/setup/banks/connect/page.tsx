import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { BankConnectClient } from '@/components/af/bank-connect-client';
import {
  AF_BANKS,
  detectFeedCredentials,
  getCoa,
  getPlaidRedirectUri,
  listBankConnections,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function BankConnectPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const creds = detectFeedCredentials();
  const connections = await listBankConnections();

  // Connect list may be entity-scoped; map dropdown must always be full MD banks.
  const connectBanks = entityId
    ? AF_BANKS.filter((b) => b.entityCode === entityId && b.feedEnabled)
    : AF_BANKS.filter((b) => b.feedEnabled);
  const allFeedBanks = AF_BANKS.filter((b) => b.feedEnabled);

  const toRow = (b: (typeof AF_BANKS)[number]) => {
    const c = connections.find((x) => x.bankAccountId === b.id);
    const coaName =
      getCoa(b.entityCode).find((a) => a.number === b.glAccount)?.name ?? null;
    return {
      bankAccountId: b.id,
      name: b.name,
      entityCode: b.entityCode,
      glAccount: b.glAccount,
      bankType: b.type,
      coaName,
      status: c?.status ?? 'not_connected',
      stubMode: c?.stubMode ?? !creds.ready,
      accountMask: c?.accountMask,
      lastSyncAt: c?.lastSyncAt,
    };
  };

  const rows = connectBanks.map(toRow);
  const mapTargets = allFeedBanks.map(toRow);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Setup · Bank feeds"
        title="Connect bank & card feeds"
        description="1) Choose MD bank account  2) Connect provider (Plaid/MX/Unit)  3) Select last4  4) Map to bank_account_id  5) Test import → ENT-03 Done."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/setup${qs}`} label="Setup" />
        }
      />
      <BankConnectClient
        rows={rows}
        mapTargets={mapTargets}
        credentialsReady={creds.ready}
        missingSecrets={creds.missing}
        redirectUri={getPlaidRedirectUri()}
      />
      <p className="text-sm text-muted-foreground">
        Provider mode: <StatusPill status={creds.ready ? 'Ready' : 'Stub'} /> ·
        Spec ENT-03
      </p>
    </div>
  );
}
