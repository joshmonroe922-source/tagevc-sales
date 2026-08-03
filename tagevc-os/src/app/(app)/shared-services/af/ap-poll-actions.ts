'use server';

import { getSessionContext } from '@/lib/rbac/session';
import { pollApInboundMailbox } from '@/lib/af/ap/inbound-poller';

export async function actionPollApInbound() {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Unauthorized' };
  if (
    session.realRole !== 'visionary' &&
    session.profile.role !== 'visionary' &&
    session.profile.role !== 'admin'
  ) {
    return { ok: false as const, error: 'Admin / visionary only' };
  }
  const result = await pollApInboundMailbox({ top: 40 });
  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error || 'poll failed (Graph secret may be missing)',
    };
  }
  return {
    ok: true as const,
    processed: result.ingested,
  };
}
