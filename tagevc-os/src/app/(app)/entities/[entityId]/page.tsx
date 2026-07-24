import { notFound } from 'next/navigation';
import { EntityOperatingViewPanel } from '@/components/entity-os/entity-operating-view';
import { getEntityOperatingView } from '@/lib/data/entity-os';
import { onCompanyOnboardedToSsc } from '@/lib/shared-services/ssc-checklist/engine';

type Props = { params: Promise<{ entityId: string }> };

export default async function EntityOsPage({ params }: Props) {
  const { entityId } = await params;
  const view = await getEntityOperatingView(entityId);
  if (!view) notFound();

  // Additive: ensure startup + annual SSC audits when a company is opened
  try {
    await onCompanyOnboardedToSsc({ entity_id: entityId });
  } catch {
    // fail-soft
  }

  return <EntityOperatingViewPanel view={view} />;
}
