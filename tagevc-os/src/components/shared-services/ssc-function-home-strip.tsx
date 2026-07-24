import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { SscFunction } from '@/lib/shared-services/ssc-checklist/types';
import { functionLabel } from '@/lib/shared-services/ssc-checklist/types';

type Props = {
  functionKey: SscFunction;
  entityId?: string | null;
};

/** Additive operating-home strip — does not replace existing module UIs. */
export function SscFunctionHomeStrip({ functionKey, entityId }: Props) {
  const qs = new URLSearchParams({
    function: functionKey,
    scope: entityId ? 'single' : 'parent_subs',
    period: 'monthly',
    time: 'current',
  });
  if (entityId) qs.set('entity', entityId);

  return (
    <Card className="border-[#d8dde6] bg-[#f7f8fa]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {functionLabel(functionKey)} · SSC operating home
        </CardTitle>
        <CardDescription>
          Period checklists, overdue/at-risk work, audits, AI recommendations,
          and company scope — Tage Shared Services Center.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3 text-sm">
        <Link
          href={`/shared-services/checklists?${qs.toString()}`}
          className="font-medium text-[#3a414f] underline-offset-2 hover:underline"
        >
          Open checklists
        </Link>
        <Link
          href={`/shared-services/audits?function=${functionKey}&scope=${entityId ? 'single' : 'parent_subs'}${entityId ? `&entity=${entityId}` : ''}`}
          className="font-medium text-[#3a414f] underline-offset-2 hover:underline"
        >
          Startup / annual audits
        </Link>
        <Link
          href="/shared-services"
          className="text-muted-foreground underline-offset-2 hover:underline"
        >
          Shared Services hub
        </Link>
      </CardContent>
    </Card>
  );
}
