/**
 * What can our Graph app registration actually do?
 *
 * Determines whether outbound mail (Mail.Send) and the Visionary mailbox grant
 * (Exchange.ManageAsApp) are automatable, or whether they need an admin consent
 * click from Josh. Read-only.
 */

import { graph, env } from './lib.mjs';

const CLIENT_ID = env.MS_GRAPH_CLIENT_ID;
const out = {};

// Our own service principal.
const spRes = await graph(
  `v1.0/servicePrincipals?$filter=appId eq '${CLIENT_ID}'&$select=id,appId,displayName,appRoles`,
);
const sp = spRes.body?.value?.[0];
out.service_principal = sp
  ? { id: sp.id, appId: sp.appId, displayName: sp.displayName }
  : { error: spRes.body };

if (sp?.id) {
  // Which app roles (application permissions) have been granted to us.
  const grants = await graph(
    `v1.0/servicePrincipals/${sp.id}/appRoleAssignments?$select=id,appRoleId,resourceId,resourceDisplayName`,
  );
  const assignments = grants.body?.value ?? [];
  out.granted_count = assignments.length;

  // Resolve appRoleId -> human name via each resource SP's appRoles.
  const resourceCache = new Map();
  const resolved = [];
  for (const a of assignments) {
    if (!resourceCache.has(a.resourceId)) {
      const r = await graph(
        `v1.0/servicePrincipals/${a.resourceId}?$select=id,displayName,appRoles`,
      );
      resourceCache.set(a.resourceId, r.body);
    }
    const resource = resourceCache.get(a.resourceId);
    const role = (resource?.appRoles ?? []).find((x) => x.id === a.appRoleId);
    resolved.push(
      `${resource?.displayName ?? a.resourceDisplayName} :: ${role?.value ?? a.appRoleId}`,
    );
  }
  out.granted_permissions = resolved.sort();

  out.has_mail_send = resolved.some((r) => /:: Mail\.Send$/.test(r));
  out.has_mail_readwrite = resolved.some((r) => /:: Mail\.ReadWrite$/.test(r));
  out.has_exchange_manage_as_app = resolved.some((r) => /Exchange\.ManageAsApp/.test(r));
  out.has_app_role_assignment_rw = resolved.some((r) =>
    /:: AppRoleAssignment\.ReadWrite\.All$/.test(r),
  );
  out.has_application_rw = resolved.some((r) => /:: Application\.ReadWrite\.All$/.test(r));
  out.has_directory_rw = resolved.some((r) => /:: Directory\.ReadWrite\.All$/.test(r));
  out.has_group_rw = resolved.some((r) => /:: Group\.ReadWrite\.All$/.test(r));
  out.has_rolemanagement_rw = resolved.some((r) => /:: RoleManagement\.ReadWrite\.Directory$/.test(r));

  // Can we self-grant? Needs AppRoleAssignment.ReadWrite.All (+ Application.ReadWrite.All).
  out.can_self_grant_permissions =
    out.has_app_role_assignment_rw && (out.has_application_rw || out.has_directory_rw);
}

// Is an Exchange Application Access Policy restricting us? (would explain 403 despite Mail.Send)
const policies = await graph('v1.0/policies/permissionGrantPolicies?$select=id,displayName');
out.permission_grant_policies_http = policies.status;

// Live send probe: does sendMail work as the host mailbox?
const host = env.M365_HOST_MAILBOX || 'joshmonroe@tagevc.com';
const probe = await graph(`v1.0/users/${encodeURIComponent(host)}/sendMail`, {
  method: 'POST',
  body: JSON.stringify({
    message: {
      subject: 'probe',
      body: { contentType: 'Text', content: 'probe' },
      toRecipients: [{ emailAddress: { address: host } }],
    },
    saveToSentItems: false,
  }),
});
out.sendmail_probe = {
  as: host,
  http: probe.status,
  error: probe.body?.error?.code ?? null,
  message: probe.body?.error?.message ?? null,
};

// Exchange Online app-only token feasibility (outlook.office365.com resource).
const tokenRes = await fetch(
  `https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`,
  {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.MS_GRAPH_CLIENT_ID,
      client_secret: env.MS_GRAPH_CLIENT_SECRET,
      scope: 'https://outlook.office365.com/.default',
      grant_type: 'client_credentials',
    }),
  },
);
const tokenJson = await tokenRes.json();
out.exchange_app_token = tokenRes.ok
  ? { ok: true, note: 'EXO app-only token issued — Exchange.ManageAsApp path viable' }
  : { ok: false, error: tokenJson.error, description: String(tokenJson.error_description ?? '').slice(0, 260) };

console.log(JSON.stringify(out, null, 2));
