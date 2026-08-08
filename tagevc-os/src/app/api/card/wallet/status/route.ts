import { NextResponse } from 'next/server';
import { walletAvailability } from '@/lib/digital-cards/wallet';

export const dynamic = 'force-dynamic';

/** Public readiness probe — no secrets; used to hide buttons when unset. */
export async function GET() {
  return NextResponse.json(
    { ok: true, ...walletAvailability() },
    {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
}
