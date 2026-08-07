import { notFound, redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/rbac/session';
import { getMyContact } from '@/lib/digital-cards/repo';
import { ContactDetailClient } from '@/components/digital-cards/contact-detail-client';

type Props = { params: Promise<{ id: string }> };

export default async function ContactDetailPage({ params }: Props) {
  const ctx = await getSessionContext();
  if (!ctx?.profile?.id) redirect('/login');
  const { id } = await params;
  const contact = await getMyContact(ctx.profile.id, id);
  if (!contact) notFound();
  return <ContactDetailClient contact={contact} />;
}
