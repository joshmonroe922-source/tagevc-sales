/**
 * Vendor Management step-up MFA gate (workbook: contract $ / renewal approve).
 * Issues a short-lived HMAC cookie after SSO session + email confirmation.
 * Prefer IdP AAL2 when present on the Supabase session; never invent OTP secrets.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const VM_STEPUP_COOKIE = 'tagevc_vm_stepup';
export const VM_STEPUP_CHALLENGE_COOKIE = 'tagevc_vm_stepup_chal';
const TTL_SEC = 15 * 60;

function secret(): string {
  return (
    process.env.VM_STEPUP_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.TAGE_PARTNER_PROVISION_SECRET?.trim() ||
    'tage-vm-stepup-dev'
  );
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type StepUpStatus = {
  active: boolean;
  expiresAt: number | null;
  email: string | null;
};

export async function readVmStepUpStatus(): Promise<StepUpStatus> {
  const jar = await cookies();
  const raw = jar.get(VM_STEPUP_COOKIE)?.value?.trim();
  if (!raw) return { active: false, expiresAt: null, email: null };
  const [email, expStr, sig] = raw.split('.');
  if (!email || !expStr || !sig) return { active: false, expiresAt: null, email: null };
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    return { active: false, expiresAt: null, email: null };
  }
  const expected = sign(`${email}.${exp}`);
  if (!safeEq(sig, expected)) return { active: false, expiresAt: null, email: null };
  return { active: true, expiresAt: exp, email: decodeURIComponent(email) };
}

export async function hasValidVmStepUp(email: string | null | undefined): Promise<boolean> {
  const status = await readVmStepUpStatus();
  if (!status.active || !status.email) return false;
  if (!email) return true;
  return status.email.toLowerCase() === email.toLowerCase();
}

/** Create challenge nonce (shown once to operator). */
export async function issueVmStepUpChallenge(email: string): Promise<{
  challengeId: string;
  code: string;
  ttlSec: number;
}> {
  const code = randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars
  const challengeId = randomBytes(8).toString('hex');
  const exp = Date.now() + TTL_SEC * 1000;
  const payload = `${challengeId}.${encodeURIComponent(email.toLowerCase())}.${exp}.${code}`;
  const jar = await cookies();
  jar.set(VM_STEPUP_CHALLENGE_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SEC,
  });
  return { challengeId, code, ttlSec: TTL_SEC };
}

export async function confirmVmStepUpChallenge(input: {
  email: string;
  code: string;
}): Promise<{ ok: true; expiresAt: number } | { ok: false; error: string }> {
  const jar = await cookies();
  const raw = jar.get(VM_STEPUP_CHALLENGE_COOKIE)?.value?.trim();
  if (!raw) return { ok: false, error: 'No step-up challenge — request a new code' };
  const parts = raw.split('.');
  if (parts.length < 5) return { ok: false, error: 'Invalid challenge cookie' };
  const sig = parts.pop()!;
  const code = parts.pop()!;
  const expStr = parts.pop()!;
  const emailEnc = parts.pop()!;
  const challengeId = parts.join('.');
  const payload = `${challengeId}.${emailEnc}.${expStr}.${code}`;
  if (!safeEq(sig, sign(payload))) return { ok: false, error: 'Challenge signature invalid' };
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    return { ok: false, error: 'Challenge expired — request a new code' };
  }
  const expectedEmail = decodeURIComponent(emailEnc).toLowerCase();
  if (input.email.trim().toLowerCase() !== expectedEmail) {
    return { ok: false, error: 'Email must match your SSO session' };
  }
  if (input.code.trim().toUpperCase() !== code.toUpperCase()) {
    return { ok: false, error: 'Incorrect step-up code' };
  }

  const tokenExp = Date.now() + TTL_SEC * 1000;
  const email = expectedEmail;
  const tokenPayload = `${encodeURIComponent(email)}.${tokenExp}`;
  jar.set(VM_STEPUP_COOKIE, `${tokenPayload}.${sign(tokenPayload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SEC,
  });
  jar.delete(VM_STEPUP_CHALLENGE_COOKIE);
  return { ok: true, expiresAt: tokenExp };
}

export async function clearVmStepUp(): Promise<void> {
  const jar = await cookies();
  jar.delete(VM_STEPUP_COOKIE);
  jar.delete(VM_STEPUP_CHALLENGE_COOKIE);
}

/** Pure helpers for unit tests (no cookies). */
export function __testSign(payload: string): string {
  return sign(payload);
}
