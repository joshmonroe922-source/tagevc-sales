import { NextResponse } from 'next/server';
import {
  ingestWebsiteLead,
  type WebsiteIntakeBody,
} from '@/lib/deal-flow/website-intake';
import { resolveIntakeOrgSlug } from '@/lib/deal-flow/org-routing';

export const runtime = 'nodejs';

const ALLOWED_ORIGINS = [
  'https://tageventurecapital.com',
  'https://www.tageventurecapital.com',
  'https://tagevc.com',
  'https://www.tagevc.com',
  'https://recruit619.com',
  'https://www.recruit619.com',
  'https://signenthr.com',
  'https://www.signenthr.com',
  'https://instantnda.com',
  'https://www.instantnda.com',
  'http://localhost:3000',
  'http://localhost:3001',
];

function corsHeaders(origin: string | null): HeadersInit {
  const allow =
    origin &&
    (ALLOWED_ORIGINS.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin.includes('localhost'))
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, x-tage-intake-secret, apikey',
    'Access-Control-Max-Age': '86400',
  };
}

function authorize(request: Request): boolean {
  const secret = process.env.WEBSITE_INTAKE_SECRET?.trim();
  const header = request.headers.get('x-tage-intake-secret')?.trim();
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (secret && (header === secret || bearer === secret)) return true;
  const origin = request.headers.get('Origin');
  if (
    origin &&
    (ALLOWED_ORIGINS.includes(origin) ||
      (origin.endsWith('.vercel.app') &&
        (origin.includes('tagevc') ||
          origin.includes('recruit') ||
          origin.includes('signent') ||
          origin.includes('instant'))))
  ) {
    return true;
  }
  if (!secret) return process.env.NODE_ENV !== 'production';
  return false;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('Origin')),
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ entity: string }> },
) {
  const origin = request.headers.get('Origin');
  const headers = corsHeaders(origin);
  if (!authorize(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers },
    );
  }

  const { entity } = await ctx.params;
  let body: WebsiteIntakeBody;
  try {
    body = (await request.json()) as WebsiteIntakeBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400, headers },
    );
  }

  const orgKey = resolveIntakeOrgSlug({
    entity: body.entity || entity,
    org_slug: body.org_slug || entity,
    source: body.source,
  });

  const result = await ingestWebsiteLead({
    ...body,
    entity: orgKey,
    org_slug: orgKey,
    source: body.source || `${orgKey}_website`,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status, headers },
    );
  }
  return NextResponse.json(
    { ...result, entity: orgKey },
    { status: 200, headers },
  );
}
