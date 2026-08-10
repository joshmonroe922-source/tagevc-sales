/**
 * Resume the three Day-1 steps that were blocked purely on admin consent.
 *
 * Each step checks the live app roles first and then does the real call, so a
 * partial consent finishes what it can instead of failing the whole run:
 *
 *   Group.ReadWrite.All   → create the per-entity distro groups and put Dennis
 *                           in the Recruit 619 one
 *   Exchange.ManageAsApp  → give Josh FullAccess on Dennis's mailbox
 *   Mail.Send             → email the sign-in details to Dennis's personal
 *                           address (the only address he can read before his
 *                           first sign-in)
 *
 * The temp password is read from .local-secrets and never printed.
 *
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/16-consent-resume.mts
 *   npm exec --yes tsx@4 -- scripts/dennis-onboard/16-consent-resume.mts --apply
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!m) continue;
  if (process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const APPLY = process.argv.includes('--apply');

const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const DENNIS_UPN = 'dennismccall@recruit619.com';
const JOSH_UPN = 'joshmonroe@tagevc.com';

/** Parent first, then every operating subsidiary. */
const DISTRO_ENTITIES = ['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA'] as const;

const TENANT = process.env.MS_GRAPH_TENANT_ID!;
const CLIENT_ID = process.env.MS_GRAPH_CLIENT_ID!;
const CLIENT_SECRET = process.env.MS_GRAPH_CLIENT_SECRET!;

const say = (s: string) => console.log(s);
const tag = APPLY ? '' : '[dry-run] ';

async function tokenFor(resource: string): Promise<string | null> {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: `${resource}/.default`,
      grant_type: 'client_credentials',
    }),
  });
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

function rolesOf(jwt: string): string[] {
  const payload = JSON.parse(
    Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
  ) as { roles?: string[] };
  return payload.roles ?? [];
}

const graphToken = await tokenFor('https://graph.microsoft.com');
if (!graphToken) throw new Error('Could not mint a Graph token — check MS_GRAPH_* in .env.local');
const roles = rolesOf(graphToken);

const can = {
  groups: roles.includes('Group.ReadWrite.All'),
  exchange: roles.includes('Exchange.ManageAsApp'),
  mail: roles.includes('Mail.Send'),
};

say(`=== Consent resume ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
say(`app roles       : ${roles.sort().join(', ')}`);
say(`Group.ReadWrite : ${can.groups ? 'yes' : 'NO'}`);
say(`Exchange.MgmtApp: ${can.exchange ? 'yes' : 'NO'}`);
say(`Mail.Send       : ${can.mail ? 'yes' : 'NO'}\n`);

const gh = {
  Authorization: `Bearer ${graphToken}`,
  'Content-Type': 'application/json',
};

const summary: Record<string, string> = {};

// --------------------------------------------------------------- 1. distro groups
const { entityDisplayName } = await import('@/lib/entities/display-name');

type GroupRow = { id: string; displayName: string; mail: string | null; mailEnabled?: boolean };

async function findGroup(company: string): Promise<GroupRow | null> {
  const filter = encodeURIComponent(`startswith(displayName,'${company.replace(/'/g, "''")}')`);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/groups?$filter=${filter}&$select=id,displayName,mail,mailEnabled&$top=20`,
    { headers: gh },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { value?: GroupRow[] };
  const rows = body.value ?? [];
  return rows.find((g) => g.mailEnabled) ?? rows[0] ?? null;
}

const groupIds: string[] = [];
say('--- entity distro groups ---');
for (const entityId of DISTRO_ENTITIES) {
  const company = entityDisplayName(entityId, entityId);
  const existing = await findGroup(company);
  if (existing) {
    say(`${company.padEnd(22)} exists   ${existing.id}  ${existing.mail ?? '(no mail)'}`);
    groupIds.push(`${entityId}=${existing.id}`);
    continue;
  }
  if (!can.groups) {
    say(`${company.padEnd(22)} MISSING  — needs Group.ReadWrite.All to create`);
    continue;
  }
  const nickname = `${company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-all`;
  if (!APPLY) {
    say(`${company.padEnd(22)} ${tag}create "${company} All" (${nickname})`);
    continue;
  }
  const create = await fetch('https://graph.microsoft.com/v1.0/groups', {
    method: 'POST',
    headers: gh,
    body: JSON.stringify({
      displayName: `${company} All`,
      description: `Everyone at ${company}.`,
      mailNickname: nickname,
      mailEnabled: true,
      securityEnabled: false,
      groupTypes: ['Unified'],
      visibility: 'Private',
    }),
  });
  const body = (await create.json().catch(() => ({}))) as GroupRow & {
    error?: { message?: string };
  };
  if (!create.ok) {
    say(`${company.padEnd(22)} FAILED   HTTP ${create.status} ${String(body?.error?.message ?? '').slice(0, 140)}`);
    continue;
  }
  say(`${company.padEnd(22)} created  ${body.id}  ${body.mail ?? '(mail provisioning)'}`);
  groupIds.push(`${entityId}=${body.id}`);
}

if (groupIds.length) {
  say(`\nMS_GRAPH_DISTRO_GROUP_IDS=${groupIds.join(',')}`);
}
summary.groups = groupIds.length
  ? `${groupIds.length}/${DISTRO_ENTITIES.length} entity groups resolved`
  : 'no entity groups resolved';

// Put Dennis in the Recruit 619 list now that it exists.
if (APPLY) {
  process.env.MS_GRAPH_DISTRO_GROUP_IDS = groupIds.join(',');
  const { runDistroAssist } = await import('@/lib/hris/distro-step');
  const distro = await runDistroAssist({
    full_name: 'Dennis McCall',
    entity_id: 'ENT-R619',
    work_email: DENNIS_UPN,
  });
  say(`\ndistro add      : ${distro.joined ? 'ok' : 'not joined'} — ${distro.detail}`);
  summary.distro_add = distro.detail;
}

// ------------------------------------------------------- 2. Visionary mailbox FullAccess
say('\n--- Visionary FullAccess on Dennis mailbox ---');
if (!can.exchange) {
  say('skipped — Exchange.ManageAsApp not consented');
  summary.fullaccess = 'blocked: Exchange.ManageAsApp not consented';
} else {
  const exoToken = await tokenFor('https://outlook.office365.com');
  if (!exoToken) {
    say('could not mint an Exchange Online token');
    summary.fullaccess = 'blocked: no Exchange Online token';
  } else {
    const invoke = async (CmdletName: string, Parameters: Record<string, unknown>) => {
      const res = await fetch(
        `https://outlook.office365.com/adminapi/beta/${TENANT}/InvokeCommand`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${exoToken}`,
            'Content-Type': 'application/json',
            'X-AnchorMailbox': `UPN:${DENNIS_UPN}`,
          },
          body: JSON.stringify({ CmdletInput: { CmdletName, Parameters } }),
        },
      );
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text.slice(0, 400) };
      }
      return { ok: res.ok, status: res.status, json };
    };

    const current = await invoke('Get-MailboxPermission', { Identity: DENNIS_UPN });
    const already = JSON.stringify(current.json ?? '').includes(JOSH_UPN);
    say(`Get-MailboxPermission HTTP ${current.status}${already ? ' — Josh already listed' : ''}`);

    if (already) {
      summary.fullaccess = 'already granted';
    } else if (!APPLY) {
      say(`${tag}Add-MailboxPermission ${DENNIS_UPN} -User ${JOSH_UPN} -AccessRights FullAccess`);
      summary.fullaccess = 'dry run';
    } else {
      const add = await invoke('Add-MailboxPermission', {
        Identity: DENNIS_UPN,
        User: JOSH_UPN,
        AccessRights: 'FullAccess',
        InheritanceType: 'All',
        AutoMapping: true,
      });
      say(`Add-MailboxPermission HTTP ${add.status} ${JSON.stringify(add.json).slice(0, 300)}`);
      summary.fullaccess = add.ok
        ? 'granted FullAccess to Josh'
        : `failed HTTP ${add.status} — the app service principal likely also needs the Exchange Administrator directory role`;
    }
  }
}

// ------------------------------------------------------------- 3. joiner invite
say('\n--- joiner invite to personal address ---');
const { getEmployee } = await import('@/lib/hris/employees');
const emp = (await getEmployee(EMPLOYEE_ID)).employee;
if (!emp) throw new Error('employee not found');

let tempPassword: string | null = null;
try {
  const secret = JSON.parse(
    readFileSync(resolve(process.cwd(), '.local-secrets/dennis-m365.json'), 'utf8'),
  ) as { temp_password?: string };
  tempPassword = secret.temp_password?.trim() || null;
} catch {
  tempPassword = null;
}

const { maskEmail } = await import('@/lib/hris/joiner-invite');
say(`personal email  : ${emp.personal_email ? maskEmail(emp.personal_email) : '(none on file)'}`);
say(`temp password   : ${tempPassword ? 'on file (not printed)' : 'not on file — invite falls back to self-service reset'}`);

if (!can.mail) {
  say('skipped — Mail.Send not consented; an external Gmail cannot be reached any other way');
  summary.invite = 'blocked: Mail.Send not consented';
} else if (!emp.personal_email) {
  summary.invite = 'blocked: no personal email on file';
} else if (!APPLY) {
  say(`${tag}send sign-in invite to ${maskEmail(emp.personal_email)} from ${JOSH_UPN}`);
  summary.invite = 'dry run';
} else {
  const { sendJoinerInvite } = await import('@/lib/hris/joiner-invite');
  const res = await sendJoinerInvite({
    full_name: emp.full_name,
    personal_email: emp.personal_email,
    entity_id: emp.entity_id,
    role_title: emp.role_title ?? 'VP of Recruiting',
    start_date: emp.start_date ?? null,
    upn: DENNIS_UPN,
    temp_password: tempPassword,
    // The no-reply alias is not a send-capable mailbox yet; Josh's is.
    from_address: JOSH_UPN,
  });
  say(`invite          : ${res.sent ? 'SENT' : 'not sent'} — ${res.detail}`);
  summary.invite = res.detail;
}

say('\n=== SUMMARY ===');
say(JSON.stringify(summary, null, 2));
