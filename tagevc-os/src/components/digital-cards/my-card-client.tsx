'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import type {
  DigitalCardPersona,
  NetworkContact,
} from '@/lib/digital-cards/types';
import { entityDisplayName } from '@/lib/entities/display-name';
import { taggedCardUrl, nfcUrl } from '@/lib/digital-cards/urls';
import { qrImageUrl, TAGGED_QR_SOURCES, qrDownloadFilename } from '@/lib/digital-cards/qr';
import { TAGE_GOLD, TAGE_NAVY } from '@/lib/digital-cards/theme';
import { WalletButtons } from '@/components/digital-cards/wallet-buttons';
import { PersonaContactPanel } from '@/components/digital-cards/persona-contact-panel';
import {
  draftThankYouNoteAction,
  ensureMyCardAction,
  updatePersonaAction,
} from '@/app/(app)/my-card/actions';

type Props = {
  personas: DigitalCardPersona[];
  contacts: NetworkContact[];
  userName: string;
};

export function MyCardClient({ personas: initial, contacts, userName }: Props) {
  const [personas, setPersonas] = useState(initial);
  const [selectedId, setSelectedId] = useState(
    initial.find((p) => p.is_default)?.id || initial[0]?.id || '',
  );
  const [qrOpen, setQrOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editFocus, setEditFocus] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  function openEditor(focus?: string) {
    setEditFocus(focus);
    setEditing(true);
    requestAnimationFrame(() => {
      const el = document.getElementById('persona-editor');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (focus) {
        const field = document.getElementById(`edit-${focus}`);
        field?.focus();
      }
    });
  }

  const persona = useMemo(
    () => personas.find((p) => p.id === selectedId) || personas[0],
    [personas, selectedId],
  );

  if (!persona) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="font-heading text-3xl font-semibold text-[#3B4559]">
          My Card
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Activate your first digital card to share a live profile and QR.
        </p>
        <button
          type="button"
          disabled={pending}
          className="mt-6 inline-flex h-11 items-center rounded-xl bg-[#3B4559] px-5 text-sm font-semibold text-white"
          onClick={() =>
            startTransition(async () => {
              const res = await ensureMyCardAction();
              if (res.ok) {
                setPersonas(res.personas);
                setSelectedId(res.personas[0]?.id || '');
              } else {
                setMsg(res.error);
              }
            })
          }
        >
          Activate My Card
        </button>
        {msg ? <p className="mt-3 text-sm text-red-600">{msg}</p> : null}
      </div>
    );
  }

  const link = taggedCardUrl(persona.public_id, 'in_app');
  const company = entityDisplayName(persona.entity_id);
  const newCount = contacts.filter((c) => c.status === 'new').length;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`${label} copied`);
    } catch {
      window.prompt(label, text);
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${persona!.display_name} · ${company}`,
          url: link,
        });
        return;
      } catch {
        /* fall through */
      }
    }
    await copy(link, 'Link');
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-[#B2A384] uppercase">
            {company}
          </p>
          <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight text-[#3B4559]">
            My Card
          </h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Live profile behind a stable QR — update once, share everywhere.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link
            href="/my-card/contacts"
            className="inline-flex items-center gap-2 rounded-lg border border-[#e0dcd2] bg-white px-3 py-1.5 text-sm font-medium text-[#3B4559] hover:bg-[#faf8f4]"
          >
            Network inbox
            {newCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#3B4559] px-1.5 text-[11px] font-semibold text-white">
                {newCount > 99 ? '99+' : newCount}
              </span>
            ) : null}
          </Link>
          <Link
            href="/settings/notifications"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Settings
          </Link>
        </div>
      </header>

      {personas.length > 1 ? (
        <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {personas.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition ${
                p.id === persona.id
                  ? 'bg-[#3B4559] text-white'
                  : 'bg-[#e8e4dc] text-[#3B4559]'
              }`}
            >
              {entityDisplayName(p.entity_id)}
              {p.is_default ? ' · default' : ''}
            </button>
          ))}
        </div>
      ) : null}

      <section
        className="mt-8 overflow-hidden rounded-[1.5rem]"
        style={{
          background: `linear-gradient(145deg, ${TAGE_NAVY} 0%, #2f3848 55%, ${TAGE_GOLD}55 140%)`,
        }}
      >
        <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="min-w-0 text-white">
            <div className="flex items-center gap-4">
              {persona.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={persona.photo_url}
                  alt=""
                  className="size-16 rounded-2xl object-cover ring-2 ring-white/30"
                />
              ) : (
                <div
                  className="flex size-16 items-center justify-center rounded-2xl text-xl font-semibold"
                  style={{ background: TAGE_GOLD, color: TAGE_NAVY }}
                >
                  {userName
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase())
                    .join('') || '·'}
                </div>
              )}
              <div>
                <h2 className="font-heading text-2xl font-semibold tracking-tight">
                  {persona.display_name}
                </h2>
                <p className="text-sm text-white/75">
                  {persona.title || 'Add your title'}
                </p>
                {persona.revoked_at ? (
                  <p className="mt-1 text-xs text-amber-200">Revoked</p>
                ) : null}
              </div>
            </div>
            <p className="mt-4 break-all font-mono text-[11px] text-white/50">
              {link}
            </p>
          </div>

          <a
            href={link}
            className="mx-auto block shrink-0 rounded-2xl bg-white p-3 shadow-lg transition hover:scale-[1.02] md:mx-0"
            title="Tappable QR — opens your public card"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrImageUrl(persona.public_id, 'in_app', 360)}
              alt="Your QR"
              className="size-36"
            />
          </a>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-white/10 bg-black/15 px-6 py-4">
          <ActionBtn onClick={() => setQrOpen(true)}>Full-screen QR</ActionBtn>
          <ActionBtn onClick={share}>Share</ActionBtn>
          <ActionBtn onClick={() => copy(link, 'Link')}>Copy link</ActionBtn>
          <ActionBtn onClick={() => copy(nfcUrl(persona.public_id), 'NFC URL')}>
            Copy NFC URL
          </ActionBtn>
          <a
            href={`/card/p/${persona.public_id}?src=in_app`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-lg bg-white/10 px-3 text-sm text-white hover:bg-white/20"
          >
            Preview
          </a>
          <ActionBtn
            onClick={() => (editing ? setEditing(false) : openEditor())}
          >
            {editing ? 'Close editor' : 'Edit'}
          </ActionBtn>
          {!persona.revoked_at ? (
            <WalletButtons publicId={persona.public_id} variant="dark" />
          ) : null}
        </div>
      </section>

      <PersonaContactPanel persona={persona} onEdit={openEditor} />

      {msg ? (
        <p className="mt-3 text-sm text-[#3B4559]">{msg}</p>
      ) : null}

      {editing ? (
        <PersonaEditor
          persona={persona}
          pending={pending}
          focusKey={editFocus}
          onCancel={() => setEditing(false)}
          onSave={(patch) =>
            startTransition(async () => {
              const res = await updatePersonaAction({
                personaId: persona.id,
                ...patch,
              });
              if (!res.ok) {
                setMsg(res.error);
                return;
              }
              setPersonas((prev) =>
                prev.map((p) => (p.id === res.persona.id ? res.persona : p)),
              );
              setMsg('Saved — same QR, live profile');
              setEditing(false);
            })
          }
        />
      ) : null}

      <section className="mt-10" id="network-inbox">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="font-heading text-lg font-semibold text-[#3B4559]">
              Network inbox
              {newCount > 0 ? (
                <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">
                  · {newCount} new
                </span>
              ) : null}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              “Share my info” replies from your public card — owned by you.
            </p>
          </div>
          <Link
            href="/my-card/contacts"
            className="text-sm font-medium text-[#3B4559] underline-offset-4 hover:underline"
          >
            View all
          </Link>
        </div>
        <ul className="mt-4 divide-y divide-[#e8e4dc] rounded-xl border border-[#e0dcd2] bg-white">
          {contacts.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              No exchanges yet. Share your QR — replies land here.
            </li>
          ) : (
            contacts.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/my-card/contacts/${c.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-[#faf8f4]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#3B4559]">
                      {c.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[c.title, c.company].filter(Boolean).join(' · ') ||
                        c.email ||
                        c.phone}
                      {' · '}
                      {c.source_channel}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] text-[#3B4559] ${
                      c.status === 'new'
                        ? 'bg-[#3B4559] text-white'
                        : 'bg-[#ece9e6]'
                    }`}
                  >
                    {c.status}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
        {contacts[0] ? (
          <button
            type="button"
            className="mt-3 text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() =>
              startTransition(async () => {
                const res = await draftThankYouNoteAction({
                  contactName: contacts[0]!.name,
                  company: contacts[0]!.company,
                  context: contacts[0]!.their_notes,
                });
                if (res.ok) setDraft(res.draft);
              })
            }
          >
            Draft thank-you note (AI DRAFT — you send)
          </button>
        ) : null}
        {draft ? (
          <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-[#e0dcd2] bg-[#faf8f4] p-4 text-sm text-[#3B4559]">
            {draft}
          </pre>
        ) : null}
      </section>

      <section className="mt-10">
        <h3 className="font-heading text-lg font-semibold text-[#3B4559]">
          Tagged QR downloads
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Same persona, many sources — analytics split by channel.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {TAGGED_QR_SOURCES.map((s) => {
            const href = qrImageUrl(persona.public_id, s.id, 640);
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#e0dcd2] bg-white px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-[#3B4559]">{s.label}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    src={s.id}
                  </p>
                </div>
                <a
                  href={href}
                  download={qrDownloadFilename(persona.display_name, s.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-[#3B4559] underline-offset-4 hover:underline"
                >
                  Download
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      {qrOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-6">
          <button
            type="button"
            className="absolute top-5 right-5 text-sm text-[#3B4559]"
            onClick={() => setQrOpen(false)}
          >
            Close
          </button>
          <p className="mb-4 text-sm font-medium tracking-[0.16em] text-[#B2A384] uppercase">
            Scan or tap
          </p>
          <a href={link} className="rounded-2xl bg-white p-4 ring-1 ring-[#e8e4dc]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrImageUrl(persona.public_id, 'in_app', 720)}
              alt="Bright QR"
              className="size-[min(80vw,360px)]"
            />
          </a>
          <p className="mt-4 max-w-xs text-center text-sm text-muted-foreground">
            Bright full-screen QR for desk or events. Tap opens your live card
            on this phone.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center rounded-lg bg-white/10 px-3 text-sm text-white hover:bg-white/20"
    >
      {children}
    </button>
  );
}

function PersonaEditor({
  persona,
  pending,
  focusKey,
  onSave,
  onCancel,
}: {
  persona: DigitalCardPersona;
  pending: boolean;
  focusKey?: string;
  onCancel: () => void;
  onSave: (patch: {
    display_name: string;
    title: string;
    department: string;
    bio_short: string;
    website: string | null;
    calendar_url: string | null;
    booking_url: string | null;
    phones: DigitalCardPersona['phones'];
    emails: DigitalCardPersona['emails'];
    socials: Record<string, string>;
    photo_url: string | null;
    cta_primary: { label: string; url: string };
    is_default: boolean;
    event_tag: string | null;
    event_tag_remaining: number | null;
  }) => void;
}) {
  const [displayName, setDisplayName] = useState(persona.display_name);
  const [title, setTitle] = useState(persona.title);
  const [department, setDepartment] = useState(persona.department);
  const [bio, setBio] = useState(persona.bio_short);
  const [website, setWebsite] = useState(persona.website || '');
  const [calendar, setCalendar] = useState(persona.calendar_url || '');
  const [booking, setBooking] = useState(persona.booking_url || '');
  const [photoUrl, setPhotoUrl] = useState(persona.photo_url || '');
  const [workEmail, setWorkEmail] = useState(
    persona.emails.find((e) => e.share)?.value ||
      persona.emails[0]?.value ||
      '',
  );
  const [mobile, setMobile] = useState(
    persona.phones.find((p) => p.share)?.value ||
      persona.phones[0]?.value ||
      '',
  );
  const [linkedin, setLinkedin] = useState(persona.socials.linkedin || '');
  const [ctaLabel, setCtaLabel] = useState(persona.cta_primary?.label || '');
  const [ctaUrl, setCtaUrl] = useState(persona.cta_primary?.url || '');
  const [isDefault, setIsDefault] = useState(persona.is_default);
  const [eventTag, setEventTag] = useState(persona.event_tag || '');
  const [eventN, setEventN] = useState(
    String(persona.event_tag_remaining ?? 25),
  );

  return (
    <form
      id="persona-editor"
      className="mt-6 scroll-mt-6 space-y-3 rounded-2xl border border-[#e0dcd2] bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const priorEmails = persona.emails.filter(
          (e) => e.value !== workEmail.trim(),
        );
        const priorPhones = persona.phones.filter(
          (p) => p.value !== mobile.trim(),
        );
        onSave({
          display_name: displayName,
          title,
          department,
          bio_short: bio,
          website: website || null,
          calendar_url: calendar || null,
          booking_url: booking || null,
          photo_url: photoUrl || null,
          emails: workEmail.trim()
            ? [
                { label: 'Work', value: workEmail.trim(), share: true },
                ...priorEmails.map((e) => ({ ...e, share: false })),
              ]
            : priorEmails,
          phones: mobile.trim()
            ? [
                { label: 'Mobile', value: mobile.trim(), share: true },
                ...priorPhones.map((p) => ({ ...p, share: false })),
              ]
            : priorPhones,
          socials: {
            ...(persona.socials.x ? { x: persona.socials.x } : {}),
            ...(persona.socials.instagram
              ? { instagram: persona.socials.instagram }
              : {}),
            ...(persona.socials.github ? { github: persona.socials.github } : {}),
            ...(persona.socials.other ? { other: persona.socials.other } : {}),
            ...(linkedin.trim() ? { linkedin: linkedin.trim() } : {}),
          },
          cta_primary: {
            label: ctaLabel || persona.cta_primary?.label || '',
            url: ctaUrl || persona.cta_primary?.url || '',
          },
          is_default: isDefault,
          event_tag: eventTag.trim() || null,
          event_tag_remaining: eventTag.trim()
            ? Number(eventN) || 25
            : null,
        });
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-semibold text-[#3B4559]">
            Edit shareable fields
          </h3>
          <p className="text-xs text-muted-foreground">
            Brand colors stay locked by entity. Changes go live on the same QR
            / public_id.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Cancel
        </button>
      </div>
      <EditField
        id="edit-display_name"
        label="Display name"
        value={displayName}
        onChange={setDisplayName}
        autoFocus={focusKey === 'display_name'}
      />
      <EditField
        id="edit-title"
        label="Title"
        value={title}
        onChange={setTitle}
        autoFocus={focusKey === 'title'}
      />
      <EditField
        id="edit-department"
        label="Department"
        value={department}
        onChange={setDepartment}
      />
      <EditField
        id="edit-photo"
        label="Photo URL"
        value={photoUrl}
        onChange={setPhotoUrl}
        autoFocus={focusKey === 'photo'}
      />
      <EditField
        id="edit-emails"
        label="Work email (shared)"
        value={workEmail}
        onChange={setWorkEmail}
        autoFocus={focusKey === 'emails'}
      />
      <EditField
        id="edit-phones"
        label="Mobile (shared)"
        value={mobile}
        onChange={setMobile}
        autoFocus={focusKey === 'phones'}
      />
      <EditField
        id="edit-website"
        label="Website"
        value={website}
        onChange={setWebsite}
        autoFocus={focusKey === 'website'}
      />
      <EditField
        id="edit-calendar"
        label="Calendar URL"
        value={calendar}
        onChange={setCalendar}
        autoFocus={focusKey === 'calendar'}
      />
      <EditField
        id="edit-booking"
        label="Booking URL"
        value={booking}
        onChange={setBooking}
        autoFocus={focusKey === 'booking'}
      />
      <EditField
        id="edit-socials"
        label="LinkedIn URL"
        value={linkedin}
        onChange={setLinkedin}
        autoFocus={focusKey === 'socials'}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <EditField
          id="edit-cta"
          label="CTA label"
          value={ctaLabel}
          onChange={setCtaLabel}
          autoFocus={focusKey === 'cta'}
        />
        <EditField
          id="edit-cta-url"
          label="CTA URL"
          value={ctaUrl}
          onChange={setCtaUrl}
        />
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">Short bio</span>
        <textarea
          id="edit-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-[#e0dcd2] px-3 py-2 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        Default persona
      </label>
      <div className="grid grid-cols-2 gap-3">
        <EditField
          label="Event tag (next N exchanges)"
          value={eventTag}
          onChange={setEventTag}
        />
        <EditField label="N remaining" value={eventN} onChange={setEventN} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-xl bg-[#3B4559] px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function EditField({
  id,
  label,
  value,
  onChange,
  autoFocus,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input
        id={id}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-[#e0dcd2] px-3 py-2 text-sm"
      />
    </label>
  );
}
