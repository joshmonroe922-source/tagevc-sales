'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import {
  composePublishDeskAction,
  connectBlogAccountAction,
  registerAccountAction,
  stubConnectAccountAction,
  type MarketingActionResult,
} from '@/app/(app)/shared-services/marketing/actions';
import { CompanySelect } from '@/components/shared/company-select';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  brandLabelForEntity,
  PLATFORM_CHAR_HINTS,
  PUBLISH_DESK_BRANDS,
  type PublisherChannelDef,
} from '@/lib/shared-services/marketing-publisher-desk-shared';
import type { MarketingSocialAccount } from '@/lib/shared-services/marketing-types';

const field =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const OAUTH_SET = new Set([
  'linkedin',
  'x',
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
]);

function readinessTone(readiness: PublisherChannelDef['readiness']) {
  if (readiness === 'live') return 'border-emerald-500/40 bg-emerald-500/5 text-emerald-800';
  if (readiness === 'scaffold') return 'border-amber-500/40 bg-amber-500/5 text-amber-900';
  return 'border-border bg-muted/40 text-muted-foreground';
}

function Msg({ state }: { state: MarketingActionResult | null }) {
  if (!state) return null;
  if (state.ok) {
    return <p className="text-sm text-emerald-700">{state.message ?? 'Done'}</p>;
  }
  return <p className="text-sm text-destructive">{state.error}</p>;
}

export function MarketingPublisherDeskClient({
  channels,
  accounts,
  canWrite,
  stubOAuthAllowed = false,
}: {
  channels: PublisherChannelDef[];
  accounts: MarketingSocialAccount[];
  canWrite: boolean;
  /** Only show stub-connect when MARKETING_ALLOW_STUB_OAUTH is on (dev). */
  stubOAuthAllowed?: boolean;
}) {
  const publishers = useMemo(
    () => accounts.filter((a) => a.account_type === 'publisher'),
    [accounts],
  );
  const connectedCount = publishers.filter((a) => a.status === 'connected').length;

  const [registerState, registerAction, registerPending] = useActionState(
    registerAccountAction,
    null as MarketingActionResult | null,
  );
  const [composeState, composeAction, composePending] = useActionState(
    composePublishDeskAction,
    null as MarketingActionResult | null,
  );
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([
    'linkedin',
  ]);
  const [composeBody, setComposeBody] = useState('');
  const [when, setWhen] = useState<'now' | 'schedule'>('now');

  const primaryCharHint = useMemo(() => {
    const caps = selectedPlatforms
      .map((p) => PLATFORM_CHAR_HINTS[p as keyof typeof PLATFORM_CHAR_HINTS])
      .filter((n): n is number => typeof n === 'number');
    return caps.length ? Math.min(...caps) : null;
  }, [selectedPlatforms]);

  function togglePlatform(platform: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform],
    );
  }

  function run(fn: () => Promise<MarketingActionResult>) {
    setFlash(null);
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) setFlash(res.message ?? 'Done');
      else setErr(res.error);
    });
  }

  return (
    <div
      id="mkt-publish"
      className="scroll-mt-20 space-y-6 rounded-xl border border-border bg-gradient-to-b from-background to-muted/20 p-4 sm:p-5"
    >
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Publish desk
        </p>
        <h2 className="text-lg font-semibold tracking-tight">
          Connect accounts · compose once · post everywhere
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Hootsuite-style flow for Tage brands. Badges tell you what is{' '}
          <span className="font-medium text-emerald-800">LIVE</span> versus{' '}
          <span className="font-medium text-amber-900">scaffold</span> (UI ready,
          posting still stubbed until API wiring lands).
        </p>
        <p className="text-xs text-muted-foreground">
          {connectedCount} connected publisher
          {connectedCount === 1 ? '' : 's'} · {publishers.length} registered
        </p>
      </div>

      {(flash || err) && (
        <p className={`text-sm ${err ? 'text-destructive' : 'text-emerald-700'}`}>
          {err ?? flash}
        </p>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Channels</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {channels.map((ch) => {
            const brandHits = PUBLISH_DESK_BRANDS.map((b) => {
              const acct = publishers.find(
                (a) =>
                  a.platform === ch.platform &&
                  (a.entity_id ?? null) === b.entityId,
              );
              return { brand: b, acct };
            });
            return (
              <div
                key={ch.platform}
                className="rounded-lg border border-border/80 bg-background p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{ch.label}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">
                      {ch.kind}
                    </p>
                  </div>
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${readinessTone(ch.readiness)}`}
                  >
                    {ch.readiness === 'live'
                      ? 'LIVE'
                      : ch.readiness === 'scaffold'
                        ? 'Scaffold'
                        : 'Needs keys'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  {ch.operatorHint}
                </p>
                {ch.missingEnv.length > 0 ? (
                  <p className="text-[11px] font-mono text-amber-800/90 break-all">
                    {ch.missingEnv.slice(0, 3).join(', ')}
                  </p>
                ) : null}
                <ul className="space-y-1 text-[11px]">
                  {brandHits.map(({ brand, acct }) => (
                    <li
                      key={brand.entityId}
                      className="flex items-center justify-between gap-1"
                    >
                      <span className="truncate text-muted-foreground">
                        {brand.label}
                      </span>
                      <span
                        className={
                          acct?.status === 'connected'
                            ? 'text-emerald-700'
                            : acct
                              ? 'text-amber-800'
                              : 'text-muted-foreground/70'
                        }
                      >
                        {acct?.status === 'connected'
                          ? `@${acct.handle}`
                          : acct
                            ? acct.status
                            : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {canWrite ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={registerAction} className="space-y-3 rounded-lg border bg-background p-4">
            <h3 className="text-sm font-semibold">1 · Connect an account</h3>
            <p className="text-xs text-muted-foreground">
              Pick the brand + channel, register the handle, then Connect (OAuth
              sign-in, or Blog webhook ready).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="desk_plat">Channel</Label>
                <select
                  id="desk_plat"
                  name="platform"
                  className={field}
                  defaultValue="linkedin"
                >
                  {channels.map((ch) => (
                    <option key={ch.platform} value={ch.platform}>
                      {ch.label}
                      {ch.readiness === 'live'
                        ? ' · LIVE'
                        : ch.readiness === 'scaffold'
                          ? ' · scaffold'
                          : ' · needs keys'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="desk_handle">Handle / site slug</Label>
                <Input
                  id="desk_handle"
                  name="handle"
                  required
                  placeholder="tagevc"
                />
              </div>
            </div>
            <input type="hidden" name="account_type" value="publisher" />
            <div className="space-y-1">
              <Label htmlFor="desk_entity">Brand</Label>
              <CompanySelect
                id="desk_entity"
                name="entity_id"
                allowAll
                allLabel="Firm-wide / Tage"
              />
            </div>
            <Button type="submit" size="sm" disabled={registerPending}>
              {registerPending ? 'Registering…' : 'Register account'}
            </Button>
            <Msg state={registerState} />
          </form>

          <form action={composeAction} className="space-y-3 rounded-lg border bg-background p-4">
            <h3 className="text-sm font-semibold">2 · Compose & publish</h3>
            <p className="text-xs text-muted-foreground">
              One message, multiple channels. We create approved content per
              channel and queue it. Unconnected channels stay as approved drafts.
            </p>
            <div className="space-y-1">
              <Label htmlFor="desk_title">Title</Label>
              <Input id="desk_title" name="title" required placeholder="Post headline" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="desk_body">Body</Label>
              <textarea
                id="desk_body"
                name="body"
                required
                rows={4}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Write once — we adapt per channel at publish time where needed."
              />
              <p className="text-[11px] text-muted-foreground">
                {composeBody.length} chars
                {primaryCharHint != null
                  ? ` · tightest selected limit ~${primaryCharHint}`
                  : ''}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Channels</Label>
              <div className="flex flex-wrap gap-2">
                {channels.map((ch) => {
                  const checked = selectedPlatforms.includes(ch.platform);
                  return (
                    <label
                      key={ch.platform}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                        checked
                          ? 'border-foreground/30 bg-muted'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="platforms"
                        value={ch.platform}
                        checked={checked}
                        onChange={() => togglePlatform(ch.platform)}
                        className="size-3.5"
                      />
                      {ch.shortLabel}
                      <span
                        className={`ml-0.5 size-1.5 rounded-full ${
                          ch.readiness === 'live'
                            ? 'bg-emerald-500'
                            : ch.readiness === 'scaffold'
                              ? 'bg-amber-500'
                              : 'bg-muted-foreground/40'
                        }`}
                        title={ch.readinessLabel}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="desk_compose_entity">Brand</Label>
              <CompanySelect
                id="desk_compose_entity"
                name="entity_id"
                allowAll
                allLabel="Firm-wide / Tage"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="desk_when">When</Label>
                <select
                  id="desk_when"
                  name="when"
                  className={field}
                  value={when}
                  onChange={(e) =>
                    setWhen(e.target.value === 'schedule' ? 'schedule' : 'now')
                  }
                >
                  <option value="now">Publish now</option>
                  <option value="schedule">Schedule</option>
                </select>
              </div>
              {when === 'schedule' ? (
                <div className="space-y-1">
                  <Label htmlFor="desk_sched">Schedule time</Label>
                  <Input
                    id="desk_sched"
                    name="scheduled_for"
                    type="datetime-local"
                    required={when === 'schedule'}
                  />
                </div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="desk_media">Media URL (optional · TikTok)</Label>
              <Input
                id="desk_media"
                name="media_url"
                type="url"
                placeholder="https://…"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={composePending || selectedPlatforms.length === 0}
            >
              {composePending
                ? 'Queuing…'
                : when === 'now'
                  ? 'Approve & publish'
                  : 'Approve & schedule'}
            </Button>
            <Msg state={composeState} />
          </form>
        </div>
      ) : (
        <EmptyState
          title="Read-only"
          description="You can view channel readiness. Ask an admin for write:marketing to connect and publish."
        />
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Registered publishers</h3>
        {publishers.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="Register a brand + channel above, then Connect. LinkedIn, X, and Facebook can go LIVE once API keys are in Vercel."
          />
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border bg-background text-sm">
            {publishers.map((a) => {
              const ch = channels.find((c) => c.platform === a.platform);
              return (
                <li
                  key={a.account_id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {ch?.label ?? a.platform}{' '}
                      <span className="text-muted-foreground font-normal">
                        @{a.handle}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {brandLabelForEntity(a.entity_id)} · {a.status}
                      {ch ? ` · ${ch.readinessLabel}` : ''}
                    </p>
                  </div>
                  {canWrite && a.status !== 'connected' ? (
                    <div className="flex flex-wrap gap-2">
                      {OAUTH_SET.has(a.platform) ? (
                        <a
                          href={`/api/marketing/oauth/${a.platform}?account_id=${encodeURIComponent(a.account_id)}`}
                          className="text-xs font-medium underline-offset-4 hover:underline"
                        >
                          Connect with {ch?.label ?? a.platform}
                        </a>
                      ) : null}
                      {a.platform === 'web' ? (
                        <button
                          type="button"
                          className="text-xs font-medium underline-offset-4 hover:underline"
                          disabled={pending}
                          onClick={() =>
                            run(() => connectBlogAccountAction(a.account_id))
                          }
                        >
                          Mark blog ready
                        </button>
                      ) : null}
                      {a.platform !== 'web' && stubOAuthAllowed ? (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                          disabled={pending}
                          onClick={() =>
                            run(() => stubConnectAccountAction(a.account_id))
                          }
                        >
                          Dev stub connect
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className="rounded-lg border bg-background/80 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">
          How to hook up accounts (operator checklist)
        </summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Admin sets Vercel env: <code className="text-xs">MARKETING_TOKEN_SECRET</code>{' '}
            (16+ chars) plus channel app credentials (see channel cards /{' '}
            <code className="text-xs">.env.example</code>).
          </li>
          <li>
            Register each redirect URI in the platform developer console:{' '}
            <code className="text-xs break-all">
              https://app.tagevc.com/api/marketing/oauth/{'{platform}'}/callback
            </code>
          </li>
          <li>
            Here: pick brand (Tage VC, Recruit 619, Signent, Instant NDA) → register
            handle → Connect (sign in at LinkedIn / X / Meta / Google / TikTok).
          </li>
          <li>
            Blog: set <code className="text-xs">BLOG_PUBLISH_WEBHOOK_URL</code> to
            your CMS ingest endpoint, register platform <strong>Blog / CMS</strong>,
            then Mark blog ready.
          </li>
          <li>
            Compose above, select channels, Publish now or Schedule. Run the
            schedule worker if something stays queued.
          </li>
        </ol>
      </details>
    </div>
  );
}
