'use client';

import { useState, useTransition } from 'react';
import type { EntityCardTemplate } from '@/lib/digital-cards/types';
import { entityDisplayName } from '@/lib/entities/display-name';
import {
  forceRevokeUserCardsAction,
  provisionMissingCardsAction,
  saveTemplateAction,
} from '@/app/(app)/admin/digital-cards/actions';

export function AdminDigitalCardsClient({
  templates,
}: {
  templates: EntityCardTemplate[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [revokeUserId, setRevokeUserId] = useState('');

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#e0dcd2] bg-white p-5">
        <h2 className="font-heading text-lg font-semibold text-[#3B4559]">
          Provision missing
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Activate a default digital card for portal users (and linked active
          HRIS employees) who do not have one yet. Does not revoke anyone or
          invent people.
        </p>
        <button
          type="button"
          disabled={pending}
          className="mt-3 h-10 rounded-xl bg-[#3B4559] px-4 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => {
            startTransition(async () => {
              const res = await provisionMissingCardsAction();
              if (!res.ok) {
                setMsg(res.error);
                return;
              }
              const lines = [
                `Activated ${res.activated.length}`,
                res.skipped.length ? `· skipped ${res.skipped.length}` : null,
                res.errors.length ? `· errors ${res.errors.length}` : null,
              ].filter(Boolean);
              const detail = [
                ...res.activated.map(
                  (a) =>
                    `+ ${a.name} (${a.entity_id}) → ${a.public_id}${a.created ? '' : ' refreshed'}`,
                ),
                ...res.skipped.map(
                  (s) => `· ${s.name}${s.email ? ` <${s.email}>` : ''}: ${s.reason}`,
                ),
                ...res.errors.map((e) => `! ${e.name}: ${e.error}`),
              ];
              setMsg(
                [lines.join(' '), detail.slice(0, 12).join('\n')]
                  .filter(Boolean)
                  .join('\n'),
              );
            });
          }}
        >
          Provision missing cards
        </button>
      </section>

      <section className="rounded-2xl border border-[#e0dcd2] bg-white p-5">
        <h2 className="font-heading text-lg font-semibold text-[#3B4559]">
          Entity templates
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Logo/colors locked; default CTA + routing defaults.
        </p>
        <ul className="mt-4 space-y-4">
          {templates.map((t) => (
            <li
              key={t.entity_id}
              className="rounded-xl border border-[#ece9e6] p-4"
            >
              <p className="font-medium text-[#3B4559]">
                {entityDisplayName(t.entity_id)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                CTA: {t.default_cta.label} → {t.default_cta.url}
              </p>
              <p className="text-xs text-muted-foreground">
                Theme {t.locked_theme.primary} / {t.locked_theme.accent}
              </p>
              <form
                className="mt-3 flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  startTransition(async () => {
                    const res = await saveTemplateAction({
                      entity_id: t.entity_id,
                      cta_label: String(fd.get('cta_label') || ''),
                      cta_url: String(fd.get('cta_url') || ''),
                      company_main_line: String(
                        fd.get('company_main_line') || '',
                      ),
                      company_website: String(fd.get('company_website') || ''),
                    });
                    setMsg(res.ok ? `Saved ${entityDisplayName(t.entity_id)}` : res.error);
                  });
                }}
              >
                <input
                  name="cta_label"
                  defaultValue={t.default_cta.label}
                  placeholder="CTA label"
                  className="h-9 min-w-[140px] flex-1 rounded-lg border border-[#e0dcd2] px-2 text-sm"
                />
                <input
                  name="cta_url"
                  defaultValue={t.default_cta.url}
                  placeholder="CTA URL"
                  className="h-9 min-w-[180px] flex-1 rounded-lg border border-[#e0dcd2] px-2 text-sm"
                />
                <input
                  name="company_website"
                  defaultValue={t.company_website || ''}
                  placeholder="Company website"
                  className="h-9 min-w-[160px] flex-1 rounded-lg border border-[#e0dcd2] px-2 text-sm"
                />
                <input
                  name="company_main_line"
                  defaultValue={t.company_main_line || ''}
                  placeholder="Main line"
                  className="h-9 min-w-[120px] flex-1 rounded-lg border border-[#e0dcd2] px-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={pending}
                  className="h-9 rounded-lg bg-[#3B4559] px-3 text-sm font-medium text-white"
                >
                  Save
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-[#e0dcd2] bg-white p-5">
        <h2 className="font-heading text-lg font-semibold text-[#3B4559]">
          Force revoke
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Public kill switch for all personas on a profile UUID. Contacts retained.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={revokeUserId}
            onChange={(e) => setRevokeUserId(e.target.value)}
            placeholder="profiles.id UUID"
            className="h-10 min-w-[260px] flex-1 rounded-xl border border-[#e0dcd2] px-3 text-sm"
          />
          <button
            type="button"
            disabled={pending || !revokeUserId.trim()}
            className="h-10 rounded-xl bg-red-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => {
              if (
                !window.confirm(
                  'Force revoke all digital cards for this user?',
                )
              ) {
                return;
              }
              startTransition(async () => {
                const res = await forceRevokeUserCardsAction(
                  revokeUserId.trim(),
                );
                setMsg(
                  res.ok
                    ? `Revoked ${res.count} persona(s)`
                    : res.error,
                );
              });
            }}
          >
            Force revoke
          </button>
        </div>
      </section>

      {msg ? <p className="text-sm text-[#3B4559]">{msg}</p> : null}
    </div>
  );
}
