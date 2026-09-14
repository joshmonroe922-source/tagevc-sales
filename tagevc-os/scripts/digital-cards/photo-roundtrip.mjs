/**
 * End-to-end check of the headshot path: upload a 1x1 PNG the same way
 * uploadDigitalCardPhoto does, fetch the resulting public URL anonymously, then
 * delete the test object. Proves the bucket accepts writes AND that
 * getPublicUrl yields something an anonymous card visitor can actually load.
 *
 * Run: node scripts/digital-cards/photo-roundtrip.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BUCKET = 'os-uploads';

try {
  const raw = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  /* env may come from the shell */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error('Missing Supabase URL or service key');
  process.exit(1);
}

const sb = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Smallest valid PNG.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const path = `digital-cards/_selftest/${randomUUID()}.png`;
console.log('Uploading', path, `(${png.length} bytes)`);

const { error: upErr } = await sb.storage
  .from(BUCKET)
  .upload(path, png, { contentType: 'image/png', upsert: true });
if (upErr) {
  console.error('UPLOAD FAILED:', upErr.message);
  process.exit(1);
}
console.log('Upload OK');

const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
console.log('Public URL:', data.publicUrl);

const res = await fetch(data.publicUrl);
console.log(
  'Anonymous fetch:',
  res.status,
  res.headers.get('content-type'),
  `${(await res.arrayBuffer()).byteLength} bytes`,
);

const { error: delErr } = await sb.storage.from(BUCKET).remove([path]);
console.log('Cleanup:', delErr ? `failed (${delErr.message})` : 'removed test object');

console.log(
  res.ok ? '\nPASS — headshot upload and public read both work.' : '\nFAIL — public read blocked.',
);
process.exit(res.ok ? 0 : 1);
