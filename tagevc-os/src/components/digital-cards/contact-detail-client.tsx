'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { NetworkContact } from '@/lib/digital-cards/types';
import { entityDisplayName } from '@/lib/entities/display-name';
import {
  addGeneralInterestFromContactAction,
  createClientLeadFromContactAction,
  markContactFollowedUpAction,
} from '@/app/(app)/my-card/actions';

export function ContactDetailClient({ contact }: { contact: NetworkContact }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const isRecruit = contact.entity_id === 'ENT-R619';

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <Link
        href="/my-card/contacts"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Contacts
      </Link>
      <h1 className="mt-3 font-heading text-3xl font-semibold text-[#3B4559]">
        {contact.name}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {[contact.title, contact.company].filter(Boolean).join(' · ') ||
          'Network contact'}
      </p>

      <dl className="mt-6 space-y-3 rounded-2xl border border-[#e0dcd2] bg-white p-5 text-sm">
        <Row label="Email" value={contact.email} />
        <Row label="Phone" value={contact.phone} />
        <Row label="Company" value={entityDisplayName(contact.entity_id)} />
        <Row label="Source" value={contact.source_channel} />
        <Row label="How we met" value={contact.meeting_context} />
        <Row label="Their notes" value={contact.their_notes} />
        <Row label="Status" value={contact.status} />
        {contact.routing_suggestion ? (
          <Row
            label="Suggested routing"
            value={`${contact.routing_suggestion.action} · ${contact.routing_suggestion.confidence} — ${contact.routing_suggestion.reason}`}
          />
        ) : null}
        {contact.linked_client_lead_id ? (
          <Row label="Client lead" value={contact.linked_client_lead_id} />
        ) : null}
        {contact.linked_candidate_id ? (
          <Row
            label="General interest"
            value={contact.linked_candidate_id}
          />
        ) : null}
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className="h-10 rounded-xl bg-[#3B4559] px-4 text-sm font-semibold text-white disabled:opacity-60"
          onClick={() =>
            startTransition(async () => {
              const res = await markContactFollowedUpAction(contact.id);
              setMsg(res.ok ? 'Marked followed up' : res.error);
              router.refresh();
            })
          }
        >
          Mark followed up
        </button>

        {isRecruit ? (
          <>
            <button
              type="button"
              disabled={pending}
              className="h-10 rounded-xl border border-[#B2A384] bg-[#B2A384]/20 px-4 text-sm font-semibold text-[#3B4559] disabled:opacity-60"
              onClick={() => {
                if (
                  !window.confirm(
                    'Create / link a Client Lead from this contact? Human confirmation required.',
                  )
                ) {
                  return;
                }
                startTransition(async () => {
                  const res = await createClientLeadFromContactAction({
                    contactId: contact.id,
                    confirm: true,
                  });
                  setMsg(
                    res.ok
                      ? `Linked client lead ${res.lead_id}`
                      : res.error,
                  );
                  router.refresh();
                });
              }}
            >
              Create Client Lead
            </button>
            <button
              type="button"
              disabled={pending}
              className="h-10 rounded-xl border border-[#d7d3c3] px-4 text-sm font-semibold text-[#3B4559] disabled:opacity-60"
              onClick={() => {
                if (
                  !window.confirm(
                    'Add as Candidate general interest? Human confirmation required.',
                  )
                ) {
                  return;
                }
                startTransition(async () => {
                  const res = await addGeneralInterestFromContactAction({
                    contactId: contact.id,
                    confirm: true,
                  });
                  setMsg(
                    res.ok
                      ? `Linked general interest ${res.candidate_id}`
                      : res.error,
                  );
                  router.refresh();
                });
              }}
            >
              Add General Interest
            </button>
          </>
        ) : null}
      </div>
      {msg ? <p className="mt-3 text-sm text-[#3B4559]">{msg}</p> : null}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[#3B4559]">{value}</dd>
    </div>
  );
}
