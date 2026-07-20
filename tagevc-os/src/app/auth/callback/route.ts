import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const oauthError =
    searchParams.get('error_description') ?? searchParams.get('error');
  let next = searchParams.get('next') ?? '/command-center';
  if (!next.startsWith('/')) next = '/command-center';

  const forwardedHost = request.headers.get('x-forwarded-host');
  const redirectBase =
    process.env.NODE_ENV === 'development'
      ? origin
      : forwardedHost
        ? `https://${forwardedHost}`
        : origin;

  if (code) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      return NextResponse.redirect(
        `${redirectBase}/login?error=auth&detail=${encodeURIComponent('missing_supabase_env')}`,
      );
    }

    const successRedirect = NextResponse.redirect(`${redirectBase}${next}`);
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            successRedirect.cookies.set(name, value, options);
          });
        },
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return successRedirect;
    }
    const detail = encodeURIComponent(error.message || 'session_exchange_failed');
    return NextResponse.redirect(
      `${redirectBase}/login?error=auth&detail=${detail}`,
    );
  }

  const detail = encodeURIComponent(oauthError || 'missing_code');
  return NextResponse.redirect(
    `${redirectBase}/login?error=auth&detail=${detail}`,
  );
}
