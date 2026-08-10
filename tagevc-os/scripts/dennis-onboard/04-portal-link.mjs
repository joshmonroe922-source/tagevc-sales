/**
 * Portal linkage for Dennis:
 *  1. apply phase99 linkage trigger
 *  2. pre-create the Supabase auth user for dennis@recruit619.com
 *  3. upsert the profile row (sub_lead / ENT-R619)
 *  4. stamp Entra identity back onto the HRIS employee record
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const EMAIL = 'dennis@recruit619.com';
const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const ENTRA_OBJECT_ID = '89fdd120-d221-4953-93a2-fc39a5f46983';
const ROLE = 'sub_lead';
const ENTITY = 'ENT-R619';

const { Client } = pg;

async function withClient(fn) {
  const client = new Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// --- 1. linkage trigger -----------------------------------------------------
const sql = readFileSync(
  resolve(root, 'supabase/phase99_hris_portal_linkage.sql'),
  'utf8',
);
await withClient(async (c) => {
  await c.query(sql);
  console.log('applied phase99_hris_portal_linkage.sql');
});

// --- 2. Supabase auth user --------------------------------------------------
const admin = async (path, init = {}) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
};

const existing = await admin(`admin/users?filter=${encodeURIComponent(EMAIL)}`);
let authUserId = existing.body?.users?.find(
  (u) => (u.email ?? '').toLowerCase() === EMAIL,
)?.id ?? null;
console.log('existing auth user:', authUserId);

if (!authUserId) {
  const created = await admin('admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL,
      email_confirm: true,
      user_metadata: {
        full_name: 'Dennis',
        role: ROLE,
        entity_id: ENTITY,
        provisioned_by: 'hris:dennis-vp-recruiting-r619',
      },
    }),
  });
  console.log('create auth user HTTP', created.status, JSON.stringify(created.body).slice(0, 400));
  authUserId = created.body?.id ?? null;
}

if (!authUserId) {
  console.error('could not resolve auth user id — aborting');
  process.exit(2);
}

// --- 3 + 4. profile + HRIS stamp -------------------------------------------
await withClient(async (c) => {
  await c.query(
    `insert into public.profiles (id, email, full_name, role, entity_id, job_title, active)
     values ($1, $2, 'Dennis', $3::public.app_role, $4, 'VP of Recruiting', true)
     on conflict (id) do update set
       email = excluded.email,
       full_name = coalesce(nullif(btrim(public.profiles.full_name), ''), excluded.full_name),
       role = excluded.role,
       entity_id = coalesce(public.profiles.entity_id, excluded.entity_id),
       active = true,
       updated_at = now()`,
    [authUserId, EMAIL, ROLE, ENTITY],
  ).catch(async (e) => {
    // job_title may not exist on this deployment of profiles
    if (!/job_title/.test(e.message)) throw e;
    console.log('profiles.job_title absent — retrying without it');
    await c.query(
      `insert into public.profiles (id, email, full_name, role, entity_id, active)
       values ($1, $2, 'Dennis', $3::public.app_role, $4, true)
       on conflict (id) do update set
         email = excluded.email,
         role = excluded.role,
         entity_id = coalesce(public.profiles.entity_id, excluded.entity_id),
         active = true,
         updated_at = now()`,
      [authUserId, EMAIL, ROLE, ENTITY],
    );
  });

  await c.query(
    `update public.os_hris_employees
     set profile_id = $2::uuid,
         entra_object_id = $3,
         upn = $4,
         identity_status = 'enabled',
         status = 'active',
         start_date = $5,
         recruit_assignment = coalesce(recruit_assignment, '{}'::jsonb) || jsonb_build_object(
           'status', 'linked',
           'linked_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SSZ'),
           'profile_id', $2::text,
           'entity_id', 'ENT-R619',
           'portal_hint', 'https://portal.recruit619.com'
         ),
         updated_at = now()
     where id = $1`,
    [EMPLOYEE_ID, authUserId, ENTRA_OBJECT_ID, EMAIL, '2026-08-10'],
  );

  const out = await c.query(
    `select e.id, e.full_name, e.work_email, e.entity_id, e.status, e.start_date,
            e.profile_id, e.entra_object_id, e.upn, e.identity_status,
            e.recruit_assignment, p.role, p.entity_id as profile_entity, p.active
     from public.os_hris_employees e
     left join public.profiles p on p.id = e.profile_id
     where e.id = $1`,
    [EMPLOYEE_ID],
  );
  console.log('\nFINAL:', JSON.stringify(out.rows[0], null, 2));
});
