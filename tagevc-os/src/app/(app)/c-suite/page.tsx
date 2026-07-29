import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CsuiteRoleClient } from '@/components/ai-csuite/csuite-role-client';
import {
  AI_CSUITE_NAV_ORDER,
  AI_CSUITE_ROLE_CONFIG,
} from '@/lib/ai-csuite/roles';
import { generateCsuiteBriefing } from '@/lib/ai-csuite/briefing';
import {
  collectContextForRole,
  getOrCreateCsuiteThread,
  listCsuiteMessages,
  weeklyEmailResidualNote,
} from '@/lib/ai-csuite/service';
import { getSessionContext } from '@/lib/rbac/session';
import { isVisionaryBreadthRole } from '@/lib/types/roles';

export default async function CsuiteHqPage() {
  const ctx = await getSessionContext();
  if (!ctx || !isVisionaryBreadthRole(ctx.profile.role)) redirect('/home');
  if (ctx.liveLookActive) redirect('/home');

  let messages: Awaited<ReturnType<typeof listCsuiteMessages>> = [];
  const [context, briefing] = await Promise.all([
    collectContextForRole('hq'),
    generateCsuiteBriefing({ role: 'hq' }),
  ]);
  let contextError: string | undefined;
  try {
    const thread = await getOrCreateCsuiteThread('hq');
    messages = await listCsuiteMessages(thread.id);
  } catch (e) {
    contextError =
      e instanceof Error
        ? e.message
        : 'Thread store unavailable — apply phase79 SQL';
  }

  return (
    <div className="space-y-8">
      <CsuiteRoleClient
        role="hq"
        title="C-Suite HQ"
        subtitle="Firm executive intelligence rollup — AI CFO / CTO / CMO / CHRO / CLO report here. Separate from Think Tank."
        initialMessages={messages}
        context={context}
        briefing={briefing}
        contextError={contextError}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#3a414f]">Executives</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {AI_CSUITE_NAV_ORDER.filter((r) => r !== 'hq').map((role) => {
            const cfg = AI_CSUITE_ROLE_CONFIG[role];
            return (
              <li key={role}>
                <Link
                  href={cfg.href}
                  className="block rounded-md border border-border px-3 py-2 text-sm hover:border-[#3a414f]/40"
                >
                  <span className="font-medium">{cfg.displayName}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {cfg.reportsOn}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">{weeklyEmailResidualNote()}</p>
      </section>
    </div>
  );
}
