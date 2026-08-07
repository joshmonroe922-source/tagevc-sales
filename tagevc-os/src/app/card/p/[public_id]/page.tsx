import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicCardView } from '@/components/digital-cards/public-card-view';
import {
  getPersonaByPublicId,
  getTemplate,
  recordCardEvent,
} from '@/lib/digital-cards/repo';
import { toPublicCardPayload } from '@/lib/digital-cards/public-payload';
import { parseSourceChannel, publicCardUrl } from '@/lib/digital-cards/urls';
import { hashedIpMeta } from '@/lib/digital-cards/rate-limit';
import { entityDisplayName } from '@/lib/entities/display-name';

type PageProps = {
  params: Promise<{ public_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { public_id } = await params;
  const persona = await getPersonaByPublicId(public_id, { service: true });
  if (!persona) return { title: 'Card' };
  const company = entityDisplayName(persona.entity_id);
  if (persona.revoked_at || !persona.is_active) {
    return {
      title: company,
      description: `No longer with ${company}`,
      robots: { index: false, follow: false },
    };
  }
  return {
    title: `${persona.display_name} · ${company}`,
    description: persona.title
      ? `${persona.title} at ${company}`
      : company,
    openGraph: {
      title: persona.display_name,
      description: `${persona.title} · ${company}`,
      url: publicCardUrl(persona.public_id),
    },
  };
}

export default async function PublicCardPage({
  params,
  searchParams,
}: PageProps) {
  const { public_id } = await params;
  const sp = await searchParams;
  const srcRaw = typeof sp.src === 'string' ? sp.src : null;
  const sourceChannel = parseSourceChannel(srcRaw);
  const entryPath = `/card/p/${public_id}${srcRaw ? `?src=${srcRaw}` : ''}`;

  const persona = await getPersonaByPublicId(public_id, { service: true });
  if (!persona) notFound();

  const template = await getTemplate(persona.entity_id, { service: true });
  const card = toPublicCardPayload(persona, template, { src: sourceChannel });

  // Fail-soft analytics
  void recordCardEvent({
    personaId: persona.id,
    entityId: persona.entity_id,
    eventType: card.revoked ? 'revoke_hit' : 'view',
    sourceChannel,
    meta: { path: entryPath, ip_hash: hashedIpMeta(null) },
    service: true,
  });

  return (
    <PublicCardView
      card={card}
      sourceChannel={sourceChannel}
      entryPath={entryPath}
    />
  );
}
