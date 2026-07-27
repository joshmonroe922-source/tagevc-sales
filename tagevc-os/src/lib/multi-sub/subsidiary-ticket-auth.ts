/** Subsidiary portal ticket API auth (P2) — signed token or service-role pattern. */

import { createHmac, timingSafeEqual } from 'crypto';
import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';

export const SUBSIDIARY_TICKET_SCOPES = [
  'tickets:read',
  'tickets:write',
] as const;

export type SubsidiaryTicketScope = (typeof SUBSIDIARY_TICKET_SCOPES)[number];

export type SubsidiaryClient = {
  client_id: string;
  entity_id: string;
  scopes: SubsidiaryTicketScope[];
};

const DEFAULT_SCOPES: SubsidiaryTicketScope[] = [
  'tickets:read',
  'tickets:write',
];

/** Built-in clients + env-registered future subsidiaries. */
const BUILTIN_CLIENTS: Record<string, Omit<SubsidiaryClient, 'client_id'>> = {
  recruit619_portal: {
    entity_id: 'ENT-R619',
    scopes: DEFAULT_SCOPES,
  },
  instantnda_portal: {
    entity_id: 'ENT-INDA',
    scopes: DEFAULT_SCOPES,
  },
  // Scaffold for Signent HR portal — activate via env secret when live.
  signent_hr_portal: {
    entity_id: 'ENT-SIGNENT',
    scopes: DEFAULT_SCOPES,
  },
};

/**
 * Optional env map for future subsidiaries without a code change:
 * SUBSIDIARY_API_CLIENTS=acme_portal:ENT-ACME,other_portal:ENT-OTHER
 */
function envRegisteredClients(): Record<
  string,
  Omit<SubsidiaryClient, 'client_id'>
> {
  const raw = process.env.SUBSIDIARY_API_CLIENTS?.trim();
  if (!raw) return {};
  const out: Record<string, Omit<SubsidiaryClient, 'client_id'>> = {};
  for (const part of raw.split(',')) {
    const [clientId, entityId] = part.split(':').map((s) => s.trim());
    if (!clientId || !entityId) continue;
    out[clientId] = { entity_id: entityId, scopes: DEFAULT_SCOPES };
  }
  return out;
}

function knownClients(): Record<string, Omit<SubsidiaryClient, 'client_id'>> {
  return { ...BUILTIN_CLIENTS, ...envRegisteredClients() };
}

function secretsForClient(clientId: string): string[] {
  const out: string[] = [];
  const specific = process.env[`SUBSIDIARY_API_SECRET_${clientId.toUpperCase()}`];
  if (specific?.trim()) out.push(specific.trim());
  const shared = process.env.SUBSIDIARY_API_SECRET?.trim();
  if (shared) out.push(shared);
  const cron = process.env.CRON_SECRET?.trim();
  if (cron) out.push(cron);
  return out;
}

/** Compact signed token: base64url(clientId.entityId.exp).sig */
export function signSubsidiaryToken(input: {
  clientId: string;
  entityId: string;
  expUnix: number;
  secret: string;
}): string {
  const body = Buffer.from(
    `${input.clientId}.${input.entityId}.${input.expUnix}`,
    'utf8',
  ).toString('base64url');
  const sig = createHmac('sha256', input.secret)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifySignedToken(
  token: string,
): { ok: true; client: SubsidiaryClient } | { ok: false; error: string } {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, error: 'Malformed token' };
  const [body, sig] = parts;
  let decoded: string;
  try {
    decoded = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return { ok: false, error: 'Invalid token encoding' };
  }
  const [clientId, entityId, expStr] = decoded.split('.');
  if (!clientId || !entityId || !expStr) {
    return { ok: false, error: 'Invalid token payload' };
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
    return { ok: false, error: 'Token expired' };
  }
  const known = knownClients()[clientId];
  if (!known) return { ok: false, error: 'Unknown client' };
  const canon = resolveCanonicalEntityId(entityId);
  if (canon !== known.entity_id) {
    return { ok: false, error: 'Token entity mismatch' };
  }
  const secrets = secretsForClient(clientId);
  if (secrets.length === 0) {
    return { ok: false, error: 'Subsidiary API secrets not configured' };
  }
  let matched = false;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret)
      .update(body)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      matched = true;
      break;
    }
  }
  if (!matched) return { ok: false, error: 'Invalid token signature' };
  return {
    ok: true,
    client: {
      client_id: clientId,
      entity_id: known.entity_id,
      scopes: known.scopes,
    },
  };
}

/**
 * Authorize subsidiary ticket API:
 * 1) Authorization: Bearer <signed subsidiary token>
 * 2) x-tagevc-subsidiary-client + x-tagevc-subsidiary-secret
 * 3) service-role style Bearer CRON_SECRET / SUBSIDIARY_API_SECRET with client header
 */
export async function authorizeSubsidiaryTicketRequest(
  request: Request,
  requiredScope: SubsidiaryTicketScope,
): Promise<
  | { ok: true; client: SubsidiaryClient; source: 'token' | 'secret' }
  | { ok: false; status: number; error: string }
> {
  const bearer = request.headers.get('authorization');
  const token =
    bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length).trim() : '';

  if (token.includes('.')) {
    const verified = verifySignedToken(token);
    if (verified.ok) {
      if (!verified.client.scopes.includes(requiredScope)) {
        return { ok: false, status: 403, error: 'Insufficient scope' };
      }
      return { ok: true, client: verified.client, source: 'token' };
    }
    // Fall through — may be CRON_SECRET bearer below
  }

  const clientId =
    request.headers.get('x-tagevc-subsidiary-client')?.trim() ||
    new URL(request.url).searchParams.get('client_id')?.trim() ||
    '';
  const headerSecret = request.headers.get('x-tagevc-subsidiary-secret')?.trim();

  const registry = knownClients();
  if (clientId && registry[clientId]) {
    const secrets = secretsForClient(clientId);
    const candidate = headerSecret || (token || undefined);
    if (
      candidate &&
      secrets.some((s) => {
        const a = Buffer.from(s);
        const b = Buffer.from(candidate);
        return a.length === b.length && timingSafeEqual(a, b);
      })
    ) {
      const client: SubsidiaryClient = {
        client_id: clientId,
        entity_id: registry[clientId].entity_id,
        scopes: registry[clientId].scopes,
      };
      if (!client.scopes.includes(requiredScope)) {
        return { ok: false, status: 403, error: 'Insufficient scope' };
      }
      return { ok: true, client, source: 'secret' };
    }
  }

  if (secretsForClient(clientId || 'recruit619_portal').length === 0) {
    return {
      ok: false,
      status: 401,
      error:
        'Unauthorized — configure SUBSIDIARY_API_SECRET (or per-client) / CRON_SECRET',
    };
  }
  return { ok: false, status: 401, error: 'Unauthorized' };
}
