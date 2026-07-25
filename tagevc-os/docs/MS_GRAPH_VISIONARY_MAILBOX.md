# Microsoft Graph — Visionary mailbox FullAccess

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

## Entra app permissions (admin consent required)

Preferred application permission for mailbox FullAccess automation:

- **Exchange.ManageAsApp** (Application)
- Plus Exchange Online role assignment for the app (e.g. **Mailbox Import Export** is wrong — use a custom role / **Recipient Management** style assignment that can run `Add-MailboxPermission`, or Graph beta mailboxPermissions)

Delegated admin path (manual IT):

- Exchange admin grants: **Full Access** + **Read and manage** on each mailbox to Visionary UPN.

## Code entry

`grantVisionaryMailboxFullAccess()` in `src/lib/shared-services/it-mdm.ts`

Call from HRIS IT assist when completing `bs.visionary_mailbox_access`, or manually from IT tooling.

## Existing users

Run a one-time IT pass (PowerShell or Graph) for current mailboxes, or invoke the grant helper per user email when Graph is enabled.
