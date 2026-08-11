# Microsoft Graph — Visionary mailbox FullAccess

See also **`docs/MS_GRAPH_HRIS.md`** for joiner provision (`MS_GRAPH_CREATE_USERS`) and combined env table.

Goal: Visionary (Josh) can **Open another mailbox** in Outlook for each user.

## Onboarding checklist

HRIS step `bs.visionary_mailbox_access` on `r619-onboarding-v1`:
"Grant Visionary (Josh) Read and manage mailbox permissions"

Automation is **assist** — fail-soft if Graph is not configured; the step stays visible for IT.

## Env flags (Tage OS / Vercel)

| Variable | Purpose |
|----------|---------|
| `MS_GRAPH_TENANT_ID` | Entra tenant |
| `MS_GRAPH_CLIENT_ID` | App registration |
| `MS_GRAPH_CLIENT_SECRET` | App secret |
| `MS_GRAPH_VISIONARY_MAILBOX_UPN` | Default `joshmonroe@tagevc.com` |
| `MS_GRAPH_GRANT_VISIONARY_MAILBOX` | Set `1` to attempt live grants |

## Entra app permissions — app-only automation is live (2026-08-10)

- **`Exchange.ManageAsApp` (Application): granted and admin-consented.** Note it sits on
  the **Office 365 Exchange Online** resource (`00000002-0000-0ff1-ce00-000000000000`),
  not Microsoft Graph, so it never appears in a Graph token — a Graph-token-only check
  will wrongly report it missing.
- **Exchange Recipient Administrator** directory role is assigned to the service
  principal. This is the least-privilege role that works; Exchange Administrator is not
  needed. Without *some* directory role, Exchange RBAC has nothing to authorise against
  and every app-only admin call returns 403.
- **Microsoft Graph cannot do this at all.** There is no `mailboxPermissions` route;
  `POST /beta/users/{id}/mailboxPermissions` 404/405s regardless of consent. Exchange
  Online is the only path.
- **No certificate is required.** A client secret is enough for the `adminapi`
  `InvokeCommand` transport. The certificate requirement applies only to the
  `Connect-ExchangeOnline` PowerShell module, which the app does not use.

That combination is standing capability — the next hire's mailbox step grants itself with
no interactive session. Details and reproduction: **`docs/ENTRA_GRAPH_PERMISSIONS.md`**.

Repeatable script:

```bash
node scripts/dennis-onboard/19-grant-fullaccess.mjs <mailbox> [visionary-upn]
node scripts/dennis-onboard/20-verify-and-close.mjs   # read-only audit
```

Manual fallback, if Exchange is refusing the app for some reason:

```powershell
Connect-ExchangeOnline -UserPrincipalName joshmonroe@tagevc.com
Add-MailboxPermission -Identity <user> -User joshmonroe@tagevc.com `
  -AccessRights FullAccess -InheritanceType All
```

Or via Exchange admin centre: **Full Access** / **Read and manage** on each mailbox to the
Visionary UPN.

## Code entry

`grantVisionaryMailboxFullAccess()` in `src/lib/shared-services/it-mdm.ts`

Call from HRIS IT assist when completing `bs.visionary_mailbox_access`, or manually from IT tooling.

## Existing users

Run a one-time IT pass (PowerShell or Graph) for current mailboxes, or invoke
`grantVisionaryMailboxForExistingEmployees()` / `grantExistingMailboxAction` when Graph is enabled.
