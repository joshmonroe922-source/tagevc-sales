import { NextResponse } from 'next/server';
import { buildAfOpenApiDocument } from '@/lib/af/bus/openapi';

export const dynamic = 'force-dynamic';

/** GET /api/af/openapi — Spec - API Webhooks OpenAPI 3 document. */
export async function GET() {
  const doc = buildAfOpenApiDocument(
    process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.tagevc.com',
  );
  return NextResponse.json(doc, {
    headers: {
      'Cache-Control': 'public, max-age=60',
    },
  });
}
