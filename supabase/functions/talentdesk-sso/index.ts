import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  preferredWorkEmail,
  requireActiveSalesUser,
} from '../_shared/microsoftGraph.ts';
import {
  isTalentDeskSsoEmailAllowed,
  mapPortalEmailToTalentDesk,
  normalizeTalentDeskNextPath,
  signPortalSsoToken,
} from '../_shared/portalSso.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

function talentDeskOrigin(): string {
  const raw =
    Deno.env.get('TALENTDESK_ORIGIN')?.trim() ||
    'https://app.recruit619.com';
  return raw.replace(/\/$/, '');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const secret =
      Deno.env.get('TALENTDESK_SSO_SECRET')?.trim() ||
      Deno.env.get('PORTAL_SSO_SECRET')?.trim();
    if (!secret) {
      return jsonResponse(
        { error: 'TalentDesk SSO is not configured (TALENTDESK_SSO_SECRET)' },
        503,
        origin,
      );
    }

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

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const nextPath = normalizeTalentDeskNextPath(body.next);
    const portalEmail = preferredWorkEmail(salesUser);

    if (!portalEmail.includes('@')) {
      return jsonResponse(
        { error: 'Portal user has no valid work email for TalentDesk SSO' },
        400,
        origin,
      );
    }

    // Portal may be @tagevc.com; TalentDesk User is typically same local-part @recruit619.com
    const email = mapPortalEmailToTalentDesk(portalEmail);

    if (!isTalentDeskSsoEmailAllowed(portalEmail, email)) {
      return jsonResponse(
        {
          error: `TalentDesk SSO requires a @recruit619.com work email (or AUTH_ALLOWLIST). Current: ${portalEmail} → ${email}`,
          code: 'email_not_allowlisted',
          portal_email: portalEmail,
          talentdesk_email: email,
        },
        403,
        origin,
      );
    }

    const token = await signPortalSsoToken(email, secret);
    const redirectUrl = new URL(`${talentDeskOrigin()}/api/auth/portal-sso`);
    redirectUrl.searchParams.set('token', token);
    redirectUrl.searchParams.set('next', nextPath);

    return jsonResponse(
      {
        ok: true,
        email,
        portal_email: portalEmail,
        expires_in: 60,
        redirect_url: redirectUrl.toString(),
      },
      200,
      origin,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SSO failed';
    console.error('talentdesk-sso error', message);
    return jsonResponse({ error: message }, 500, origin);
  }
});
