/**
 * Grant the Visionary (Josh) FullAccess on Dennis's mailbox using the Exchange Online
 * REST admin API with the app-only Exchange.ManageAsApp token.
 *
 * Runs a read-only Get-Mailbox first: if Exchange rejects that, the app is missing the
 * Exchange Administrator directory role (or app-only EXO needs a certificate) and we
 * stop before attempting any write.
 */

import { env } from './lib.mjs';

const TENANT = env.MS_GRAPH_TENANT_ID;
const MAILBOX = 'dennismccall@recruit619.com';
const VISIONARY = 'joshmonroe@tagevc.com';

const exoToken = async () => {
  const body = new URLSearchParams({
    client_id: env.MS_GRAPH_CLIENT_ID,
    client_secret: env.MS_GRAPH_CLIENT_SECRET,
    scope: 'https://outlook.office365.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    body,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`EXO token failed: ${JSON.stringify(json)}`);
  return json.access_token;
};

const token = await exoToken();

const invoke = async (CmdletName, Parameters) => {
  const res = await fetch(`https://outlook.office365.com/adminapi/beta/${TENANT}/InvokeCommand`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-CmdletName': CmdletName,
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      'X-AnchorMailbox': `UPN:${MAILBOX}`,
    },
    body: JSON.stringify({ CmdletInput: { CmdletName, Parameters } }),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 800) };
  }
  return { ok: res.ok, status: res.status, body };
};

console.log('--- 1. read-only probe: Get-Mailbox ---');
const probe = await invoke('Get-Mailbox', { Identity: MAILBOX });
console.log(`HTTP ${probe.status}`);
console.log(JSON.stringify(probe.body, null, 1).slice(0, 1200));

if (!probe.ok) {
  console.log(
    '\nSTOP: Exchange Online rejected the app-only token. FullAccess not attempted.\n' +
      'Most likely cause: the Tage VC OS service principal still needs the Exchange Administrator\n' +
      'directory role (and app-only EXO may require certificate auth rather than a client secret).',
  );
  process.exit(1);
}

console.log('\n--- 2. Add-MailboxPermission (FullAccess) ---');
const grant = await invoke('Add-MailboxPermission', {
  Identity: MAILBOX,
  User: VISIONARY,
  AccessRights: ['FullAccess'],
  InheritanceType: 'All',
  AutoMapping: true,
});
console.log(`HTTP ${grant.status}`);
console.log(JSON.stringify(grant.body, null, 1).slice(0, 1500));

console.log('\n--- 3. verify: Get-MailboxPermission ---');
const verify = await invoke('Get-MailboxPermission', { Identity: MAILBOX });
console.log(`HTTP ${verify.status}`);
const perms = (verify.body?.value ?? []).map((p) => ({
  user: p.User,
  rights: p.AccessRights,
  deny: p.Deny,
}));
console.log(JSON.stringify(perms.length ? perms : verify.body, null, 1).slice(0, 1500));
