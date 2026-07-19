import { notFound } from 'next/navigation';
import { EntityOperatingViewPanel } from '@/components/entity-os/entity-operating-view';
import { getEntityOperatingView } from '@/lib/data/entity-os';
import { getPortfolioCompanyById } from '@/lib/data/repositories';

type Props = { params: Promise<{ portfolioId: string }> };

export default async function PortfolioCompanyPage({ params }: Props) {
  const { portfolioId } = await params;
  const detail = await getPortfolioCompanyById(portfolioId);
  if (!detail) notFound();

  const view = await getEntityOperatingView(detail.entity_id);
  if (!view) notFound();

  return (
    <EntityOperatingViewPanel
      view={view}
      backHref="/portfolio"
      backLabel="← Portfolio Active"
    />
  );
}
