import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import {
  getSscFunctionCapabilities,
  type SscCapability,
} from '@/lib/shared-services/function-capabilities';
import {
  functionLabel,
  type SscFunction,
} from '@/lib/shared-services/ssc-checklist/types';
import { VIEW_MODE_DEFAULTS } from '@/lib/view-mode';

type Props = {
  functionKey: SscFunction;
  entityId?: string | null;
};

function CapabilityCard({ item }: { item: SscCapability }) {
  return (
    <Link href={item.href} className="block h-full">
      <Card className="h-full transition-colors hover:border-[#3a414f]/35">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {item.badge ? (
              <Badge variant="outline">{item.badge}</Badge>
            ) : null}
          </div>
          <CardTitle className="font-heading text-base">{item.title}</CardTitle>
          <CardDescription>{item.description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

/**
 * Overview of tools/capabilities inside one SSC function —
 * sits with period chrome so homes are more than task lists.
 */
export function SscFunctionCapabilities({ functionKey, entityId }: Props) {
  const items = getSscFunctionCapabilities(functionKey, entityId);
  const surface = `ssc-capabilities-${functionKey}` as const;

  return (
    <section className="space-y-3" aria-label={`${functionLabel(functionKey)} capabilities`}>
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          In this service
        </h2>
        <p className="text-sm text-muted-foreground">
          All {functionLabel(functionKey)} capabilities — open a tool, or work
          period tasks below.
        </p>
      </div>
      <ViewModeLayout
        surface={surface}
        defaultMode={VIEW_MODE_DEFAULTS['shared-services-functions']}
        cards={
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <CapabilityCard key={item.id} item={item} />
            ))}
          </div>
        }
        list={
          <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
            {items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="font-medium text-[#3a414f]">{item.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {item.description}
                  </p>
                </div>
                {item.badge ? (
                  <Badge variant="outline">{item.badge}</Badge>
                ) : null}
              </Link>
            ))}
          </div>
        }
      />
    </section>
  );
}
