import { supabase } from './supabase';

async function authHeaders(): Promise<HeadersInit> {
  if (!supabase) throw new Error('Supabase is not configured');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
}

async function postFn<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json;
}

export type CalendarStatus = {
  configured: boolean;
  connected: boolean;
  work_email: string | null;
  login_email: string;
  preferred_work_email: string;
  microsoft_email: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  capabilities: {
    list_events: boolean;
    create_events: boolean;
    edit_events: boolean;
    delete_events: boolean;
  };
  setup_hint: string | null;
  healthy: boolean;
};

export type CalendarEvent = {
  id: string;
  subject: string;
  body_preview: string | null;
  is_all_day: boolean;
  show_as: string | null;
  web_link: string | null;
  location: string | null;
  start: string | null;
  start_timezone: string;
  end: string | null;
  end_timezone: string;
  organizer_name: string | null;
  organizer_email: string | null;
};

export async function fetchCalendarStatus(): Promise<CalendarStatus> {
  return postFn<CalendarStatus>('microsoft-calendar-status');
}

export async function startCalendarOAuth(
  redirectPath = '/sales/calendar',
): Promise<{ url: string; login_hint: string }> {
  return postFn('microsoft-calendar-oauth-start', { redirect_path: redirectPath });
}

export async function disconnectCalendar(): Promise<void> {
  await postFn('microsoft-calendar-disconnect');
}

export async function fetchCalendarEvents(
  start: string,
  end: string,
): Promise<CalendarEvent[]> {
  const res = await postFn<{ events: CalendarEvent[] }>('microsoft-calendar-events', {
    start,
    end,
  });
  return res.events ?? [];
}

export async function setMyWorkEmail(email: string | null): Promise<string | null> {
  const { data, error } = await requireRpc().rpc('set_my_work_email', {
    p_email: email?.trim() || null,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

function requireRpc() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}
