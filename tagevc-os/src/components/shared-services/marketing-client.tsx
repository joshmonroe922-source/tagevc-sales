'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  createCampaignAction,
  createContentAction,
  generateDraftAction,
  registerAccountAction,
  scheduleContentAction,
  type MarketingActionResult,
} from '@/app/(app)/shared-services/marketing/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

export function MarketingClient({
  campaigns,
  content,
  accounts,
  scheduleJobs,
  generationJobs,
  canWrite,
  tableError,
  foundation,
}: {
  campaigns: MarketingCampaign[];
  content: MarketingContent[];
  accounts: MarketingSocialAccount[];
  scheduleJobs: MarketingScheduleJob[];
  generationJobs: MarketingGenerationJob[];
  canWrite: boolean;
  tableError?: string;
  foundation: {
    ai_provider: string;
    scheduler_enabled: boolean;
    oauth_tokens_stored: boolean;
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
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Foundation Phase {foundation.phase} · AI provider:{' '}
        <span className="font-medium text-foreground">{foundation.ai_provider}</span>
        {' · '}
        Scheduler:{' '}
        {foundation.scheduler_enabled ? 'enabled (queue only)' : 'queue-only'}
        {' · '}
        OAuth tokens: not stored
      </div>

      {tableError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Tables unavailable — apply phase22_marketing.sql. {tableError}
        </p>
      )}
      {(flash || err) && (
        <p className={`text-sm ${err ? 'text-destructive' : 'text-emerald-700'}`}>
          {err ?? flash}
        </p>
      )}

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
              Metadata only — OAuth connect in Phase 23+.
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
            <h2 className="text-sm font-semibold">AI draft (stub)</h2>
            <p className="text-xs text-muted-foreground">
              Runs the pluggable stub provider — no external LLM yet.
            </p>
            <div className="space-y-1">
              <Label htmlFor="gen_prompt">Prompt</Label>
              <textarea
                id="gen_prompt"
                name="prompt"
                required
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Announce portfolio company launch…"
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
              Generate draft
            </Button>
            <Msg state={genState} />
          </form>
        </div>
      )}

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
                    <td className="py-2 pr-2">{c.status}</td>
                    <td className="py-2">
                      {canWrite && c.status !== 'published' && (
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
                              new Date(Date.now() + 86400000).toISOString(),
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
                  {j.job_id} · {j.status} · {j.scheduled_for.slice(0, 16)} ·{' '}
                  {j.content_id}
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
