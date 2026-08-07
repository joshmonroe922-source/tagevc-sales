import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith('/login') ||
    path.startsWith('/auth') ||
    path.startsWith('/api/docusign/webhook') ||
    // Machine-auth APIs (route handlers enforce secrets / signed tokens).
    // Subsidiary portals (Recruit, Instant NDA, future) hit these without cookies.
    path.startsWith('/api/subsidiary/tickets') ||
    path.startsWith('/api/finance/ies/snapshot') ||
    path.startsWith('/api/presence') ||
    // Identity machine-auth routes (Bearer DIGEST/CRON/HRIS secret in handlers).
    // Session-gated: wipe-guard, remote-help, entity-bootstrap — keep cookie auth.
    path.startsWith('/api/identity/lifecycle') ||
    path.startsWith('/api/identity/events') ||
    path.startsWith('/api/identity/hris/') ||
    path.startsWith('/api/identity/workers/') ||
    path.startsWith('/api/identity/worker') ||
    path.startsWith('/api/identity/fo24') ||
    path.startsWith('/api/shared-services/intake') ||
    path.startsWith('/api/rollups/ingest') ||
    path.startsWith('/api/deal-flow/website-intake') ||
    path.startsWith('/api/screening/verified-first/webhook') ||
    // Digital business cards — public profile + exchange (no login).
    path.startsWith('/card/') ||
    path.startsWith('/p/') ||
    path.startsWith('/api/card/') ||
    // Recruit 619 ECC EnrollmentService (Bearer TAGE_CAMPAIGN_API_TOKEN / TAGE_ECC_API_SECRET).
    path.startsWith('/api/campaign/') ||
    path.startsWith('/api/partners/') ||
    path.startsWith('/_next') ||
    path === '/favicon.ico';

  if (process.env.DEV_BYPASS_AUTH === '1') {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
      console.error('DEV_BYPASS_AUTH is set in production — ignoring for safety');
    } else {
      if (path === '/login') {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = '/home';
        return NextResponse.redirect(redirectUrl);
      }
      return supabaseResponse;
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (!isPublic && path !== '/') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/login';
      return NextResponse.redirect(redirectUrl);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', path);
    // Preserve OAuth error params when Supabase redirects to Site URL
    const err = request.nextUrl.searchParams.get('error');
    const errDesc = request.nextUrl.searchParams.get('error_description');
    if (err || errDesc) {
      redirectUrl.searchParams.set('error', 'auth');
      redirectUrl.searchParams.set(
        'detail',
        errDesc || err || 'oauth_failed',
      );
    }
    return NextResponse.redirect(redirectUrl);
  }

  if (user && path === '/login') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/home';
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
