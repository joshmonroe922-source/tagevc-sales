import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { taggedCardUrl, parseSourceChannel } from '@/lib/digital-cards/urls';

type Ctx = { params: Promise<{ public_id: string }> };

/**
 * Self-hosted QR PNG for a tagged public card URL.
 * Source of truth remains the profile URL (not a static vCard blob).
 */
export async function GET(request: Request, ctx: Ctx) {
  const { public_id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(public_id)) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
  }

  const url = new URL(request.url);
  const sourceChannel = parseSourceChannel(url.searchParams.get('src'));
  const sizeRaw = Number(url.searchParams.get('size') || '480');
  const size = Number.isFinite(sizeRaw)
    ? Math.min(1024, Math.max(128, Math.round(sizeRaw)))
    : 480;

  const data = taggedCardUrl(public_id, sourceChannel);

  try {
    const png = await QRCode.toBuffer(data, {
      type: 'png',
      width: size,
      margin: 2,
      color: {
        dark: '#3B4559',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    });

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'QR render failed' },
      { status: 500 },
    );
  }
}
