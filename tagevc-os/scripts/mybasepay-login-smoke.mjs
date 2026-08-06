#!/usr/bin/env node
/**
 * MyBasePay interim admin login smoke (read-only).
 *
 * Usage (from tagevc-os):
 *   node --env-file=.env.local scripts/mybasepay-login-smoke.mjs
 *
 * Requires:
 *   MYBASEPAY_ADMIN_EMAIL
 *   MYBASEPAY_ADMIN_PASSWORD
 * Optional:
 *   MYBASEPAY_API_BASE (default https://api.mybasepay.com)
 *   MYBASEPAY_BASE_URL (default https://backoffice.mybasepay.com)
 *
 * Does NOT create workers. Does NOT print secrets or JWTs.
 * Keep MYBASEPAY_LIVE=0 until smoke passes and Josh flips deliberately.
 */

const apiBase = (
  process.env.MYBASEPAY_API_BASE || 'https://api.mybasepay.com'
).replace(/\/$/, '');
const email = process.env.MYBASEPAY_ADMIN_EMAIL?.trim();
const password = process.env.MYBASEPAY_ADMIN_PASSWORD?.trim();

function maskEmail(v) {
  if (!v || !v.includes('@')) return '[missing]';
  const [u, d] = v.split('@');
  return `${u.slice(0, 2)}***@${d}`;
}

async function main() {
  console.log('MyBasePay login smoke');
  console.log(`  apiBase: ${apiBase}`);
  console.log(`  email:   ${maskEmail(email)}`);
  console.log(`  LIVE:    ${process.env.MYBASEPAY_LIVE?.trim() || '0'}`);

  if (!email || !password) {
    console.error('FAIL: missing MYBASEPAY_ADMIN_EMAIL / MYBASEPAY_ADMIN_PASSWORD');
    process.exit(2);
  }

  const loginRes = await fetch(`${apiBase}/account-service/user/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: 'https://backoffice.mybasepay.com',
      Referer: 'https://backoffice.mybasepay.com/login',
    },
    // applicationType 2 = Backoffice (required; omit → opaque 500)
    body: JSON.stringify({ email, password, applicationType: 2 }),
  });

  const loginText = await loginRes.text();
  let loginJson = null;
  try {
    loginJson = loginText ? JSON.parse(loginText) : null;
  } catch {
    loginJson = null;
  }

  if (!loginRes.ok) {
    const hint =
      loginJson && typeof loginJson.message === 'string'
        ? loginJson.message.slice(0, 120)
        : `HTTP ${loginRes.status}`;
    const mfa = /two.?factor|mfa|2fa|otp/i.test(hint);
    console.error(
      mfa
        ? `FAIL: MFA required — NEED_HUMAN (${hint})`
        : `FAIL: login ${hint}`,
    );
    process.exit(1);
  }

  const token = extractToken(loginJson);
  const authCode = extractAuthCode(loginJson);
  if (authCode) {
    console.error('FAIL: MFA required — NEED_HUMAN (authCode present)');
    process.exit(1);
  }
  if (!token) {
    if (
      loginJson &&
      (loginJson.requiresTwoFactor ||
        loginJson.twoFactorRequired ||
        loginJson.isTwoFactorEnabled)
    ) {
      console.error('FAIL: MFA required — NEED_HUMAN');
      process.exit(1);
    }
    console.error('FAIL: login OK but token missing from response shape');
    process.exit(1);
  }

  console.log(`  login:   OK (HTTP ${loginRes.status}, token present)`);

  const auth = token.toLowerCase().startsWith('bearer ')
    ? token
    : `bearer ${token}`;
  const workersRes = await fetch(
    `${apiBase}/backoffice/workers/paged?pageNumber=0`,
    {
      headers: { Authorization: auth, Accept: 'application/json' },
    },
  );
  // Drain body without printing
  await workersRes.arrayBuffer();

  if (!workersRes.ok) {
    console.error(`FAIL: workers paged HTTP ${workersRes.status}`);
    process.exit(1);
  }

  console.log(`  workers: OK (HTTP ${workersRes.status}, read-only page 0)`);
  console.log('PASS — keep MYBASEPAY_LIVE=0 until contractor create is approved');
}

function extractToken(body) {
  if (!body) return null;
  if (typeof body === 'string' && body.trim().length > 20) return body.trim();
  if (typeof body !== 'object') return null;
  for (const key of [
    'token',
    'accessToken',
    'access_token',
    'jwt',
    'jwtToken',
    'JwtToken',
  ]) {
    if (typeof body[key] === 'string' && body[key].trim()) return body[key].trim();
  }
  for (const nest of ['data', 'result', 'payload']) {
    if (body[nest] && typeof body[nest] === 'object') {
      const t = extractToken(body[nest]);
      if (t) return t;
    }
  }
  return null;
}

function extractAuthCode(body) {
  if (!body || typeof body !== 'object') return null;
  const raw = body.authCode ?? body.AuthCode;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'none') {
    return null;
  }
  return trimmed;
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : 'unknown error');
  process.exit(1);
});
