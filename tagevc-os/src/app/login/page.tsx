'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithMicrosoft() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          redirectTo: `${origin}/auth/callback`,
          scopes: 'email openid profile offline_access',
        },
      });
      if (oauthError) setError(oauthError.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 20% 0%, #d7d3c3 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, #9f957c33 0%, transparent 45%), #ece9e6',
        }}
      />
      <Card className="relative w-full max-w-md border-[#d7d3c3] bg-white/90 shadow-sm backdrop-blur">
        <CardHeader className="space-y-3">
          <p className="text-xs font-medium tracking-[0.2em] text-[#7c7871] uppercase">
            Tage Venture Capital
          </p>
          <CardTitle className="font-heading text-2xl text-[#3a414f]">
            Sign in
          </CardTitle>
          <CardDescription className="text-[#535c63]">
            Use your Microsoft 365 work account to access the Tage VC Operating
            System.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full bg-[#3a414f] text-white hover:bg-[#535c63]"
            size="lg"
            disabled={loading}
            onClick={signInWithMicrosoft}
          >
            {loading ? 'Redirecting…' : 'Continue with Microsoft'}
          </Button>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Enable the Azure provider in Supabase Auth and register the callback
            URL. Role assignment comes from your{' '}
            <code className="rounded bg-muted px-1">profiles</code> row.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
