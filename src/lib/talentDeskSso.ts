import { TALENTDESK_PATHS } from './recruit619';
import { supabase } from './supabase';

export type TalentDeskSsoResult = {
  ok: true;
  email: string;
  expires_in: number;
  redirect_url: string;
};

function pathFor(
  path: keyof typeof TALENTDESK_PATHS | (string & {}),
): string {
  if (path in TALENTDESK_PATHS) {
    return TALENTDESK_PATHS[path as keyof typeof TALENTDESK_PATHS];
  }
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Ask the portal edge function for a short-lived SSO URL, then open TalentDesk.
 * Direct visits to app.recruit619.com still require normal Auth.js login.
 */
export async function openTalentDeskWithSso(
  path: keyof typeof TALENTDESK_PATHS | (string & {}) = 'placement',
  target: '_blank' | '_self' = '_blank',
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in to the Tage portal');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/talentdesk-sso`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ next: pathFor(path) }),
  });

  const json = (await res.json()) as TalentDeskSsoResult & { error?: string };
  if (!res.ok || !json.redirect_url) {
    throw new Error(json.error ?? `TalentDesk SSO failed (${res.status})`);
  }

  if (target === '_self') {
    window.location.assign(json.redirect_url);
    return;
  }

  const win = window.open(json.redirect_url, '_blank', 'noopener,noreferrer');
  if (!win) {
    // Popup blocked — fall back to same-tab navigation
    window.location.assign(json.redirect_url);
  }
}
