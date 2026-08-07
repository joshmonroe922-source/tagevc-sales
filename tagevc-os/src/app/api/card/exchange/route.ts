import { NextResponse } from 'next/server';
import { submitExchange } from '@/lib/digital-cards/exchange';
import {
  clientIpFromRequest,
  enforcePublicRateLimit,
} from '@/lib/digital-cards/rate-limit';
import type { ExchangeSubmitInput } from '@/lib/digital-cards/types';

export async function POST(request: Request) {
  let body: ExchangeSubmitInput;
  try {
    body = (await request.json()) as ExchangeSubmitInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  const publicId = (body.public_id || '').trim();
  if (!publicId) {
    return NextResponse.json(
      { ok: false, error: 'public_id required' },
      { status: 400 },
    );
  }

  const ip = clientIpFromRequest(request);
  const rl = await enforcePublicRateLimit({
    kind: 'exchange',
    publicId,
    ip,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests — try again later' },
      {
        status: 429,
        headers: rl.retry_after_sec
          ? { 'Retry-After': String(rl.retry_after_sec) }
          : undefined,
      },
    );
  }

  const result = await submitExchange(body, { ip });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    contact_id: result.contact_id,
    replay: result.replay,
    dedupe: result.dedupe,
    routing: result.routing,
  });
}
