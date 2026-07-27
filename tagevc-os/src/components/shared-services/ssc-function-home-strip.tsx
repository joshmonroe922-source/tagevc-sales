import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
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

function checklistHref(
  functionKey: SscFunction,
  entityId: string | null | undefined,
  extra?: Record<string, string>,
) {
  const qs = new URLSearchParams({
    function: functionKey,
    scope: entityId ? 'single' : 'parent_subs',
    period: 'monthly',
    time: 'active',
    ...extra,
  });
  if (entityId) qs.set('entity', entityId);
  return `/shared-services/checklists?${qs.toString()}`;
}

/** Compact operating-home strip on each function page. */
export function SscFunctionHomeStrip({ functionKey, entityId }: Props) {
  const base = checklistHref(functionKey, entityId);
  const overdue = checklistHref(functionKey, entityId, {
    overdue: '1',
  });
  const open = checklistHref(functionKey, entityId);

  return (
    <Card className="border-[#d8dde6] bg-[#f7f8fa]">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">SSC</Badge>
          <CardTitle className="text-base">
            {functionLabel(functionKey)} operating home
          </CardTitle>
        </div>
        <CardDescription>
          Cadence checklists and audits for this function — Tage Shared Services
          Center. Start with Active / Overdue for daily work.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link
          href={base}
          className="font-medium text-[#3a414f] underline-offset-2 hover:underline"
        >
          Active
        </Link>
        <Link
          href={overdue}
          className="font-medium text-[#3a414f] underline-offset-2 hover:underline"
        >
          Overdue
        </Link>
        <Link
          href={open}
          className="font-medium text-[#3a414f] underline-offset-2 hover:underline"
        >
          Open tasks
        </Link>
        <Link
          href={`/shared-services/audits?function=${functionKey}&scope=${entityId ? 'single' : 'parent_subs'}${entityId ? `&entity=${entityId}` : ''}`}
          className="font-medium text-[#3a414f] underline-offset-2 hover:underline"
        >
          Audits
        </Link>
        <Link
          href="/shared-services"
          className="text-muted-foreground underline-offset-2 hover:underline"
        >
          SSC hub
        </Link>
      </CardContent>
    </Card>
  );
}
