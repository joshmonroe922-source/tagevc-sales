'use client';

import { useEffect } from 'react';

import { SessionTimeoutScreen } from '@/components/auth/session-timeout-screen';
import './globals.css';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <SessionTimeoutScreen productName="Tage Venture Capital" />
      </body>
    </html>
  );
}
