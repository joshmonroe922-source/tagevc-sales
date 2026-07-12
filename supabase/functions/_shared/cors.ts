const ALLOWED_ORIGINS = [
  'https://tageventurecapital.com',
  'https://www.tageventurecapital.com',
  'https://tagevc.com',
  'https://www.tagevc.com',
  'https://tageglobal.com',
  'https://www.tageglobal.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-drip-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  origin: string | null = null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
    },
  });
}
