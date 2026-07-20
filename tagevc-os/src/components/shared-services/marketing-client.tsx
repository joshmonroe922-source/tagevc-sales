'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  approveContentAction,
  createCampaignAction,
  createContentAction,
  generateDraftAction,
  pullEngagementAction,
  recordEngagementAction,
  refreshTokensAction,
  registerAccountAction,
  runApprovalSlaDigestAction,
  runScheduleWorkerAction,
  scheduleContentAction,
  stubConnectAccountAction,
  submitForReviewAction,
  upsertBrandVoiceAction,
  type MarketingActionResult,
} from '@/app/(app)/shared-services/marketing/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BrandVoice } from '@/lib/shared-services/marketing-brand';
import type { MarketingAnalyticsSummary } from '@/lib/shared-services/marketing-analytics';
import type {
  MarketingCampaign,
  MarketingContent,
  MarketingGenerationJob,
  MarketingScheduleJob,
  MarketingSocialAccount,
} from '@/lib/shared-services/marketing-types';

function Msg({ state }: { state: MarketingActionResult | null }) {
  if (!state) return null;
  if (state.ok) {
    return <p className="text-sm text-emerald-700">{state.message ?? 'Done'}</p>;
  }
  return <p className="text-sm text-destructive">{state.error}</p>;
}

const field =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

/** Platforms with OAuth routes (keep in sync with marketing-oauth OAUTH_PLATFORMS). */
const OAUTH_SET = new Set([
  'linkedin',
  'x',
  'facebook',
  'instagram',
  'youtube',
]);

export function MarketingClient({
  campaigns,
  content,
  accounts,
  scheduleJobs,
  generationJobs,
  brandVoices,
  analytics,
  analyticsError,
  canWrite,
  tableError,
  foundation,
}: {
  campaigns: MarketingCampaign[];
  content: MarketingContent[];
  accounts: MarketingSocialAccount[];
  scheduleJobs: MarketingScheduleJob[];
  generationJobs: MarketingGenerationJob[];
  brandVoices: BrandVoice[];
  analytics: MarketingAnalyticsSummary;
  analyticsError?: string;
  canWrite: boolean;
  tableError?: string;
  foundation: {
    ai_provider: string;
    scheduler_enabled: boolean;
    oauth_tokens_stored: boolean;
    linkedin_oauth?: boolean;
    x_oauth?: boolean;
    facebook_oauth?: boolean;
    instagram_oauth?: boolean;
    youtube_oauth?: boolean;
    linkedin_marketing_api?: boolean;
    youtube_analytics?: boolean;
    tiktok_analytics?: boolean;
    approval_sla_hours?: number;
    phase: number;
  };
}) {
  const [campState, campAction, campPending] = useActionState(
    createCampaignAction,
    null as MarketingActionResult | null,
  );
  const [contentState, contentAction, contentPending] = useActionState(
    createContentAction,
    null as MarketingActionResult | null,
  );
  const [acctState, acctAction, acctPending] = useActionState(
    registerAccountAction,
    null as MarketingActionResult | null,
  );
  const [genState, genAction, genPending] = useActionState(
    generateDraftAction,
    null as MarketingActionResult | null,
  );
  const [voiceState, voiceAction, voicePending] = useActionState(
    upsertBrandVoiceAction,
    null as MarketingActionResult | null,
  );
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<MarketingActionResult>) {
    setFlash(null);
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) setFlash(res.message ?? 'Done');
      else setErr(res.error);
    });
  }

  const pendingJobs = scheduleJobs.filter((j) => j.status === 'pending');
  const platformEntries = Object.entries(analytics.by_platform).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Phase {foundation.phase} · AI:{' '}
        <span className="font-medium text-foreground">{foundation.ai_provider}</span>
        {' · '}
        Scheduler:{' '}
        {foundation.scheduler_enabled ? 'enabled' : 'manual/force'}
        {' · '}
        Token vault:{' '}
        {foundation.oauth_tokens_stored ? 'ready' : 'set MARKETING_TOKEN_SECRET'}
        {' · '}
        LI:{foundation.linkedin_oauth ? 'oauth' : 'stub'}
        {foundation.linkedin_marketing_api ? '+mkt' : ''} · X:
        {foundation.x_oauth ? 'oauth' : 'stub'} · Meta:
        {foundation.facebook_oauth || foundation.instagram_oauth
          ? 'oauth'
          : 'stub'}{' '}
        · YT:{foundation.youtube_oauth ? 'oauth' : 'stub'}
        {foundation.youtube_analytics ? '+an' : ''} · TT:
        {foundation.tiktok_analytics ? 'on' : 'off'}
        {foundation.approval_sla_hours
          ? ` · SLA ${foundation.approval_sla_hours}h`
          : ''}
      </div>

      {tableError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Tables unavailable — apply phase22–24 marketing SQL. {tableError}
        </p>
      )}
      {(flash || err) && (
        <p className={`text-sm ${err ? 'text-destructive' : 'text-emerald-700'}`}>
          {err ?? flash}
        </p>
      )}

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Analytics</h2>
          {analyticsError ? (
            <span className="text-xs text-amber-700">
              Apply phase24_maturation.sql · {analyticsError}
            </span>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Posts succeeded</p>
            <p className="text-lg font-semibold tabular-nums">
              {analytics.posts_succeeded}
              {analytics.posts_stub > 0 ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({analytics.posts_stub} stub)
                </span>
              ) : null}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Posts failed</p>
            <p className="text-lg font-semibold tabular-nums">
              {analytics.posts_failed}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Impressions / eng. rate</p>
            <p className="text-lg font-semibold tabular-nums">
              {analytics.engagement_impressions}
              {analytics.engagement_rate != null ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({(analytics.engagement_rate * 100).toFixed(1)}%)
                </span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              likes {analytics.engagement_likes} · comments{' '}
              {analytics.engagement_comments ?? 0} · shares{' '}
              {analytics.engagement_shares ?? 0} · API{' '}
              {analytics.engagement_api ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pending schedule</p>
            <p className="text-lg font-semibold tabular-nums">
              {pendingJobs.length}
            </p>
          </div>
        </div>
        {analytics.trend_7d && analytics.trend_7d.length > 0 ? (
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              7-day trend
            </p>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1 pr-2">Day</th>
                  <th className="py-1 pr-2">Posts</th>
                  <th className="py-1 pr-2">Eng. events</th>
                  <th className="py-1">Impressions</th>
                </tr>
              </thead>
              <tbody>
                {analytics.trend_7d.map((t) => (
                  <tr key={t.day} className="border-b border-border/40">
                    <td className="py-1 pr-2 font-mono">{t.day.slice(5)}</td>
                    <td className="py-1 pr-2 tabular-nums">{t.posts}</td>
                    <td className="py-1 pr-2 tabular-nums">
                      {t.engagement_events}
                    </td>
                    <td className="py-1 tabular-nums">{t.impressions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {analytics.platform_rank && analytics.platform_rank.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Platform comparison (by impressions)
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {analytics.platform_rank.map((p, i) => (
                <li key={p.platform}>
                  #{i + 1} {p.platform} · {p.impressions} impr.
                  {p.engagement_rate != null
                    ? ` · ${(p.engagement_rate * 100).toFixed(1)}% rate`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : analytics.engagement_by_platform &&
          Object.keys(analytics.engagement_by_platform).length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Engagement by platform:{' '}
            {Object.entries(analytics.engagement_by_platform)
              .map(
                ([p, m]) =>
                  `${p} ${m.impressions}i/${m.likes}♥`,
              )
              .join(' · ')}
          </p>
        ) : null}
        {platformEntries.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            By platform:{' '}
            {platformEntries.map(([p, n]) => `${p} ${n}`).join(' · ')}
          </p>
        ) : null}
        {analytics.recent.length > 0 ? (
          <ul className="max-h-40 overflow-y-auto space-y-1 text-xs text-muted-foreground">
            {analytics.recent.slice(0, 12).map((e) => (
              <li key={e.event_id}>
                {e.occurred_at.slice(0, 16).replace('T', ' ')} · {e.kind}
                {e.platform ? ` · ${e.platform}` : ''}
                {e.content_id ? ` · ${e.content_id}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No analytics events yet — run the schedule worker or record engagement.
          </p>
        )}
      </section>

      {canWrite && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={campAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">New campaign</h2>
            <div className="space-y-1">
              <Label htmlFor="camp_name">Name</Label>
              <Input id="camp_name" name="name" required placeholder="Q3 brand push" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="camp_entity">Entity id (blank = firm-wide)</Label>
              <Input id="camp_entity" name="entity_id" placeholder="ENT-001" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="camp_obj">Objective</Label>
              <Input id="camp_obj" name="objective" placeholder="Awareness · leads" />
            </div>
            <Button type="submit" size="sm" disabled={campPending}>
              Create campaign
            </Button>
            <Msg state={campState} />
          </form>

          <form action={contentAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">New content</h2>
            <div className="space-y-1">
              <Label htmlFor="ct_title">Title</Label>
              <Input id="ct_title" name="title" required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ct_kind">Kind</Label>
                <select id="ct_kind" name="kind" className={field} defaultValue="social">
                  <option value="blog">Blog</option>
                  <option value="social">Social</option>
                  <option value="email">Email</option>
                  <option value="landing">Landing</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct_plat">Platform</Label>
                <select id="ct_plat" name="platform" className={field} defaultValue="linkedin">
                  <option value="linkedin">LinkedIn</option>
                  <option value="x">X</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="youtube">YouTube</option>
                  <option value="web">Web</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct_body">Body</Label>
              <textarea
                id="ct_body"
                name="body"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct_camp">Campaign id (optional)</Label>
              <Input id="ct_camp" name="campaign_id" placeholder="CMP-…" />
            </div>
            <Button type="submit" size="sm" disabled={contentPending}>
              Create content
            </Button>
            <Msg state={contentState} />
          </form>

          <form action={acctAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Register social account</h2>
            <p className="text-xs text-muted-foreground">
              Then Connect via OAuth (or stub) for LinkedIn, X, Meta, YouTube.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ac_plat">Platform</Label>
                <select id="ac_plat" name="platform" className={field} defaultValue="linkedin">
                  <option value="linkedin">LinkedIn</option>
                  <option value="x">X</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="youtube">YouTube</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ac_handle">Handle</Label>
                <Input id="ac_handle" name="handle" required placeholder="tagevc" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ac_entity">Entity id (optional)</Label>
              <Input id="ac_entity" name="entity_id" placeholder="ENT-001" />
            </div>
            <Button type="submit" size="sm" disabled={acctPending}>
              Register
            </Button>
            <Msg state={acctState} />
          </form>

          <form action={genAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">AI draft</h2>
            <div className="space-y-1">
              <Label htmlFor="gen_prompt">Prompt</Label>
              <textarea
                id="gen_prompt"
                name="prompt"
                required
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Announce our new fund thesis…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gen_kind">Kind</Label>
              <select id="gen_kind" name="kind" className={field} defaultValue="social">
                <option value="social">Social</option>
                <option value="blog">Blog</option>
                <option value="both">Both</option>
              </select>
            </div>
            <Button type="submit" size="sm" disabled={genPending}>
              {genPending ? 'Generating…' : 'Generate draft'}
            </Button>
            <Msg state={genState} />
          </form>

          <form action={voiceAction} className="space-y-3 rounded-lg border p-4 lg:col-span-2">
            <h2 className="text-sm font-semibold">Brand voice</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="bv_name">Name</Label>
                <Input id="bv_name" name="name" required placeholder="Tage VC default" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bv_entity">Entity id (blank = firm)</Label>
                <Input id="bv_entity" name="entity_id" placeholder="ENT-001" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="bv_tone">Tone guidelines</Label>
              <textarea
                id="bv_tone"
                name="tone_guidelines"
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Confident, concise, no hype…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bv_aud">Audience</Label>
              <Input id="bv_aud" name="audience" placeholder="Founders, LPs" />
            </div>
            <Button type="submit" size="sm" disabled={voicePending}>
              {voicePending ? 'Saving…' : 'Save brand voice'}
            </Button>
            <Msg state={voiceState} />
          </form>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setFlash(null);
              setErr(null);
              startTransition(async () => {
                const res = await runScheduleWorkerAction();
                if (res.ok) setFlash(res.message ?? 'Done');
                else setErr(res.error);
              });
            }}
          >
            {pending ? 'Running…' : 'Run schedule worker now'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => refreshTokensAction())}
          >
            Refresh OAuth tokens
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => pullEngagementAction())}
          >
            Pull live engagement
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => runApprovalSlaDigestAction())}
          >
            Run SLA digest
          </Button>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Brand voices</h2>
        {brandVoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet — firm default uses generic tone.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {brandVoices.map((v) => (
              <li key={v.voice_id} className="border-b border-border/40 py-1.5">
                <span className="font-medium">{v.name}</span>
                {v.entity_id ? ` · ${v.entity_id}` : ' · firm-wide'}
                {v.tone_guidelines ? (
                  <span className="block text-xs text-muted-foreground">
                    {v.tone_guidelines.slice(0, 120)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campaigns yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {campaigns.map((c) => (
              <li key={c.campaign_id} className="border-b border-border/40 py-2">
                <span className="font-mono text-xs">{c.campaign_id}</span>
                {' · '}
                <span className="font-medium">{c.name}</span>
                {' · '}
                {c.status}
                {c.entity_id ? ` · ${c.entity_id}` : ' · firm-wide'}
                {analytics.by_campaign[c.campaign_id] != null ? (
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    · {analytics.by_campaign[c.campaign_id]} events
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Content</h2>
        {content.length === 0 ? (
          <p className="text-sm text-muted-foreground">No content yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-2">Id</th>
                  <th className="py-2 pr-2">Title</th>
                  <th className="py-2 pr-2">Kind</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {content.map((c) => (
                  <tr key={c.content_id} className="border-b border-border/40">
                    <td className="py-2 pr-2 font-mono text-xs">{c.content_id}</td>
                    <td className="py-2 pr-2">
                      {c.title}
                      {c.ai_generated ? (
                        <span className="ml-1 text-xs text-sky-700">AI</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      {c.kind}
                      {c.platform ? `/${c.platform}` : ''}
                    </td>
                    <td className="py-2 pr-2">
                      {c.status}
                      {c.status === 'review' && c.approval_due_at ? (
                        <span
                          className={`ml-1 text-xs ${
                            Date.parse(c.approval_due_at) < Date.now()
                              ? 'text-amber-700'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {Date.parse(c.approval_due_at) < Date.now()
                            ? 'overdue'
                            : `due ${c.approval_due_at.slice(0, 10)}`}
                        </span>
                      ) : null}
                      {c.approval_ticket_id ? (
                        <span className="block text-xs text-muted-foreground">
                          {c.approval_ticket_id}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2">
                      {canWrite && (
                        <div className="flex flex-wrap gap-1">
                          {c.status === 'draft' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run(() => submitForReviewAction(c.content_id))
                              }
                            >
                              Submit review
                            </Button>
                          )}
                          {(c.status === 'draft' || c.status === 'review') && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run(() => approveContentAction(c.content_id))
                              }
                            >
                              Approve
                            </Button>
                          )}
                          {c.status !== 'published' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => {
                                setFlash(null);
                                setErr(null);
                                const when = window.prompt(
                                  'Schedule for (ISO datetime):',
                                  new Date(Date.now() + 60_000).toISOString(),
                                );
                                if (!when) return;
                                startTransition(async () => {
                                  const res = await scheduleContentAction(
                                    c.content_id,
                                    when,
                                  );
                                  if (res.ok) setFlash(res.message ?? 'Queued');
                                  else setErr(res.error);
                                });
                              }}
                            >
                              Schedule
                            </Button>
                          )}
                          {(c.status === 'published' ||
                            c.status === 'scheduled') && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => {
                                const impressions = Number(
                                  window.prompt('Impressions', '100') ?? '',
                                );
                                const clicks = Number(
                                  window.prompt('Clicks', '5') ?? '',
                                );
                                const likes = Number(
                                  window.prompt('Likes', '10') ?? '',
                                );
                                if (
                                  Number.isNaN(impressions) ||
                                  Number.isNaN(clicks) ||
                                  Number.isNaN(likes)
                                ) {
                                  return;
                                }
                                run(() =>
                                  recordEngagementAction(
                                    c.content_id,
                                    impressions,
                                    clicks,
                                    likes,
                                  ),
                                );
                              }}
                            >
                              Eng.
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Social accounts</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts registered.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {accounts.map((a) => (
              <li key={a.account_id} className="border-b border-border/40 py-2">
                <span className="font-medium">{a.platform}</span> @{a.handle}
                {' · '}
                {a.status}
                {a.entity_id ? ` · ${a.entity_id}` : ' · firm'}
                {canWrite &&
                  a.status !== 'connected' &&
                  OAUTH_SET.has(a.platform) && (
                    <a
                      href={`/api/marketing/oauth/${a.platform}?account_id=${encodeURIComponent(a.account_id)}`}
                      className="ml-2 text-xs font-medium underline-offset-4 hover:underline"
                    >
                      Connect
                    </a>
                  )}
                {canWrite && a.status !== 'connected' && (
                  <button
                    type="button"
                    className="ml-2 text-xs font-medium underline-offset-4 hover:underline"
                    disabled={pending}
                    onClick={() =>
                      run(() => stubConnectAccountAction(a.account_id))
                    }
                  >
                    Stub connect
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Schedule queue</h2>
          {scheduleJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Empty.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {scheduleJobs.map((j) => (
                <li key={j.job_id}>
                  <span
                    className={
                      j.status === 'pending'
                        ? 'text-amber-700'
                        : j.status === 'failed'
                          ? 'text-destructive'
                          : j.status === 'succeeded'
                            ? 'text-emerald-700'
                            : undefined
                    }
                  >
                    {j.status}
                  </span>
                  {' · '}
                  {j.scheduled_for.slice(0, 16).replace('T', ' ')} · {j.content_id}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Generation jobs</h2>
          {generationJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Empty.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {generationJobs.map((j) => (
                <li key={j.job_id}>
                  {j.job_id} · {j.status} · {j.kind}
                  {j.result_content_ids.length
                    ? ` → ${j.result_content_ids.join(', ')}`
                    : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
