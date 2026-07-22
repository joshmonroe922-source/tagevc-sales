#!/usr/bin/env node
/**
 * Offline verify for Phase 41/42 snapshot external receipts.
 * Uses public SPKI keys only — never private keys.
 *
 * Usage:
 *   SNAPSHOT_EXPORT_ED25519_PUBLIC_KEYS='{"key-id":"base64_spki"}' \
 *     node scripts/verify-snapshot-receipt.mjs path/to/receipt-or-bundle.json
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function die(message) {
  console.error(message);
  process.exit(1);
}

function parseKeyring(raw) {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    die('SNAPSHOT_EXPORT_ED25519_PUBLIC_KEYS must be a JSON object');
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const filePath = process.argv[2];
if (!filePath) {
  die('Usage: node scripts/verify-snapshot-receipt.mjs <receipt-or-bundle.json>');
}

const payload = JSON.parse(readFileSync(resolve(filePath), 'utf8'));
const receipt = payload.receipt ?? payload;
const keyId =
  payload.key_id ??
  receipt.verify_key_id ??
  process.env.SNAPSHOT_EXPORT_ED25519_KEY_ID?.trim();
const canonicalText =
  receipt.canonical_receipt_text ?? payload.canonical_receipt_text;
const signature = receipt.receipt_signature ?? payload.receipt_signature;
const expectedDigest = receipt.receipt_sha256 ?? payload.receipt_sha256;

if (!keyId || !canonicalText || !signature || !expectedDigest) {
  die('Missing key_id, canonical_receipt_text, receipt_signature, or receipt_sha256');
}
if (JSON.stringify(payload).match(/private_key/i)) {
  die('Refusing to verify a payload that includes private_key material');
}

const digestOk = sha256Text(canonicalText) === expectedDigest;
const keyring = parseKeyring(process.env.SNAPSHOT_EXPORT_ED25519_PUBLIC_KEYS);
const encoded =
  keyring[keyId] ??
  payload.public_key_spki_b64 ??
  process.env.SNAPSHOT_EXPORT_ED25519_PUBLIC_KEY?.trim() ??
  '';
if (!encoded) {
  die(`Public verify key unavailable for ${keyId}`);
}

const publicKey = createPublicKey({
  key: Buffer.from(encoded, 'base64'),
  format: 'der',
  type: 'spki',
});
const signatureOk =
  /^[0-9a-f]{128}$/.test(signature) &&
  verify(
    null,
    Buffer.from(canonicalText, 'utf8'),
    publicKey,
    Buffer.from(signature, 'hex'),
  );

const result = {
  ok: digestOk && signatureOk,
  key_id: keyId,
  digest_ok: digestOk,
  signature_ok: signatureOk,
  private_key_included: false,
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
