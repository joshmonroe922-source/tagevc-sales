import { notFound, redirect } from 'next/navigation';
import { CsuiteRoleClient } from '@/components/ai-csuite/csuite-role-client';
import { generateCsuiteBriefing } from '@/lib/ai-csuite/briefing';
import { AI_CSUITE_ROLE_CONFIG, isAiCsuiteRole } from '@/lib/ai-csuite/roles';
import {
  collectContextForRole,
  getOrCreateCsuiteThread,
  listCsuiteMessages,
} from '@/lib/ai-csuite/service';
import { getSessionContext } from '@/lib/rbac/session';
import {
  CONSOLIDATED_SELECT_VALUE,
  ENTITY_SELECT_LABELS,
  ENTITY_SELECT_PRIORITY_IDS,
} from '@/lib/entities/display-order';

type Props = {
  params: Promise<{ role: string }>;
  searchParams?: Promise<{ entity?: string }>;
};

export default async function CsuiteRolePage({ params, searchParams }: Props) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.realRole !== 'visionary') redirect('/home');
  if (ctx.liveLookActive) redirect('/home');

  const { role: raw } = await params;
  if (!isAiCsuiteRole(raw)) notFound();
  const cfg = AI_CSUITE_ROLE_CONFIG[raw];
  const requestedEntity = (await searchParams)?.entity?.trim() || null;
  const entityId =
    raw === 'cfo' &&
    requestedEntity &&
    (ENTITY_SELECT_PRIORITY_IDS as readonly string[]).includes(requestedEntity)
      ? requestedEntity
      : null;

  let messages: Awaited<ReturnType<typeof listCsuiteMessages>> = [];
  const [context, briefing] = await Promise.all([
    collectContextForRole(raw, entityId),
    generateCsuiteBriefing({ role: raw, entityId }),
  ]);
  let contextError: string | undefined;
  try {
    const thread = await getOrCreateCsuiteThread(raw);
    messages = await listCsuiteMessages(thread.id);
  } catch (e) {
    contextError =
      e instanceof Error
        ? e.message
        : 'Thread store unavailable — apply phase79 SQL';
  }

  return (
    <div className="space-y-4">
      {raw === 'cfo' ? (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">CFO company scope</span>
            <select
              name="entity"
              defaultValue={entityId ?? CONSOLIDATED_SELECT_VALUE}
              className="h-9 min-w-56 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value={CONSOLIDATED_SELECT_VALUE}>Consolidated</option>
              {ENTITY_SELECT_PRIORITY_IDS.map((id) => (
                <option key={id} value={id}>
                  {ENTITY_SELECT_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-9 rounded-md border border-border px-3 text-sm font-medium"
          >
            Apply scope
          </button>
        </form>
      ) : null}
      <CsuiteRoleClient
        role={raw}
        title={cfg.displayName}
        subtitle={`${cfg.reportsOn}. ${entityId ? `Company scope: ${ENTITY_SELECT_LABELS[entityId]}. ` : ''}Draft-only recommendations — human gates on money, legal send, and secrets.`}
        initialMessages={messages}
        context={context}
        briefing={briefing}
        contextError={contextError}
      />
    </div>
  );
}
