import { ThinkTankClient } from '@/components/think-tank/ThinkTankClient';
import { HomeBriefingCard } from '@/components/home/home-briefing-card';
import { generateHomeBriefing } from '@/lib/home/briefing';
import { getSessionContext } from '@/lib/rbac/session';
import { thinkTankRoleBand } from '@/lib/think-tank/prompts';
import { APP_ROLE_LABELS } from '@/lib/types/roles';
import { entityDisplayName } from '@/lib/entities/display-name';

export default async function HomePage() {
  const session = await getSessionContext();
  if (!session) return null;

  // Briefing only — Think Tank hydrates client-side so TTFB never waits on
  // thread scans or attachment reads (Entity OS lock still applies in actions).
  const briefing = await generateHomeBriefing(session);

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

      <HomeBriefingCard initial={briefing} />

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
