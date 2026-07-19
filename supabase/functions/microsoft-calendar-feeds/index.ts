import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  encryptSecret,
  getMsConfig,
  requireActiveSalesUser,
} from '../_shared/microsoftGraph.ts';
import { isLikelyIcsUrl } from '../_shared/icsCalendar.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  action?: 'list' | 'add' | 'remove';
  name?: string;
  url?: string;
  color?: string;
  feed_id?: string;
};

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const userClient = createUserClient(authHeader);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const service = createServiceClient();
    const salesUser = await requireActiveSalesUser(service, user.email);
    if (!salesUser) {
      return jsonResponse({ error: 'Forbidden' }, 403, origin);
    }

    const config = getMsConfig();
    const body = (await req.json()) as Body;
    const action = body.action ?? 'list';

    if (action === 'list') {
      const { data, error } = await service
        .from('personal_calendar_feeds')
        .select('id, name, color, created_at')
        .eq('sales_user_id', salesUser.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return jsonResponse(
        {
          feeds: (data ?? []).map((f) => ({
            id: f.id,
            name: f.name,
            color: f.color,
            source: 'ics' as const,
            created_at: f.created_at,
          })),
          hint:
            'Google/personal calendars added via Outlook “Add personal calendars” are not visible to Microsoft Graph. Paste a Google secret ICS URL here, or use Outlook → Add calendar → Subscribe from web.',
        },
        200,
        origin,
      );
    }

    if (action === 'add') {
      const name = (body.name ?? 'Personal').trim().slice(0, 120) || 'Personal';
      const url = (body.url ?? '').trim();
      const color = (body.color ?? '#5B8DEF').trim().slice(0, 32) || '#5B8DEF';
      if (!url) {
        return jsonResponse({ error: 'ICS URL is required' }, 400, origin);
      }
      if (!isLikelyIcsUrl(url)) {
        return jsonResponse(
          {
            error:
              'Paste an https ICS / iCal URL (Google Calendar → Settings → Integrate calendar → Secret address in iCal format).',
          },
          400,
          origin,
        );
      }

      const { count } = await service
        .from('personal_calendar_feeds')
        .select('id', { count: 'exact', head: true })
        .eq('sales_user_id', salesUser.id);
      if ((count ?? 0) >= 5) {
        return jsonResponse(
          { error: 'Maximum of 5 personal calendar feeds' },
          400,
          origin,
        );
      }

      const urlEnc = await encryptSecret(url, config.encryptionKey);
      const { data, error } = await service
        .from('personal_calendar_feeds')
        .insert({
          sales_user_id: salesUser.id,
          name,
          color,
          url_enc: urlEnc,
        })
        .select('id, name, color, created_at')
        .single();
      if (error) throw error;

      return jsonResponse(
        {
          feed: {
            id: data.id,
            name: data.name,
            color: data.color,
            source: 'ics' as const,
            created_at: data.created_at,
          },
        },
        200,
        origin,
      );
    }

    if (action === 'remove') {
      const feedId = (body.feed_id ?? '').trim();
      if (!feedId) {
        return jsonResponse({ error: 'feed_id is required' }, 400, origin);
      }
      const { error } = await service
        .from('personal_calendar_feeds')
        .delete()
        .eq('id', feedId)
        .eq('sales_user_id', salesUser.id);
      if (error) throw error;
      return jsonResponse({ ok: true }, 200, origin);
    }

    return jsonResponse({ error: 'Unknown action' }, 400, origin);
  } catch (err) {
    console.error('microsoft-calendar-feeds', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Feed request failed' },
      500,
      origin,
    );
  }
});
