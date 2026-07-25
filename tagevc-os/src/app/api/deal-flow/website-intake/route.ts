import { NextResponse } from 'next/server';
import {
  ingestWebsiteLead,
  type WebsiteIntakeBody,
} from '@/lib/deal-flow/website-intake';

const ALLOWED_ORIGINS = [
  'https://tageventurecapital.com',
  'https://www.tageventurecapital.com',
  'https://tagevc.com',
  'https://www.tagevc.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
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
  if (secret && (header === secret || bearer === secret)) {
    return true;
  }

  // Browser posts from the public site: allow known origins (CORS already tight).
  const origin = request.headers.get('Origin');
  if (
    origin &&
    (ALLOWED_ORIGINS.includes(origin) ||
      (origin.endsWith('.vercel.app') && origin.includes('tagevc')))
  ) {
    return true;
  }

  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  return false;
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('Origin');
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (!authorize(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers },
    );
  }

  let body: WebsiteIntakeBody;
  try {
    body = (await request.json()) as WebsiteIntakeBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400, headers },
    );
  }

  const result = await ingestWebsiteLead(body);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status, headers },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      lead_id: result.lead_id,
      replay: result.replay,
      company_name: result.company_name,
      href: `/deal-flow/vc/leads/${result.lead_id}`,
    },
    { status: 200, headers },
  );
}
