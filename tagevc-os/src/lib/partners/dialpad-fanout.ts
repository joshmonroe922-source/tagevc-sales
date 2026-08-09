/**
 * Fan-out Dialpad spine webhooks to Recruit 619 portal hybrid ingest.
 * Spine keeps os_partner_events; portal owns match / screen pop / recap.
 */

const R619_OFFICE_ID =
  process.env.DIALPAD_R619_OFFICE_ID?.trim() || '5109894981558272';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickOfficeId(payload: Record<string, unknown>): string | null {
  const target = asRecord(payload.target);
  const nested = asRecord(payload.call) ?? asRecord(payload.data);
  const nestedTarget = nested ? asRecord(nested.target) : null;
  for (const obj of [target, nestedTarget, nested, payload]) {
    if (!obj) continue;
    const v = obj.office_id ?? obj.officeId;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function isRecruit619DialpadPayload(
  payload: Record<string, unknown>,
): boolean {
  const officeId = pickOfficeId(payload);
  if (!officeId) return true; // unknown → fan-out (desk DIDs / missing field)
  return officeId === R619_OFFICE_ID;
}

export function recruit619DialpadWebhookUrl(): string | null {
  const explicit = process.env.RECRUIT619_DIALPAD_WEBHOOK_URL?.trim();
  if (explicit) return explicit;
  const portal =
    process.env.RECRUIT619_PORTAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_RECRUIT_PORTAL_URL?.trim() ||
    'https://portal.recruit619.com';
  return `${portal.replace(/\/$/, '')}/api/integrations/dialpad/webhook`;
}

export type DialpadFanoutResult =
  | { attempted: false; reason: string }
  | { attempted: true; ok: boolean; status?: number; error?: string };

/**
 * Forward decoded Dialpad JSON to portal ingest (shared secret header).
 * Does not forward raw JWT — portal also accepts secret header.
 */
export async function fanoutDialpadToRecruit619(
  payload: Record<string, unknown>,
): Promise<DialpadFanoutResult> {
  if (process.env.DIALPAD_LIVE?.trim() !== '1') {
    return { attempted: false, reason: 'DIALPAD_LIVE≠1' };
  }
  if (process.env.DIALPAD_FANOUT_R619 === '0') {
    return { attempted: false, reason: 'DIALPAD_FANOUT_R619=0' };
  }
  if (!isRecruit619DialpadPayload(payload)) {
    return { attempted: false, reason: 'non-R619 office' };
  }

  const url = recruit619DialpadWebhookUrl();
  if (!url) {
    return { attempted: false, reason: 'no portal webhook URL' };
  }

  const secret = process.env.DIALPAD_WEBHOOK_SECRET?.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (secret) {
    headers['x-tagevc-webhook-secret'] = secret;
    headers['x-dialpad-secret'] = secret;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        attempted: true,
        ok: false,
        status: res.status,
        error: text.slice(0, 240),
      };
    }
    return { attempted: true, ok: true, status: res.status };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      error: err instanceof Error ? err.message : 'fanout failed',
    };
  }
}
