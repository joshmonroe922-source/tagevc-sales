import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { BankConnectClient } from '@/components/af/bank-connect-client';
import {
  AF_PERSONAL_BANKS,
  detectFeedCredentials,
  getCoa,
  getPlaidPersonalRedirectUri,
  listPersonalBankConnections,
} from '@/lib/af';
import { requirePersonalVisionary } from '@/lib/personal/access';

export default async function PersonalBankConnectPage() {
  await requirePersonalVisionary();
  const creds = detectFeedCredentials();
  const connections = await listPersonalBankConnections();
  const feedBanks = AF_PERSONAL_BANKS.filter((b) => b.feedEnabled);

  const rows = feedBanks.map((b) => {
    const c = connections.find((x) => x.bankAccountId === b.id);
    const coaName =
      getCoa('PERS').find((a) => a.number === b.glAccount)?.name ?? null;
    return {
      bankAccountId: b.id,
      name: b.name,
      entityCode: 'PERS',
      glAccount: b.glAccount,
      bankType: b.type,
      coaName,
      status: c?.status ?? 'not_connected',
      stubMode: c?.stubMode ?? !creds.ready,
      accountMask: c?.accountMask,
      lastSyncAt: c?.lastSyncAt,
    };
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal Finance · Private"
        title="Connect personal banks"
        description="Same Plaid Link as A&F — maps to PERS books only (not company consolidation)."
        secondaryActions={
          <AfBackLink href="/personal/finance/accounts" label="Accounts" />
        }
        context="Visionary only"
      />
      <BankConnectClient
        variant="personal"
        rows={rows}
        mapTargets={rows}
        credentialsReady={creds.ready}
        missingSecrets={creds.missing}
        redirectUri={getPlaidPersonalRedirectUri()}
      />
      <p className="text-sm text-muted-foreground">
        Provider mode: <StatusPill status={creds.ready ? 'Ready' : 'Stub'} /> ·
        books_id=PERS
      </p>
      <p className="text-xs text-muted-foreground">
        Plaid Allowed redirect URI must include:{' '}
        <span className="font-mono">{getPlaidPersonalRedirectUri()}</span>
      </p>
    </div>
  );
}
