'use client';

import type { DigitalCardPersona, ShareableField } from '@/lib/digital-cards/types';
import { entityDisplayName } from '@/lib/entities/display-name';
import { TAGE_GOLD, TAGE_NAVY } from '@/lib/digital-cards/theme';
import { qrImageUrl } from '@/lib/digital-cards/qr';
import { taggedCardUrl } from '@/lib/digital-cards/urls';

type Props = {
  persona: DigitalCardPersona;
  onEdit: (focus?: string) => void;
};

const SOCIAL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  github: 'GitHub',
  other: 'Other',
};

/** At-a-glance view of what the selected persona exposes on the public card. */
export function PersonaContactPanel({ persona, onEdit }: Props) {
  const company = entityDisplayName(persona.entity_id);
  const profileUrl = taggedCardUrl(persona.public_id, 'in_app');
  const socialEntries = Object.entries(persona.socials || {}).filter(
    ([, v]) => typeof v === 'string' && v.trim(),
  );
  const sharedEmails = persona.emails.filter((e) => e.share && e.value?.trim());
  const privateEmails = persona.emails.filter((e) => !e.share && e.value?.trim());
  const sharedPhones = persona.phones.filter((p) => p.share && p.value?.trim());
  const privatePhones = persona.phones.filter((p) => !p.share && p.value?.trim());

  return (
    <section
      id="persona-contact"
      className="mt-8 overflow-hidden rounded-2xl border border-[#e0dcd2] bg-white"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#ece9e6] px-5 py-4">
        <div>
          <h3 className="font-heading text-lg font-semibold text-[#3B4559]">
            Your contact card
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            What this persona shows on the public card — edit anytime.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onEdit()}
          className="inline-flex h-9 items-center rounded-lg bg-[#3B4559] px-3.5 text-sm font-medium text-white hover:brightness-110"
        >
          Edit contact info
        </button>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_220px]">
        <div className="space-y-5 px-5 py-5">
          <div className="flex items-start gap-4">
            {persona.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={persona.photo_url}
                alt=""
                className="size-16 shrink-0 rounded-2xl object-cover ring-1 ring-[#e0dcd2]"
              />
            ) : (
              <button
                type="button"
                onClick={() => onEdit('photo')}
                className="flex size-16 shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-[#cfc9bc] bg-[#faf8f4] text-center text-[10px] leading-tight text-muted-foreground hover:border-[#3B4559]/
              >
                Add
                <br />
                photo
              </button>
            )}
            <div className="min-w-0">
              <FieldRow
                label="Name"
                onEdit={() => onEdit('display_name')}
              >
                <p className="font-heading text-xl font-semibold text-[#3B4559]">
                  {persona.display_name || (
                    <EmptyHint>Add display name</EmptyHint>
                  )}
                </p>
              </FieldRow>
              <FieldRow label="Title" onEdit={() => onEdit('title')}>
                <p className="text-sm text-[#3B4559]/
                  {persona.title || <EmptyHint>Add title</EmptyHint>}
                </p>
              </FieldRow>
              <p className="mt-1 text-sm text-muted-foreground">{company}</p>
              {persona.department ? (
                <p className="text-xs text-muted-foreground">
                  {persona.department}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ShareableList
              title="Emails"
              shared={sharedEmails}
              privateItems={privateEmails}
              emptyHint="No emails on this persona"
              onEdit={() => onEdit('emails')}
            />
            <ShareableList
              title="Phones"
              shared={sharedPhones}
              privateItems={privatePhones}
              emptyHint="No phones shared yet"
              onEdit={() => onEdit('phones')}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <LinkField
              label="Website"
              value={persona.website}
              onEdit={() => onEdit('website')}
            />
            <LinkField
              label="Calendar"
              value={persona.calendar_url}
              onEdit={() => onEdit('calendar')}
            />
            <LinkField
              label="Booking"
              value={persona.booking_url}
              onEdit={() => onEdit('booking')}
            />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Primary CTA
                </span>
                <EditChip onClick={() => onEdit('cta')} />
              </div>
              {persona.cta_primary?.label || persona.cta_primary?.url ? (
                <div className="rounded-xl bg-[#faf8f4] px-3 py-2.5">
                  <p className="text-sm font-medium text-[#3B4559]">
                    {persona.cta_primary.label || 'CTA'}
                  </p>
                  {persona.cta_primary.url ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {persona.cta_primary.url}
                    </p>
                  ) : null}
                </div>
              ) : (
                <EmptyHint>Entity default CTA</EmptyHint>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Socials
              </span>
              <EditChip onClick={() => onEdit('socials')} />
            </div>
            {socialEntries.length ? (
              <ul className="flex flex-wrap gap-2">
                {socialEntries.map(([key, url]) => (
                  <li key={key}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-full border border-[#e0dcd2] bg-[#faf8f4] px-3 py-1 text-xs font-medium text-[#3B4559] hover:border-[#3B4559]"
                    >
                      {SOCIAL_LABELS[key] || key}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint>No social links yet</EmptyHint>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Short bio
              </span>
              <EditChip onClick={() => onEdit('bio')} />
            </div>
            {persona.bio_short?.trim() ? (
              <p className="text-sm leading-relaxed text-[#3B4559]">
                {persona.bio_short}
              </p>
            ) : (
              <EmptyHint>Add a short bio for the public card</EmptyHint>
            )}
          </div>
        </div>

        {/* Live mini preview */}
        <aside className="border-t border-[#ece9e6] bg-[#f7f5f1] px-4 py-5 lg:border-t-0 lg:border-l">
          <p className="mb-3 text-center text-[11px] font-medium tracking-[0.16em] text-[#B2A384] uppercase">
            Public preview
          </p>
          <a
            href={profileUrl}
            target="_blank"
            rel="noreferrer"
            className="mx-auto block max-w-[200px] overflow-hidden rounded-2xl shadow-[0_16px_40px_-24px_rgba(30,36,48,0.5)] transition hover:scale-[1.02]"
            style={{
              background: `linear-gradient(165deg, ${TAGE_NAVY} 0%, #2a3140 52%, #F7F5F1 52%)`,
            }}
          >
            <div className="px-4 pt-5 pb-3 text-center text-white">
              {persona.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={persona.photo_url}
                  alt=""
                  className="mx-auto size-12 rounded-xl object-cover ring-2 ring-white/25"
                />
              ) : (
                <div
                  className="mx-auto flex size-12 items-center justify-center rounded-xl text-sm font-semibold"
                  style={{ background: TAGE_GOLD, color: TAGE_NAVY }}
                >
                  {(persona.display_name || '?')
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase())
                    .join('') || '·'}
                </div>
              )}
              <p className="mt-2.5 truncate font-heading text-sm font-semibold">
                {persona.display_name || 'Your name'}
              </p>
              <p className="truncate text-[11px] text-white/70">
                {persona.title || 'Title'}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-white/50">
                {company}
              </p>
            </div>
            <div className="bg-white px-3 py-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrImageUrl(persona.public_id, 'in_app', 200)}
                alt=""
                className="mx-auto size-16"
              />
              {persona.cta_primary?.label ? (
                <p
                  className="mt-2 truncate rounded-lg py-1.5 text-center text-[10px] font-semibold text-white"
                  style={{ background: TAGE_NAVY }}
                >
                  {persona.cta_primary.label}
                </p>
              ) : null}
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Open live card →
              </p>
            </div>
          </a>
        </aside>
      </div>
    </section>
  );
}

function FieldRow({
  label,
  children,
  onEdit,
}: {
  label: string;
  children: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="group">
      <div className="flex items-center gap-2">
        <span className="sr-only">{label}</span>
        {children}
        <button
          type="button"
          onClick={onEdit}
          className="invisible text-[11px] font-medium text-[#B2A384] group-hover:visible hover:underline"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function ShareableList({
  title,
  shared,
  privateItems,
  emptyHint,
  onEdit,
}: {
  title: string;
  shared: ShareableField[];
  privateItems: ShareableField[];
  emptyHint: string;
  onEdit: () => void;
}) {
  const items = [...shared, ...privateItems];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </span>
        <EditChip onClick={onEdit} />
      </div>
      {items.length === 0 ? (
        <EmptyHint>{emptyHint}</EmptyHint>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li
              key={`${item.value}-${i}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-[#faf8f4] px-2.5 py-1.5"
            >
              <div className="min-w-0">
                {item.label ? (
                  <p className="text-[10px] text-muted-foreground">
                    {item.label}
                  </p>
                ) : null}
                <p className="truncate text-sm text-[#3B4559]">{item.value}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  item.share
                    ? 'bg-[#3B4559] text-white'
                    : 'bg-[#ece9e6] text-[#6b6560]'
                }`}
              >
                {item.share ? 'Shared' : 'Private'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkField({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string | null | undefined;
  onEdit: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <EditChip onClick={onEdit} />
      </div>
      {value?.trim() ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm text-[#3B4559] underline-offset-2 hover:underline"
        >
          {value}
        </a>
      ) : (
        <EmptyHint>Not set</EmptyHint>
      )}
    </div>
  );
}

function EditChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-medium text-[#B2A384] hover:underline"
    >
      Edit
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-muted-foreground italic">{children}</span>;
}
