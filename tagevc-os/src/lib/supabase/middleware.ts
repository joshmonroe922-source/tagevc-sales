import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith('/login') ||
    path.startsWith('/auth') ||
    path.startsWith('/api/docusign/webhook') ||
    path.startsWith('/_next') ||
    path === '/favicon.ico';

  if (process.env.DEV_BYPASS_AUTH === '1') {
    if (path === '/login') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/command-center';
      return NextResponse.redirect(redirectUrl);
    }
    return supabaseResponse;
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
    redirectUrl.pathname = '/command-center';
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
