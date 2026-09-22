'use client';

import { Button } from '@/components/ui/button';
import { SESSION_TIMEOUT_COPY } from '@/lib/auth/session-timeout';

export function SessionTimeoutScreen({
  productName,
  headingClassName = 'text-[#3a414f]',
  primaryClassName = 'bg-[#3a414f] text-white hover:bg-[#535c63]',
}: {
  productName: string;
  headingClassName?: string;
  primaryClassName?: string;
}) {
  return (
    <div className="relative flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 20% 0%, #d7d3c3 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, #9f957c33 0%, transparent 45%), #ece9e6',
        }}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-[#d7d3c3] bg-white/90 px-8 py-10 text-center shadow-sm backdrop-blur">
        <p className="text-xs font-medium tracking-[0.2em] text-[#7c7871] uppercase">
          {productName}
        </p>
        <p className="mt-3 text-xs font-medium tracking-[0.18em] text-[#7c7871] uppercase">
          {SESSION_TIMEOUT_COPY.kicker}
        </p>
        <h1 className={`font-heading mt-3 text-2xl font-semibold ${headingClassName}`}>
          {SESSION_TIMEOUT_COPY.title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[#535c63]">
          {SESSION_TIMEOUT_COPY.body}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            className={primaryClassName}
            size="lg"
            onClick={() => window.location.reload()}
          >
            Refresh
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              window.location.assign('/login?error=timeout');
            }}
          >
            Log in again
          </Button>
        </div>
      </div>
    </div>
  );
}
