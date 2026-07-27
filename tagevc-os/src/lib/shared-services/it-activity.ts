import { createClient } from '@/lib/supabase/server';
import type { ActivityEvent, ActivityListResult } from '@/lib/data/activity';

/**
 * Operational IT activity — distinct from Visionary-only os_audit_events.
 * Matches shared_services rows tagged with IT / Intune action prefixes.
 */
export function isItOperationalActivity(event: {
  module?: string | null;
  action?: string | null;
}): boolean {
  const action = (event.action ?? '').toLowerCase();
  if (!action) return false;
  if (action.startsWith('it_')) return true;
  if (action.includes('intune')) return true;
  if (event.module === 'shared_services' && action.includes('it_')) return true;
  return false;
}

export async function listItActivity(
  limit = 100,
): Promise<ActivityListResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('activity_events')
      .select('*')
      .eq('module', 'shared_services')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit * 4, 100), 400));

    if (error) {
      console.error('listItActivity', error.message);
      return {
        ok: false,
        events: [],
        error:
          error.message.includes('activity_events') || error.code === '42P01'
            ? 'Activity table unavailable. Apply Phase 7 SQL in Supabase.'
            : error.message,
      };
    }

    const events = ((data ?? []) as ActivityEvent[])
      .filter(isItOperationalActivity)
      .slice(0, Math.min(limit, 200))
      .map((event) => ({
        ...event,
        impersonating_as: event.impersonating_as ?? null,
        real_role: event.real_role ?? null,
      }));

    return { ok: true, events, error: null };
  } catch (e) {
    console.error('listItActivity', e);
    return {
      ok: false,
      events: [],
      error: e instanceof Error ? e.message : 'Failed to load IT activity',
    };
  }
}
