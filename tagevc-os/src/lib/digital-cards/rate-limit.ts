/**
 * Fail-soft public rate limits for view + exchange.
 * Uses os_digital_card_rate_limits via service role when available;
 * otherwise in-memory fallback (per instance).
 */

import { createHash } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';

const memory = new Map<string, { count: number; started: number }>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retry_after_sec?: number;
};

function hashIp(ip: string | null | undefined): string {
  const raw = (ip || 'unknown').trim() || 'unknown';
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

export function clientIpFromRequest(request: Request): string {
  const xf = request.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

async function checkDbBucket(
  bucketKey: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const now = Date.now();
    const { data } = await sb
      .from('os_digital_card_rate_limits')
      .select('bucket_key, hit_count, window_started_at')
      .eq('bucket_key', bucketKey)
      .maybeSingle();

    if (!data) {
      await sb.from('os_digital_card_rate_limits').upsert({
        bucket_key: bucketKey,
        hit_count: 1,
        window_started_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      });
      return { allowed: true, remaining: limit - 1 };
    }

    const started = new Date(String(data.window_started_at)).getTime();
    let count = Number(data.hit_count) || 0;
    if (now - started > windowMs) {
      count = 0;
      await sb
        .from('os_digital_card_rate_limits')
        .update({
          hit_count: 1,
          window_started_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        })
        .eq('bucket_key', bucketKey);
      return { allowed: true, remaining: limit - 1 };
    }

    if (count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retry_after_sec: Math.ceil((windowMs - (now - started)) / 1000),
      };
    }

    await sb
      .from('os_digital_card_rate_limits')
      .update({
        hit_count: count + 1,
        updated_at: new Date(now).toISOString(),
      })
      .eq('bucket_key', bucketKey);

    return { allowed: true, remaining: limit - count - 1 };
  } catch {
    return null;
  }
}

function checkMemory(
  bucketKey: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const cur = memory.get(bucketKey);
  if (!cur || now - cur.started > windowMs) {
    memory.set(bucketKey, { count: 1, started: now });
    return { allowed: true, remaining: limit - 1 };
  }
  if (cur.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retry_after_sec: Math.ceil((windowMs - (now - cur.started)) / 1000),
    };
  }
  cur.count += 1;
  return { allowed: true, remaining: limit - cur.count };
}

export async function enforcePublicRateLimit(input: {
  kind: 'view' | 'exchange';
  publicId: string;
  ip: string | null | undefined;
}): Promise<RateLimitResult> {
  const ipHash = hashIp(input.ip);
  const bucketKey = `${input.kind}:${input.publicId}:${ipHash}`;
  const limit = input.kind === 'exchange' ? 8 : 60;
  const windowMs = 60 * 60 * 1000;

  const db = await checkDbBucket(bucketKey, limit, windowMs);
  if (db) return db;
  return checkMemory(bucketKey, limit, windowMs);
}

export function hashedIpMeta(ip: string | null | undefined): string {
  return hashIp(ip);
}
