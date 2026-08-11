/**
 * Grant the Visionary FullAccess ("Read and manage") on a mailbox, app-only.
 *
 * This is the repeatable form of what was done by hand for Dennis on 2026-08-10.
 * It needs no interactive PowerShell and no certificate — a client secret is
 * enough, because the service principal holds Exchange.ManageAsApp plus the
 * Exchange Recipient Administrator directory role.
 *
 *   node scripts/dennis-onboard/19-grant-fullaccess.mjs dennismccall@recruit619.com
 *   node scripts/dennis-onboard/19-grant-fullaccess.mjs <mailbox> <visionary-upn>
 *
 * Exchange can take ~30s to honour a freshly assigned directory role, so a 403
 * on the first call is retried once.
 */

import { env } from './lib.mjs';

const MAILBOX = process.argv[2];
const VISIONARY = process.argv[3] || 'joshmonroe@tagevc.com';

if (!MAILBOX) {
  console.error('usage: node 19-grant-fullaccess.mjs <mailbox> [visionary-upn]');
  process.exit(1);
}

const TENANT = env.MS_GRAPH_TENANT_ID;

async function exoToken() {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.MS_GRAPH_CLIENT_ID,
      client_secret: env.MS_GRAPH_CLIENT_SECRET,
      scope: 'https://outlook.office365.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`EXO token failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function invoke(cmdlet, parameters) {
  const res = await fetch(`https://outlook.office365.com/adminapi/beta/${TENANT}/InvokeCommand`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await exoToken()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      'X-CmdletName': cmdlet,
      'X-AnchorMailbox': `UPN:${MAILBOX}`,
    },
    body: JSON.stringify({ CmdletInput: { CmdletName: cmdlet, Parameters: parameters } }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const params = {
  Identity: MAILBOX,
  User: VISIONARY,
  AccessRights: 'FullAccess',
  InheritanceType: 'All',
};

let grant = await invoke('Add-MailboxPermission', params);
if (grant.status === 403) {
  console.log('403 — waiting 30s for Exchange to honour the directory role, then retrying…');
  await new Promise((r) => setTimeout(r, 30_000));
  grant = await invoke('Add-MailboxPermission', params);
}

console.log(`Add-MailboxPermission -> HTTP ${grant.status}`);
if (grant.status !== 200) {
  console.log(JSON.stringify(grant.body, null, 1).slice(0, 1200));
  process.exit(1);
}

const check = await invoke('Get-MailboxPermission', { Identity: MAILBOX });
console.log(`\n=== MAILBOX PERMISSIONS ON ${MAILBOX} — HTTP ${check.status} ===`);
(check.body?.value ?? []).forEach((p) =>
  console.log(` - ${p.User}: ${p.AccessRights} (deny=${p.Deny})`),
);
