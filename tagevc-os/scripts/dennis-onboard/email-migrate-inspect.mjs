/** Read-only: show current identity rows + the exact rows still holding the old address. */
import pg from 'pg';
import { env } from './lib.mjs';

const OLD = 'dennis@recruit619.com';
const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const q = async (label, sql, params = []) => {
  try {
    const r = await client.query(sql, params);
    console.log(`\n=== ${label} (${r.rows.length}) ===`);
    console.log(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    console.log(`\n=== ${label} — ERROR ===\n${e.message.split('\n')[0]}`);
  }
};

await q('auth.users dennis', `select id, email, phone, raw_user_meta_data from auth.users where email ilike '%dennis%'`);
await q('auth.identities dennis', `select id, user_id, provider, provider_id, identity_data from auth.identities where identity_data::text ilike '%dennis%'`);
await q('profiles dennis', `select id, email, full_name, role, entity_id, active from public.profiles where email ilike '%dennis%'`);
await q('os_hris_employees dennis', `select id, employee_key, full_name, work_email, upn, entra_object_id, identity_status, profile_id, recruit_assignment from public.os_hris_employees where work_email ilike '%dennis%' or upn ilike '%dennis%' or employee_key ilike '%dennis%'`);
await q('r619_desk_roster dennis', `select * from public.r619_desk_roster where email ilike '%dennis%'`);

await q('activity_events', `select id, title, detail, created_at from public.activity_events where title ilike $1 or detail ilike $1`, [`%${OLD}%`]);
await q('os_audit_events', `select id, title, metadata, created_at from public.os_audit_events where title ilike $1 or metadata::text ilike $1`, [`%${OLD}%`]);
await q('os_hris_employee_events', `select id, employee_id, event_kind, summary, detail, created_at from public.os_hris_employee_events where detail::text ilike $1`, [`%${OLD}%`]);
await q('os_hris_process_steps', `select id, run_id, step_key, status, evidence_note from public.os_hris_process_steps where evidence_note ilike $1`, [`%${OLD}%`]);
await q('os_live_look_sessions', `select id, target_email, actor_profile_id, started_at from public.os_live_look_sessions where target_email ilike $1`, [`%${OLD}%`]);

await client.end();
