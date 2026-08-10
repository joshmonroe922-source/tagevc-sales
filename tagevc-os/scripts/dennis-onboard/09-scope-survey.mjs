/**
 * R619-scoping survey: Entra identity/name/groups vs HRIS run + step inventory.
 * Read-only.
 */

import { graph, env } from './lib.mjs';
import pg from 'pg';

const { Client } = pg;
const GID = '89fdd120-d221-4953-93a2-fc39a5f46983';
const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const out = {};

const u = await graph(
  `v1.0/users/${GID}?$select=id,displayName,givenName,surname,mailNickname,userPrincipalName,mail,proxyAddresses,jobTitle,department,companyName,usageLocation,accountEnabled`,
);
out.entra_identity = u.body;

const mem = await graph(`v1.0/users/${GID}/memberOf`);
out.entra_groups = (mem.body?.value ?? []).map((g) => ({
  id: g.id,
  name: g.displayName,
  mail: g.mail ?? null,
  type: g['@odata.type'],
  groupTypes: g.groupTypes,
  securityEnabled: g.securityEnabled,
  mailEnabled: g.mailEnabled,
}));

const allGroups = await graph(
  'v1.0/groups?$select=id,displayName,mail,mailEnabled,securityEnabled,groupTypes&$top=200',
);
out.tenant_groups = (allGroups.body?.value ?? []).map(
  (g) => `${g.id} | ${g.displayName} | mail:${g.mail ?? '-'}`,
);

const roleAssignments = await graph(
  `v1.0/users/${GID}/transitiveMemberOf/microsoft.graph.directoryRole?$select=displayName,roleTemplateId`,
);
out.directory_roles = (roleAssignments.body?.value ?? []).map((r) => r.displayName);

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

out.employee = (
  await client.query(
    `select id, employee_key, full_name, preferred_name, work_email, personal_email,
            entity_id, role_title, department, status, onboarding_status, onboarding_pct,
            start_date::date as start_date, profile_id, entra_object_id, upn,
            identity_status, recruit_assignment
     from public.os_hris_employees where id = $1`,
    [EMPLOYEE_ID],
  )
).rows[0];

out.profile = (
  await client.query(
    `select id, email, full_name, role, entity_id, active, manager_profile_id
     from public.profiles where id = $1`,
    [out.employee?.profile_id],
  )
).rows[0];

out.runs = (
  await client.query(
    `select r.id, r.run_key, r.kind, r.status, r.completion_pct,
            r.start_date::date as start_date, r.started_at, r.completed_at,
            t.slug as template_slug, t.title as template_title, t.audience as template_audience
     from public.os_hris_process_runs r
     left join public.os_hris_process_templates t on t.id = r.template_id
     where r.employee_id = $1 order by r.created_at`,
    [EMPLOYEE_ID],
  )
).rows;

const runIds = out.runs.map((r) => r.id);
out.steps = (
  await client.query(
    `select s.run_id, s.id, s.step_key, s.title, s.status, s.system_hook, s.automation,
            s.owner_role, s.optional_for_audience, s.sort_order, s.due_at,
            s.evidence_required, s.evidence_note, s.destructive
     from public.os_hris_process_steps s
     where s.run_id = any($1::uuid[])
     order by s.sort_order, s.step_key`,
    [runIds],
  )
).rows;

out.step_summary = out.steps.reduce((acc, s) => {
  acc[s.status] = (acc[s.status] ?? 0) + 1;
  return acc;
}, {});

out.links = (
  await client.query(
    `select kind, ref_id, label, href from public.os_hris_employee_links
     where employee_id = $1 order by created_at`,
    [EMPLOYEE_ID],
  )
).rows;

await client.end();
console.log(JSON.stringify(out, null, 2));
