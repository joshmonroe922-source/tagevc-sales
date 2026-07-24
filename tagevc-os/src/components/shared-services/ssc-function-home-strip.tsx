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

/** Compact operating-home strip on each function page. */
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
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">SSC</Badge>
          <CardTitle className="text-base">
            {functionLabel(functionKey)} operating home
          </CardTitle>
        </div>
        <CardDescription>
          Cadence checklists and audits for this function — Tage Shared Services
          Center.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-4 text-sm">
        <Link
          href={`/shared-services/checklists?${qs.toString()}`}
          className="font-medium text-[#3a414f] underline-offset-2 hover:underline"
        >
          Period checklist
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
