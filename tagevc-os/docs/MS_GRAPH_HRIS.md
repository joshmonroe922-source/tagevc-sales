# Microsoft Graph — HRIS joiner provision + Visionary mailbox

## Joiner provision (`bs.ms_email`)

When the onboarding access step is completed, Tage attempts Graph create/update.

| Variable | Purpose |
|----------|---------|
| `MS_GRAPH_TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` | App credentials |
| `MS_GRAPH_CREATE_USERS` | Set `1` to enable live create/update |
| `MS_GRAPH_JOINER_DOMAIN` | Optional UPN domain override |
| `MS_GRAPH_JOINER_TEMP_PASSWORD` | Optional temp password (else random) |

**Entra application permission (admin consent):** `User.ReadWrite.All`

Fail-soft: if unset, the step stays visible with setup messaging; IT can complete manually.

Code: `createOrUpdateGraphUserJoiner()` in `src/lib/shared-services/it-mdm.ts`

---

## Visionary mailbox FullAccess (`bs.visionary_mailbox_access`)

Goal: Visionary (Josh) can **Open another mailbox** in Outlook for each hire.

| Variable | Purpose |
|----------|---------|
| `MS_GRAPH_VISIONARY_MAILBOX_UPN` | Default `joshmonroe@tagevc.com` |
| `MS_GRAPH_GRANT_VISIONARY_MAILBOX` | Set `1` to attempt live grants |

**Entra:** `Exchange.ManageAsApp` (application) + admin consent / Exchange role assignment.

Existing employees: HR/IT can run the mailbox grant pass from server action
`grantExistingMailboxAction` (fail-soft per user).

Code: `grantVisionaryMailboxFullAccess()` + `grantVisionaryMailboxForExistingEmployees()`

---

## Human gates

- Destructive access revoke: confirm in UI
- DocuSign offer/NDA: explicit confirm (no silent send)
- Graph create users: opt-in env flag

---

## Document vault RLS (Phase 77)

Bucket: `hris-private`  
Paths: `{entity_id}/{employee_id}/{file}` (legacy `{employee_id}/…` still resolves)

| Principal | Access |
|-----------|--------|
| Visionary | Break-glass (all) |
| HR roles (`admin`, `coo`, `counsel_ops`, `service_lead`) | Entity-scoped via `can_access_entity` |
| Assigned manager (`manager_profile_id`) | Own reports only |
| Everyone else | Denied (unresolvable paths denied) |

SQL helpers: `is_hris_employee_accessible`, `is_hris_doc_accessible`, `can_access_hris_storage_path`  
Migration: `supabase/phase77_hris_vault_rls.sql`

Manager assignment uses a people picker (name/email search) — no raw UUID paste.
