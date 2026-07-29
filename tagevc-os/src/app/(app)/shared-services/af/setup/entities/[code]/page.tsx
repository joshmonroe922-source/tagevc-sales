import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { CompleteStepButton } from '@/components/af/complete-step-button';
import { AF_ENTITIES, AF_GO_LIVE, getAfStore, getSetupProgress } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';
import type { EntityCode } from '@/lib/af';

type Props = {
  params: Promise<{ code: string }>;
  searchParams?: Promise<{ entity?: string }>;
};

export default async function EntitySetupPage({ params, searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { code } = await params;
  const { qs } = await resolveAfEntityParam(searchParams);
  const entity = AF_ENTITIES.find((e) => e.code === code);
  if (!entity) notFound();
  const store = getAfStore();
  const progress = getSetupProgress();
  const items = store.checklist.filter((i) => i.entityCode === code);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Go-Live · Entity"
        title={entity.legalName}
        context={`${code} · ${progress.entityPct[code as EntityCode]}% complete`}
        description="ENT-01…14 checklist. Wire + I-9 uploads (ENT-06) gate invoice send."
        secondaryActions={<AfBackLink href={`/shared-services/af/setup${qs}`} label="Setup" />}
      />
      <ul className="space-y-2">
        {items.map((item) => {
          const meta = AF_GO_LIVE.entity.find((s) => s.id === item.stepId);
          return (
            <li key={item.stepId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#3a414f]">{item.stepId} · {meta?.action}</p>
                <p className="text-xs text-muted-foreground">{meta?.ssot}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={item.status} />
                {item.status !== 'Done' && (
                  <CompleteStepButton entityCode={code as EntityCode} stepId={item.stepId} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
