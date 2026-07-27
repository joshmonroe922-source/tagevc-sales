import { Suspense } from 'react';
import { SscFunctionHomeChrome } from '@/components/shared-services/ssc-function-home-chrome';
import { Skeleton } from '@/components/ui/skeleton';
import { getSscFunctionHomeGlance } from '@/lib/shared-services/ssc-checklist/function-home-glance';
import type { SscFunction } from '@/lib/shared-services/ssc-checklist/types';

const PURPOSES: Record<SscFunction, string> = {
  finance:
    'Cash, close, exceptions, and subsidiary financial health for the selected company and period.',
  hr: 'Headcount, JML, onboarding risk, and HR compliance for the selected company and period.',
  it: 'Security, access, assets, licenses, and incidents for the selected company and period.',
  marketing:
    'Pipeline quality, campaigns, channel ROI, and brand ops for the selected company and period.',
  legal:
    'Matters, contracts, counsel deadlines, and legal compliance for the selected company and period.',
};

type Props = {
  functionKey: SscFunction;
  entityId?: string | null;
  firmWide?: boolean;
};

async function ChromeInner({ functionKey, entityId, firmWide }: Props) {
  const glance = await getSscFunctionHomeGlance({
    functionKey,
    entityId: entityId || null,
  });
  return (
    <SscFunctionHomeChrome
      functionKey={functionKey}
      entityId={entityId}
      firmWide={firmWide}
      glance={glance}
      purpose={PURPOSES[functionKey]}
    />
  );
}

function ChromeFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading function home">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** Server entry for consistent SSC function homes (list region skeletons only). */
export function SscFunctionHomeChromeServer(props: Props) {
  return (
    <Suspense fallback={<ChromeFallback />}>
      <ChromeInner {...props} />
    </Suspense>
  );
}
