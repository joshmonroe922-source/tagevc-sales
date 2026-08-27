import { grokChatCompletion, xaiConfigured } from '@/lib/think-tank/llm';
import { collectTageThinkTankContext } from '@/lib/think-tank/context';
import type { SessionContext } from '@/lib/rbac/session';
import { APP_ROLE_LABELS } from '@/lib/types/roles';
import { entityDisplayName } from '@/lib/entities/display-name';

export type HomeBriefing = {
  text: string;
  generatedAt: string;
  model: string | null;
  source: 'live' | 'fallback';
};

/** Fail soft — never let Grok hang the home page. */
const BRIEFING_LLM_MS = 4_000;

/** Per-instance short cache so refresh / multi-tab doesn't re-hit Grok every time. */
const BRIEFING_CACHE_TTL_MS = 10 * 60 * 1000;
const briefingCache = new Map<
  string,
  { expires: number; value: HomeBriefing }
>();

function fallbackBriefing(
  session: SessionContext,
  ctx: Record<string, unknown> | null,
  generatedAt: string,
): HomeBriefing {
  const roleLabel = APP_ROLE_LABELS[session.profile.role];
  const company = entityDisplayName(session.profile.entity_id);
  const hot = (ctx?.queues as { overdueServiceItems?: unknown[] } | undefined)
    ?.overdueServiceItems;
  const hotCount = Array.isArray(hot) ? hot.length : 0;
  const counts = (ctx?.counts as Record<string, number> | undefined) ?? {};
  const lines = [
    `Good day — you're operating as ${roleLabel} for ${company}.`,
    counts.openSsTickets != null
      ? `You have ${counts.openSsTickets} open service items` +
        (counts.overdueSsTickets
          ? ` (${counts.overdueSsTickets} overdue).`
          : '.')
      : 'Service queue data is not fully connected yet.',
    counts.activeLeads != null
      ? `Pipeline: ${counts.activeLeads} active leads in view.`
      : 'Pipeline KPIs are partial — check Dashboard for details.',
    hotCount > 0
      ? `Hot now: clear ${hotCount} overdue item(s) first, then use Think Tank below to plan the rest of the day.`
      : 'No overdue service flags in context — use Think Tank below to set today’s win and protect your goals.',
    !xaiConfigured()
      ? 'AI briefing is in fallback mode (set XAI_API_KEY for live coaching).'
      : '',
  ].filter(Boolean);
  return {
    text: lines.join('\n\n'),
    generatedAt,
    model: null,
    source: 'fallback',
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Concise AI daily briefing for Home. Fail soft without API key.
 * Cache + LLM timeout match Recruit 619 so streamed Suspense never stalls.
 */
export async function generateHomeBriefing(
  session: SessionContext,
): Promise<HomeBriefing> {
  const cacheKey = session.profile.id;
  const hit = briefingCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const generatedAt = new Date().toISOString();
  let ctx: Record<string, unknown> | null = null;

  try {
    ctx = await collectTageThinkTankContext(session);
  } catch {
    return fallbackBriefing(session, null, generatedAt);
  }

  if (!xaiConfigured()) {
    const value = fallbackBriefing(session, ctx, generatedAt);
    briefingCache.set(cacheKey, {
      expires: Date.now() + BRIEFING_CACHE_TTL_MS,
      value,
    });
    return value;
  }

  const roleLabel = APP_ROLE_LABELS[session.profile.role];
  const company = entityDisplayName(session.profile.entity_id);

  const result = await withTimeout(
    grokChatCompletion({
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: `You are the Tage VC Home briefing writer. Write a short (120–180 words), clear, encouraging, operational daily note for this user.
Cover: (1) where they stand on revenue/operating responsibility if applicable, (2) KPI/goal posture, (3) key signals from their desk, (4) hot items to complete now.
Use company names, not entity IDs. If data is missing, say so plainly and still recommend next actions.
No markdown headings. Short paragraphs or tight bullets. Do not invent numbers.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            user: session.profile.full_name || session.profile.email,
            role: roleLabel,
            company,
            context: ctx,
          }),
        },
      ],
    }),
    BRIEFING_LLM_MS,
    () => ({
      content: null,
      model: null,
      provider: 'grok' as const,
      error: 'timeout',
    }),
  );

  const value =
    result.content != null
      ? {
          text: result.content.trim(),
          generatedAt,
          model: result.model,
          source: 'live' as const,
        }
      : fallbackBriefing(session, ctx, generatedAt);

  briefingCache.set(cacheKey, {
    expires: Date.now() + BRIEFING_CACHE_TTL_MS,
    value,
  });
  return value;
}
