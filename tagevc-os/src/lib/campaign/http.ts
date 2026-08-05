import { NextResponse } from 'next/server';

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** CRM + UI compatible error shape (top-level message/code + nested error). */
export function jsonError(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
) {
  return NextResponse.json(
    {
      code,
      message,
      error: { code, message, details: details ?? {} },
    },
    { status },
  );
}

export async function readJson<T = Record<string, unknown>>(
  req: Request,
): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}
