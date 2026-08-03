import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { requirePermission } from '@/lib/rbac/session';
import { ContactEditForm } from '@/components/crm/contact-edit-form';
import { ContactSequencesPanel } from '@/components/campaign/contact-sequences-panel';

type Props = { params: Promise<{ id: string }> };

export default async function CrmContactPage({ params }: Props) {
  await requirePermission('read:shared_services');
  const { id } = await params;
  const sb = await createPersistClient();
  const { data: contact } = await sb
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!contact) notFound();

  const { data: provenance } = await sb
    .from('field_provenance')
    .select('field_name, source, locked, confidence')
    .eq('entity_type', 'contact')
    .eq('entity_id', id);

  const { data: suggestions } = await sb
    .from('suggested_updates')
    .select('id, field_name, suggested_value, confidence, rationale, status')
    .eq('entity_id', id)
    .eq('status', 'pending')
    .limit(20);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow="CRM"
        title={contact.full_name}
        description={[contact.title, contact.primary_email, contact.enrich_status]
          .filter(Boolean)
          .join(' · ')}
      />
      <Link
        href="/shared-services/crm"
        className="text-sm underline underline-offset-2"
      >
        ← CRM
      </Link>

      {(suggestions ?? []).length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium">Pending agent suggestions</p>
          <ul className="mt-2 space-y-1 text-xs">
            {(suggestions ?? []).map((s) => (
              <li key={s.id}>
                {s.field_name}: {s.suggested_value}{' '}
                <span className="text-muted-foreground">
                  ({s.rationale || 'agent'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ContactEditForm
        contactId={id}
        initial={{
          full_name: contact.full_name,
          primary_email: contact.primary_email,
          title: contact.title,
          department: contact.department,
          location: contact.location,
          linkedin_url: contact.linkedin_url,
        }}
      />

      <ContactSequencesPanel contactId={id} />

      <section className="rounded-md border border-border p-4 text-sm">
        <h2 className="mb-2 font-semibold">Field provenance</h2>
        {(provenance ?? []).length === 0 ? (
          <p className="text-muted-foreground">No provenance rows yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {(provenance ?? []).map((p) => (
              <li key={p.field_name}>
                <span className="font-medium">{p.field_name}</span> ·{' '}
                {p.source}
                {p.locked ? ' · locked' : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
