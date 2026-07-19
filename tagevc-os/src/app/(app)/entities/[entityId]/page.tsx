import { notFound } from 'next/navigation';
import { EntityOperatingViewPanel } from '@/components/entity-os/entity-operating-view';
import { getEntityOperatingView } from '@/lib/data/entity-os';

type Props = { params: Promise<{ entityId: string }> };

export default async function EntityOsPage({ params }: Props) {
  const { entityId } = await params;
  const view = await getEntityOperatingView(entityId);
  if (!view) notFound();

  return <EntityOperatingViewPanel view={view} />;
}
