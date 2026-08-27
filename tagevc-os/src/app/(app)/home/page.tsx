import { Suspense } from 'react';
import { ThinkTankClient } from '@/components/think-tank/ThinkTankClient';
import { HomeBriefingCard } from '@/components/home/home-briefing-card';
import { generateHomeBriefing } from '@/lib/home/briefing';
import { getSessionContext } from '@/lib/rbac/session';
import { thinkTankRoleBand } from '@/lib/think-tank/prompts';
import { APP_ROLE_LABELS } from '@/lib/types/roles';
import { entityDisplayName } from '@/lib/entities/display-name';

function HomeBriefingSkeleton() {
  return (
    <section
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      aria-busy="true"
      aria-label="Loading briefing"
    >
      <div className="mb-3 h-5 w-40 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-3 w-10/12 animate-pulse rounded bg-muted" />
        <div className="h-3 w-8/12 animate-pulse rounded bg-muted" />
      </div>
    </section>
  );
}

async function HomeBriefingDeferred() {
  const session = await getSessionContext();
  if (!session) return null;
  const briefing = await generateHomeBriefing(session).catch(() => ({
    text: 'Briefing is temporarily unavailable. Try Think Tank below, or refresh in a minute.',
    generatedAt: new Date().toISOString(),
    model: null,
    source: 'fallback' as const,
  }));
  return <HomeBriefingCard initial={briefing} />;
}

/**
 * Home shell paints first; briefing streams (Grok + desk context).
 * Think Tank hydrates client-side so TTFB never waits on threads.
 */
export default async function HomePage() {
  const session = await getSessionContext();
  if (!session) return null;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Home
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {session.profile.full_name || 'Welcome'}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {APP_ROLE_LABELS[session.profile.role]} ·{' '}
          {entityDisplayName(session.profile.entity_id)} — your AI briefing and
          Think Tank coach for today.
        </p>
      </header>

      <Suspense fallback={<HomeBriefingSkeleton />}>
        <HomeBriefingDeferred />
      </Suspense>

      <ThinkTankClient
        roleBand={thinkTankRoleBand(session.realRole)}
        viewAsLabel={
          session.impersonatingAs
            ? APP_ROLE_LABELS[session.impersonatingAs]
            : null
        }
        compact
      />
    </div>
  );
}
