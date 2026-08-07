import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/rbac/session';
import { listMyContacts, listMyPersonas } from '@/lib/digital-cards/repo';
import { MyCardClient } from '@/components/digital-cards/my-card-client';
import { activatePersona } from '@/lib/digital-cards/repo';

export default async function MyCardPage() {
  const ctx = await getSessionContext();
  if (!ctx?.profile?.id) redirect('/login?next=/my-card');

  let personas = await listMyPersonas(ctx.profile.id);
  if (!personas.length) {
    // Soft auto-activate so every user has a card entry point
    const res = await activatePersona({
      userProfileId: ctx.profile.id,
      entityId: ctx.profile.entity_id || 'ENT-FIRM',
      displayName: ctx.profile.full_name || ctx.profile.email,
      title: ctx.profile.job_title || undefined,
      workEmail: ctx.profile.email || undefined,
      setDefault: true,
    });
    if (res.ok) personas = [res.persona];
  }

  // Visionary / firm operators: ensure a Tage VC (ENT-FIRM) persona exists
  // as the shareable default even when home profile entity is a subsidiary.
  const hasFirm = personas.some(
    (p) => p.entity_id === 'ENT-FIRM' && p.is_active && !p.revoked_at,
  );
  if (
    !hasFirm &&
    ['visionary', 'admin', 'coo', 'partner'].includes(ctx.profile.role || '')
  ) {
    const firm = await activatePersona({
      userProfileId: ctx.profile.id,
      entityId: 'ENT-FIRM',
      displayName: ctx.profile.full_name || ctx.profile.email,
      title: ctx.profile.job_title || undefined,
      workEmail: ctx.profile.email || undefined,
      setDefault: true,
    });
    if (firm.ok) {
      personas = await listMyPersonas(ctx.profile.id);
    }
  }

  const contacts = await listMyContacts(ctx.profile.id, 20);

  return (
    <MyCardClient
      personas={personas}
      contacts={contacts}
      userName={ctx.profile.full_name || ctx.profile.email}
    />
  );
}
