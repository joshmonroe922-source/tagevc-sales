import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { CompleteStepButton } from '@/components/af/complete-step-button';
import { AF_ENTITIES, AF_GO_LIVE, getAfStore, getSetupProgress } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function SetupPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  const progress = getSetupProgress();

  const orgItems = store.checklist.filter((i) => i.entityCode === 'ORG');

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Tage VC A&F · Go-Live"
        title="Setup coach"
        description="Gates production sends/payments until ORG + entity required steps are Done. Future entities clone this checklist automatically."
        secondaryActions={<AfBackLink href={`/shared-services/af${qs}`} label="Tage VC A&F" />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-gradient-to-b from-white to-[#f3f5f8] px-4 py-3">
          <p className="text-xs uppercase text-muted-foreground">Org</p>
          <p className="font-heading text-2xl font-semibold text-[#3a414f]">{progress.orgPct}%</p>
        </div>
        {AF_ENTITIES.map((e) => (
          <Link key={e.code} href={`/shared-services/af/setup/entities/${e.code}${qs}`}
            className="rounded-xl border border-border px-4 py-3 hover:bg-muted/30">
            <p className="text-xs uppercase text-muted-foreground">{e.code}</p>
            <p className="font-heading text-2xl font-semibold text-[#3a414f]">{progress.entityPct[e.code]}%</p>
            <p className="mt-1 text-xs text-muted-foreground">{e.legalName}</p>
          </Link>
        ))}
      </div>

      {!progress.productionUnlocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          Production sends/payments remain gated until all required steps are complete ({progress.overallPct}% overall).
        </div>
      )}
      {progress.productionUnlocked && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950">
          Production unlocked — invoice send, bill pay, and feeds enabled.
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">Org-level steps</h2>
        <ul className="space-y-2">
          {orgItems.map((item) => {
            const meta = AF_GO_LIVE.org.find((s) => s.id === item.stepId);
            return (
              <li key={item.stepId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[#3a414f]">{item.stepId} · {meta?.action}</p>
                  <p className="text-xs text-muted-foreground">{meta?.ssot}{meta?.required ? ' · required' : ' · recommended'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={item.status} />
                  {item.status !== 'Done' && (
                    <CompleteStepButton entityCode="ORG" stepId={item.stepId} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-sm text-muted-foreground">
        Bank feed OAuth walkthrough: <Link href={`/shared-services/af/setup/banks/connect${qs}`} className="underline underline-offset-2">/setup/banks/connect</Link>
      </p>
    </div>
  );
}
