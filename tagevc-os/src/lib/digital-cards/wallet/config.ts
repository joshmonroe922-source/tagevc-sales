/**
 * Apple / Google Wallet env readiness. Fail-soft when certs are missing.
 */

function env(key: string): string {
  return (process.env[key] ?? '').trim();
}

function normalizePem(raw: string): string {
  if (!raw) return '';
  const unquoted = raw.replace(/^['"]|['"]$/g, '');
  return unquoted.includes('\\n') ? unquoted.replace(/\\n/g, '\n') : unquoted;
}

export type AppleWalletConfig = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  signerCert: string;
  signerKey: string;
  signerKeyPassphrase: string;
  wwdrCert: string;
};

export type GoogleWalletConfig = {
  issuerId: string;
  serviceAccountEmail: string;
  privateKey: string;
  classSuffix: string;
};

/** Public Apple WWDR G3 intermediate (safe to ship). Override via APPLE_WALLET_WWDR_CERT. */
export const APPLE_WWDR_G3_PEM = `-----BEGIN CERTIFICATE-----
MIIEUTCCAzmgAwIBAgIQfK9pCiW3Of57m0R6wXjF7jANBgkqhkiG9w0BAQsFADBi
MQswCQYDVQQGEwJVUzETMBEGA1UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBw
bGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkxFjAUBgNVBAMTDUFwcGxlIFJvb3Qg
Q0EwHhcNMjAwMjE5MTgxMzQ3WhcNMzAwMjIwMDAwMDAwWjB1MUQwQgYDVQQDDDtB
cHBsZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTELMAkGA1UECwwCRzMxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJ
BgNVBAYTAlVTMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2PWJ/KhZ
C4fHTJEuLVaQ03gdpDDppUjvC0O/LYT7JF1FG+XrWTYSXFRknmxiLbTGl8rMPPbW
BpH85QKmHGq0edVny6zpPwcR4YS8Rx1mjjmi6LRJ7TrS4RBgeo6TjMrA2gzAg9Dj
+ZHWp4zIwXPirkbRYp2SqJBgN31ols2N4Pyb+ni743uvLRfdW/6AWSN1F7gSwe0b
5TTO/iK1nkmw5VW/j4SiPKi6xYaVFuQAyZ8D0MyzOhZ71gVcnetHrg21LYwOaU1A
0EtMOwSejSGxrC5DVDDOwYqGlJhL32oNP/77HK6XF8J4CjDgXx9UO0m3JQAaN4LS
VpelUkl8YDib7wIDAQABo4HvMIHsMBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0j
BBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4wRAYIKwYBBQUHAQEEODA2MDQGCCsG
AQUFBzABhihodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNh
MC4GA1UdHwQnMCUwI6AhoB+GHWh0dHA6Ly9jcmwuYXBwbGUuY29tL3Jvb3QuY3Js
MB0GA1UdDgQWBBQJ/sAVkPmvZAqSErkmKGMMl+ynsjAOBgNVHQ8BAf8EBAMCAQYw
EAYKKoZIhvdjZAYCAQQCBQAwDQYJKoZIhvcNAQELBQADggEBAK1lE+j24IF3RAJH
Qr5fpTkg6mKp/cWQyXMT1Z6b0KoPjY3L7QHPbChAW8dVJEH4/M/BtSPp3Ozxb8qA
HXfCxGFJJWevD8o5Ja3T43rMMygNDi6hV0Bz+uZcrgZRKe3jhQxPYdwyFot30ETK
XXIDMUacrptAGvr04NM++i+MZp+XxFRZ79JI9AeZSWBZGcfdlNHAwWx/eCHvDOs7
bJmCS1JgOLU5gm3sUjFTvg+RTElJdI+mUcuER04ddSduvfnSXPN/wmwLCTbiZOTC
NwMUGdXqapSqqdv+9poIZ4vvK7iqF0mDr8/LvOnP6pVxsLRFoszlh6oKw0E6eVza
UDSdlTs=
-----END CERTIFICATE-----
`;

export function getAppleWalletConfig(): AppleWalletConfig | null {
  const passTypeIdentifier = env('APPLE_WALLET_PASS_TYPE_ID');
  const teamIdentifier = env('APPLE_WALLET_TEAM_ID');
  const signerCert = normalizePem(env('APPLE_WALLET_SIGNER_CERT'));
  const signerKey = normalizePem(env('APPLE_WALLET_SIGNER_KEY'));
  if (!passTypeIdentifier || !teamIdentifier || !signerCert || !signerKey) {
    return null;
  }
  const wwdrOverride = normalizePem(env('APPLE_WALLET_WWDR_CERT'));
  return {
    passTypeIdentifier,
    teamIdentifier,
    organizationName: env('APPLE_WALLET_ORG_NAME') || 'Tage VC',
    signerCert,
    signerKey,
    signerKeyPassphrase: env('APPLE_WALLET_SIGNER_KEY_PASSPHRASE'),
    wwdrCert: wwdrOverride || APPLE_WWDR_G3_PEM,
  };
}

export function getGoogleWalletConfig(): GoogleWalletConfig | null {
  const issuerId = env('GOOGLE_WALLET_ISSUER_ID');
  const serviceAccountEmail = env('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL');
  const privateKey = normalizePem(
    env('GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY'),
  );
  if (!issuerId || !serviceAccountEmail || !privateKey) return null;
  return {
    issuerId,
    serviceAccountEmail,
    privateKey,
    classSuffix: env('GOOGLE_WALLET_CLASS_SUFFIX') || 'digital_card',
  };
}

export function walletAvailability(): { apple: boolean; google: boolean } {
  return {
    apple: getAppleWalletConfig() !== null,
    google: getGoogleWalletConfig() !== null,
  };
}
