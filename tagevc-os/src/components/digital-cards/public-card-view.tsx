'use client';

import { useEffect, useState, useTransition } from 'react';
import type { PublicCardPayload } from '@/lib/digital-cards/types';
import { qrImageUrl } from '@/lib/digital-cards/qr';
import { ExchangeForm } from '@/components/digital-cards/exchange-form';
import { WalletButtons } from '@/components/digital-cards/wallet-buttons';
import { TAGE_GOLD, TAGE_NAVY } from '@/lib/digital-cards/theme';

type Props = {
  card: PublicCardPayload;
  sourceChannel: string;
  entryPath: string;
};

export function PublicCardView({ card, sourceChannel, entryPath }: Props) {
  const [mode, setMode] = useState<'profile' | 'exchange' | 'success'>('profile');
  const [qrOpen, setQrOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const primary = card.theme.primary || TAGE_NAVY;
  const accent = card.theme.accent || TAGE_GOLD;
  const surface = card.theme.surface || '#F7F5F1';
  const profileUrl = card.profile_url;
  const qrSrc = qrImageUrl(card.public_id, sourceChannel || 'direct', 420);

  useEffect(() => {
    // Subtle entrance — one purposeful motion
    document.documentElement.style.setProperty('--dc-primary', primary);
    document.documentElement.style.setProperty('--dc-accent', accent);
    document.documentElement.style.setProperty('--dc-surface', surface);
  }, [primary, accent, surface]);

  function saveContact() {
    startTransition(async () => {
      window.location.href = `/api/card/vcard/${encodeURIComponent(card.public_id)}?src=${encodeURIComponent(sourceChannel)}`;
    });
  }

  async function shareLink() {
    const url = profileUrl;
    if (navigator.share) {
      try {
        await navigator.share({
          title: card.revoked
            ? card.company_name
            : `${card.display_name} · ${card.company_name}`,
          text: card.revoked
            ? card.company_name
            : `${card.display_name} — ${card.title}`,
          url,
        });
        return;
      } catch {
        /* fall through */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      alert('Link copied');
    } catch {
      window.prompt('Copy link', url);
    }
  }

  if (card.revoked) {
    return (
      <div
        className="dc-root min-h-dvh"
        style={{
          background: `radial-gradient(120% 80% at 50% -10%, ${accent}33, transparent 55%), linear-gradient(165deg, ${primary} 0%, #2a3140 48%, ${surface} 48%)`,
        }}
      >
        <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10 pt-12">
          <BrandMark card={card} accent={accent} />
          <div className="dc-rise mt-16 rounded-2xl bg-white/95 px-6 py-10 text-center shadow-[0_24px_60px_-28px_rgba(30,36,48,0.45)]">
            <p className="text-xs font-medium tracking-[0.2em] text-[#7c7871] uppercase">
              {card.company_name}
            </p>
            <h1 className="mt-4 font-heading text-2xl font-semibold tracking-tight text-[#3B4559]">
              {card.revoke_message}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#7c7871]">
              This personal card is no longer active. You can still reach the
              company below.
            </p>
            {card.cta_primary?.url ? (
              <a
                href={card.cta_primary.url}
                className="mt-8 inline-flex h-12 w-full items-center justify-center rounded-xl text-sm font-semibold text-white transition hover:brightness-110"
                style={{ background: primary }}
              >
                {card.cta_primary.label || `Visit ${card.company_name}`}
              </a>
            ) : null}
            {card.company_main_line ? (
              <a
                href={`tel:${card.company_main_line.replace(/\s/g, '')}`}
                className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-xl border border-[#d7d3c3] text-sm font-medium text-[#3B4559]"
              >
                Call {card.company_main_line}
              </a>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="dc-root min-h-dvh"
      style={{
        background: `radial-gradient(100% 70% at 80% 0%, ${accent}40, transparent 50%), radial-gradient(90% 60% at 10% 10%, ${primary}22, transparent 45%), linear-gradient(180deg, ${primary} 0%, ${primary} 38%, ${surface} 38%)`,
      }}
    >
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8 pt-8">
        <BrandMark card={card} accent={accent} />

        {mode === 'profile' || mode === 'success' ? (
          <section className="dc-rise mt-10 flex flex-1 flex-col">
            <div className="flex items-end gap-4">
              {card.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.photo_url}
                  alt=""
                  className="size-20 rounded-2xl object-cover ring-2 ring-white/80"
                />
              ) : (
                <div
                  className="flex size-20 items-center justify-center rounded-2xl text-2xl font-semibold text-white ring-2 ring-white/40"
                  style={{ background: accent }}
                  aria-hidden
                >
                  {initials(card.display_name)}
                </div>
              )}
              <div className="min-w-0 flex-1 pb-1">
                <h1 className="font-heading text-[1.85rem] leading-tight font-semibold tracking-tight text-white">
                  {card.display_name}
                </h1>
                <p className="mt-1 text-sm text-white/80">
                  {card.title}
                  {card.department ? ` · ${card.department}` : ''}
                </p>
              </div>
            </div>

            {card.bio_short ? (
              <p className="mt-5 text-sm leading-relaxed text-white/75">
                {card.bio_short}
              </p>
            ) : null}

            <div className="mt-8 rounded-[1.35rem] bg-white px-5 py-5 shadow-[0_28px_70px_-32px_rgba(30,36,48,0.55)]">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={saveContact}
                  disabled={pending}
                  className="flex h-12 flex-1 items-center justify-center rounded-xl text-sm font-semibold text-white transition active:scale-[0.98]"
                  style={{ background: primary }}
                >
                  Save contact
                </button>
                <button
                  type="button"
                  onClick={() => setMode('exchange')}
                  className="flex h-12 flex-1 items-center justify-center rounded-xl text-sm font-semibold text-[#3B4559] transition active:scale-[0.98]"
                  style={{ background: `${accent}55` }}
                >
                  Share my info
                </button>
              </div>

              <WalletButtons
                publicId={card.public_id}
                variant="light"
                className="mt-3"
              />

              <div className="mt-5 flex items-start gap-4">
                <a
                  href={profileUrl}
                  className="dc-qr block shrink-0 rounded-xl bg-white p-2 ring-1 ring-[#e8e4dc] transition hover:ring-[var(--dc-accent)]"
                  aria-label="Open this card (tappable QR)"
                  title="Tap to open this card"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrSrc}
                    alt={`QR for ${card.display_name}`}
                    width={112}
                    height={112}
                    className="size-28"
                  />
                </a>
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  <ContactLines card={card} />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setQrOpen(true)}
                      className="text-xs font-medium text-[#3B4559] underline-offset-4 hover:underline"
                    >
                      Expand QR
                    </button>
                    <button
                      type="button"
                      onClick={shareLink}
                      className="text-xs font-medium text-[#3B4559] underline-offset-4 hover:underline"
                    >
                      Share link
                    </button>
                    {card.cta_primary?.url ? (
                      <a
                        href={card.cta_primary.url}
                        className="text-xs font-medium text-[#3B4559] underline-offset-4 hover:underline"
                      >
                        {card.cta_primary.label}
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {mode === 'success' ? (
              <p className="dc-fade mt-5 rounded-xl bg-white/80 px-4 py-3 text-center text-sm text-[#3B4559]">
                Thanks — your info was shared. You can still save this contact.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="dc-rise mt-8 flex-1 rounded-[1.35rem] bg-white px-5 py-6 shadow-[0_28px_70px_-32px_rgba(30,36,48,0.55)]">
            <button
              type="button"
              onClick={() => setMode('profile')}
              className="text-xs font-medium text-[#7c7871] underline-offset-4 hover:underline"
            >
              ← Back to card
            </button>
            <h2 className="mt-3 font-heading text-xl font-semibold text-[#3B4559]">
              Share your info
            </h2>
            <p className="mt-1 text-sm text-[#7c7871]">
              {card.display_name} will get this in Tage OS — no app required for
              you.
            </p>
            <ExchangeForm
              publicId={card.public_id}
              sourceChannel={sourceChannel}
              entryPath={entryPath}
              entityId={card.entity_id}
              onSuccess={() => setMode('success')}
              primary={primary}
              accent={accent}
            />
          </section>
        )}
      </main>

      {qrOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E2430]/95 p-6"
          role="dialog"
          aria-modal
          aria-label="Full-screen QR"
        >
          <button
            type="button"
            className="absolute top-5 right-5 text-sm text-white/80"
            onClick={() => setQrOpen(false)}
          >
            Close
          </button>
          <a href={profileUrl} className="block rounded-2xl bg-white p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrImageUrl(card.public_id, sourceChannel || 'direct', 640)}
              alt="QR code"
              className="size-[min(72vw,320px)]"
            />
          </a>
        </div>
      ) : null}

      <style jsx global>{`
        .dc-rise {
          animation: dc-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .dc-fade {
          animation: dc-fade 420ms ease both;
        }
        .dc-qr {
          animation: dc-soft 900ms ease 180ms both;
        }
        @keyframes dc-rise {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes dc-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes dc-soft {
          from {
            opacity: 0;
            transform: scale(0.96);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .dc-rise,
          .dc-fade,
          .dc-qr {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

function BrandMark({
  card,
  accent,
}: {
  card: PublicCardPayload;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {card.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.logo_url}
          alt={card.company_name}
          className="h-9 w-auto max-w-[160px] object-contain"
        />
      ) : (
        <span
          className="text-lg font-semibold tracking-tight text-white"
          style={{ textDecorationColor: accent }}
        >
          {card.company_name}
        </span>
      )}
      {!card.logo_url ? null : (
        <span className="sr-only">{card.company_name}</span>
      )}
    </div>
  );
}

function ContactLines({ card }: { card: PublicCardPayload }) {
  return (
    <ul className="space-y-1.5 text-sm text-[#3B4559]">
      {card.emails.map((e) => (
        <li key={`e-${e.value}`}>
          <a className="hover:underline" href={`mailto:${e.value}`}>
            {e.value}
          </a>
        </li>
      ))}
      {card.phones.map((p) => (
        <li key={`p-${p.value}`}>
          <a
            className="hover:underline"
            href={`tel:${p.value.replace(/\s/g, '')}`}
          >
            {p.value}
          </a>
        </li>
      ))}
      {card.socials.linkedin ? (
        <li>
          <a
            className="hover:underline"
            href={card.socials.linkedin}
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn
          </a>
        </li>
      ) : null}
    </ul>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase();
}
