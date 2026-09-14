/**
 * Read-only diagnostic for digital-card headshots.
 *
 * Answers the three things that decide whether "change photo" can work at all:
 * does the `os-uploads` bucket exist, is it public (getPublicUrl only yields a
 * loadable URL on a public bucket), and do its MIME/size limits admit a JPEG.
 *
 * Prints no secret values — only whether each var is present, plus bucket
 * metadata. Run: node scripts/digital-cards/photo-diagnose.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const BUCKET = 'os-uploads';

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* env may come from the shell instead */
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('NEXT_PUBLIC_SUPABASE_URL present:', Boolean(url));
console.log('SUPABASE_SERVICE_ROLE_KEY present:', Boolean(service));
if (!url || !service) {
  console.log('\nCannot inspect storage without both. Nothing was changed.');
  process.exit(0);
}

const sb = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: buckets, error } = await sb.storage.listBuckets();
if (error) {
  console.log('listBuckets failed:', error.message);
  process.exit(1);
}

console.log('\nBuckets:');
for (const b of buckets) {
  console.log(
    `  ${b.name.padEnd(18)} public=${b.public} limit=${b.file_size_limit ?? 'none'} mimes=${
      b.allowed_mime_types ? b.allowed_mime_types.join(',') : 'any'
    }`,
  );
}

const target = buckets.find((b) => b.name === BUCKET);
console.log(`\n--- ${BUCKET} ---`);
if (!target) {
  console.log('MISSING. Photo upload cannot succeed for anyone.');
  process.exit(0);
}
console.log('public:', target.public, target.public ? '' : '<-- getPublicUrl will not load');
const mimes = target.allowed_mime_types;
if (mimes) {
  for (const m of ['image/jpeg', 'image/png', 'image/webp']) {
    console.log(`  ${m}: ${mimes.includes(m) ? 'allowed' : 'BLOCKED'}`);
  }
} else {
  console.log('  any MIME allowed');
}
console.log('  size limit:', target.file_size_limit ?? 'none', '(app caps at 5 MB)');

const { count } = await sb
  .from('os_digital_card_personas')
  .select('id', { count: 'exact', head: true });
const { count: withPhoto } = await sb
  .from('os_digital_card_personas')
  .select('id', { count: 'exact', head: true })
  .not('photo_url', 'is', null);
console.log(`\nPersonas: ${count ?? '?'} total, ${withPhoto ?? '?'} with a photo set.`);
