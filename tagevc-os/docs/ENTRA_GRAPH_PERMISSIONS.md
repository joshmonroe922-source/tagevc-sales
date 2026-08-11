# Entra / Graph app permissions — verified live state

Live verification of the **Tage VC OS** app registration against the tenant, run
**2026-08-10**. Everything below was read from Microsoft Graph with the app-only
client-credentials flow (`scripts/dennis-onboard/lib.mjs`), not from repo notes.

| Field | Value |
|-------|-------|
| App / SP display name | **Tage VC OS** |
| Client (application) id | `905649ff-1aee-4683-87e0-5d6d2005aea5` |
| Service principal object id | `1d44ad06-fbda-4ac4-b4fe-2c3885b4ac37` |
| Application object id | `3423e515-ef79-48eb-a6cb-18aa2e83fcb9` |
| Tenant | `aecc0efa-a429-4b4f-8c77-c2957b8263ab` (Tage Venture Capital) |
| Tenant initial domain | `NETORGFT15674001.onmicrosoft.com` (default: `tagevc.com`) |
| Sign-in audience | `AzureADMyOrg` |

## Granted application permissions (app roles)

All nine `appRoleAssignments` on the service principal, resolved to human names.

| Resource | App role | Display name | Granted |
|----------|----------|--------------|---------|
| Microsoft Graph | `DeviceManagementManagedDevices.ReadWrite.All` | Read and write Microsoft Intune devices | 2026-08-07 |
| Microsoft Graph | `Directory.Read.All` | Read directory data | 2026-08-07 |
| Microsoft Graph | **`Group.ReadWrite.All`** | Read and write all groups | **2026-08-10** |
| Microsoft Graph | `GroupMember.ReadWrite.All` | Read and write all group memberships | 2026-08-07 |
| Microsoft Graph | `Mail.ReadWrite` | Read and write mail in all mailboxes | 2026-08-03 |
| Microsoft Graph | **`Mail.Send`** | Send mail as any user | **2026-08-10** |
| Microsoft Graph | `Organization.Read.All` | Read organization information | 2026-08-07 |
| Microsoft Graph | `User.ReadWrite.All` | Read and write all users' full profiles | 2026-08-07 |
| Office 365 Exchange Online | **`Exchange.ManageAsApp`** | Manage Exchange As Application | **2026-08-10** |

Delegated grants (`oauth2PermissionGrants`, consent type `AllPrincipals`, Microsoft Graph):
`email offline_access openid profile User.Read Mail.Send Mail.ReadWrite`.

Token claims confirm the same set — the Graph token (`aud https://graph.microsoft.com`)
carries all eight Graph roles, and a separate token for `https://outlook.office365.com/.default`
is issued carrying `Exchange.ManageAsApp`.

## Verdicts on the three permissions in question

| Permission | Verdict | Evidence |
|------------|---------|----------|
| `Mail.Send` (Graph) | **CONFIRMED — granted and working** | App role assigned 2026-08-10; present in token `roles`; `POST /v1.0/users/joshmonroe@tagevc.com/sendMail` returned **HTTP 202** on a self-addressed test message |
| `Group.ReadWrite.All` (Graph) | **CONFIRMED — granted and working** | App role assigned 2026-08-10; present in token `roles`; `POST /v1.0/directoryObjects/validateProperties` (a group-write-gated, non-destructive call) returned **HTTP 204**; `GET /groups/delta` returns 200 |
| `Exchange.ManageAsApp` (Office 365 Exchange Online) | **CONFIRMED granted — but NOT usable** | App role assigned 2026-08-10 on resource `00000002-0000-0ff1-ce00-000000000000`; EXO token is issued with the role. Every Exchange admin call still returns **HTTP 403** (see below) |

`Exchange.ManageAsApp` is on the **Office 365 Exchange Online** resource, so it never
appears in a Microsoft Graph token. Any check that only decodes the Graph token will
report it missing — that is a false negative.

## Blocking gaps

### 1. The service principal holds no directory role

`GET /servicePrincipals/{id}/transitiveMemberOf` → **empty**.
`GET /roleManagement/directory/roleAssignments?$filter=principalId eq '{sp}'` → **empty**.

Cross-checked against every activated directory role in the tenant:

| Directory role | Members | SP is a member |
|----------------|---------|----------------|
| Global Administrator | 1 | no |
| Exchange Administrator | **0** | no |
| Global Reader | 0 | no |
| Directory Readers | 0 | no |
| Helpdesk Administrator | 0 | no |
| Billing Administrator | 0 | no |
| Azure AD Joined Device Local Administrator | 0 | no |

Exchange Administrator is activated in the tenant but has **zero members**. The app role
grants the *right to ask*; the directory role is what gives Exchange RBAC something to
authorise against. Without it, Exchange refuses every cmdlet.

### 2. No certificate credential on the app registration

`GET /applications(appId='…')` → `keyCredentials: []`.

Only client secrets exist (5 of them, all currently valid):

| Secret display name | Expires |
|---------------------|---------|
| Tage OS Identity Worker 2026-08 | 2027-02-03 |
| Tage OS Graph mail | 2028-08-02 |
| Tage OS Graph | 2028-07-24 |
| Tage VC OS Supabase | 2028-07-19 |
| supabase | 2028-07-19 |

`Connect-ExchangeOnline` app-only auth requires `-CertificateThumbprint` / `-Certificate`;
the module will not accept a client secret. With no `keyCredentials`, the supported
PowerShell path is unavailable today.

### 3. Exchange admin endpoints return 403

Called directly with the `Exchange.ManageAsApp` token (the same REST transport
`Connect-ExchangeOnline` uses underneath):

| Call | Result |
|------|--------|
| `POST /adminapi/beta/{tenant}/InvokeCommand` → `Get-OrganizationConfig` | **403** |
| `POST /adminapi/beta/{tenant}/InvokeCommand` → `Get-MailboxPermission` (Dennis) | **403** |
| `GET /adminapi/beta/{tenant}/Mailbox?$top=1` | **403** |

No `x-ms-diagnostics` reason was returned. The 403 pattern is consistent with gap #1
(no Exchange RBAC role for the principal) rather than a bad token — the token itself is
issued with the correct audience and role.

## What is genuinely usable today

| Capability | Status |
|------------|--------|
| Send mail as any tenant user (`sendMail`) | **Live** — verified 202 |
| Read/write mail in all mailboxes, write into a mailbox Inbox | **Live** |
| Create / update / delete groups, manage group membership | **Live** (role held; only non-destructive proof was run) |
| Create / update users, assign licences | **Live** |
| Read directory, organization, Intune managed devices | **Live** |
| Exchange Online management (`Add-MailboxPermission`, `Set-MailboxMessageConfiguration`, mailbox settings, shared-mailbox config) | **Blocked** — 403 |
| Visionary mailbox FullAccess on `dennismccall@recruit619.com` | **Blocked** — cannot be automated with today's credentials |

**Can the Dennis FullAccess grant be automated? Not yet.** Microsoft Graph has no
`mailboxPermissions` route at all (a separate, permanent limitation — the beta endpoint
404/405s regardless of consent), so Exchange Online is the only path, and Exchange
currently rejects the app. Both gap #1 and gap #2 must close before it can be scripted.
Until then it stays a ~30 second interactive task for Josh:

```powershell
Connect-ExchangeOnline -UserPrincipalName joshmonroe@tagevc.com
Add-MailboxPermission -Identity dennismccall@recruit619.com `
  -User joshmonroe@tagevc.com -AccessRights FullAccess -InheritanceType All
```

## NEED_HUMAN

1. **Assign Exchange Administrator to the service principal.**
   Entra admin centre → **Identity → Roles & admins → Roles & admins** → search
   *Exchange Administrator* → **Add assignments** → switch the picker to include
   service principals → select **Tage VC OS** (`905649ff-1aee-4683-87e0-5d6d2005aea5`)
   → Assign (Active, permanently).
   Direct: `https://entra.microsoft.com/#view/Microsoft_AAD_IAM/RolesManagementMenuBlade/~/AllRoles`

2. **Upload a certificate to the app registration.**
   Entra admin centre → **Identity → Applications → App registrations → Tage VC OS →
   Certificates & secrets → Certificates → Upload certificate** (`.cer` public key).
   Generate locally, keep the `.pfx`/private key in `.local-secrets/`, never in git.
   Direct: `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Credentials/appId/905649ff-1aee-4683-87e0-5d6d2005aea5`

   ```bash
   openssl req -x509 -newkey rsa:2048 -sha256 -days 730 -nodes \
     -keyout tage-os-exo.key -out tage-os-exo.cer \
     -subj "/CN=Tage OS Exchange App"
   openssl pkcs12 -export -out tage-os-exo.pfx -inkey tage-os-exo.key -in tage-os-exo.cer
   ```

3. **Verify app-only Exchange after 1 + 2** (role propagation can take ~15–60 min):

   ```powershell
   Connect-ExchangeOnline -AppId 905649ff-1aee-4683-87e0-5d6d2005aea5 `
     -CertificateThumbprint <thumbprint> -Organization NETORGFT15674001.onmicrosoft.com
   Get-OrganizationConfig | Select-Object Name
   ```

4. **Interim:** Josh runs the `Add-MailboxPermission` snippet above interactively to
   unblock `bs.visionary_mailbox_access` for Dennis.

Item 1 alone may be enough for the REST `adminapi` transport this audit exercised, since
that path accepted a secret-derived token and failed only on authorisation. That is an
inference, not a verified result — the certificate is still required for the supported
`Connect-ExchangeOnline` module path, so treat 1 and 2 as a pair.

## Repo claims contradicted by this audit

All corrected in the same change that landed this file — kept here as the record of what
was wrong and why, so a future reader can tell a deliberate correction from a regression.

| File · line | Stale claim | Reality |
|-------------|-------------|---------|
| `scripts/dennis-onboard/07-finalize.mjs:142` | "Graph app roles currently held: … `Exchange.ManageAsApp` is **NOT granted**" and a role list omitting `Mail.Send` / `Group.ReadWrite.All` | All three are granted; that step's `evidence_note` is already written into `os_hris_process_steps` and needs re-running or a manual note update |
| `scripts/dennis-onboard/07-finalize.mjs:146` | "Requires interactive MFA, so it cannot be automated with the current app-only credentials" | Conclusion still holds, but the reason is wrong — it is the missing directory role + certificate, not consent |
| `docs/MS_GRAPH_HRIS.md:78`, `:80` | "The Graph app registration holds `Mail.ReadWrite` but **not** `Mail.Send`, so `POST /users/{id}/sendMail` returns 403" | `Mail.Send` is granted; `sendMail` returns 202 |
| `docs/MS_GRAPH_HRIS.md:90`, `:92`–`93` | "personal-email invites still need `Mail.Send` or Resend" / "To close the gap properly, grant the `Mail.Send` application permission" | Gap is closed; the Resend fallback and `deliverToTenantMailbox()` workaround are no longer mandatory |
| `src/lib/hris/distro-step.ts:12` | "Creating groups needs `Group.ReadWrite.All`, which the app does not hold" | The app holds it; group creation can now be automated |
| `src/lib/hris/distro-step.ts:120` | Operator message "…or grant `Group.ReadWrite.All` so Tage can create it" | Stale guidance |
| `src/lib/platform-email/tenant-mailbox-delivery.ts:5`, `:11` | "Sending mail needs the `Mail.Send` application permission. Until that is…" / "still require `Mail.Send` or Resend" | Permission now held |
| `src/lib/platform-email/send.ts:234` | Comment framing `Mail.Send` as an outstanding separate grant | Now granted |
| `src/lib/shared-services/it-mdm.ts:1055` | "Set `MS_GRAPH_GRANT_VISIONARY_MAILBOX=1` and Graph `Exchange.ManageAsApp` to auto-grant FullAccess" | Misleading twice over: `Exchange.ManageAsApp` is not a *Graph* role, and having it does not enable the auto-grant — Graph has no `mailboxPermissions` route |
| `docs/M365_MAIL_SETUP.md:31`, `:40`, `:45` | "**Delegated** `Mail.Send` + `Mail.ReadWrite`" / "**Not using Application Mail.\* yet**" | Application `Mail.Send` + `Mail.ReadWrite` are both granted and in use |
| `docs/AP_INVOICE_W9_EMAIL.md:20` | "Application Mail.\* deferred until true shared mailboxes" | No longer deferred |
| `docs/MS_GRAPH_VISIONARY_MAILBOX.md:28`–`29` | Lists `Exchange.ManageAsApp` + an Exchange role assignment as the requirement | Accurate in shape but reads as unfinished; should record that the app role is granted and only the directory role + certificate remain |
| `docs/OS_PHASE72_HRIS.md:29` | "Live Graph `User.ReadWrite.All` + `Exchange.ManageAsApp` admin consent in production" as a pending item | Consent is done; the remaining work is the directory role + certificate |

`scripts/dennis-onboard/13-graph-permission-audit.mjs:104` is the one existing script that
gets it right — it treats a successfully issued EXO token as evidence the
`Exchange.ManageAsApp` path is viable. Note that "viable" stops short of "working": the
token issues, the cmdlets still 403.

## Reproducing

```bash
cd tagevc-os
node scripts/dennis-onboard/08-consent-probe.mjs   # token role claims for both audiences
```

That script decodes the Graph and Exchange tokens but does not enumerate
`appRoleAssignments`, directory roles, or `keyCredentials` — the three things that
actually explain the current state. Anything relying on the Graph token alone will keep
mis-reporting `Exchange.ManageAsApp`.

## Acceptance

- [x] `Mail.Send` granted and functionally verified (202)
- [x] `Group.ReadWrite.All` granted and functionally verified (204)
- [x] `Exchange.ManageAsApp` granted on Office 365 Exchange Online
- [ ] Exchange Administrator (or equivalent) assigned to the service principal
- [ ] Certificate credential uploaded to the app registration
- [ ] `Get-OrganizationConfig` succeeds app-only
- [ ] `bs.visionary_mailbox_access` FullAccess granted for Dennis
