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

## Joiner invite to the hire's personal email

The joiner emails the new hire's **personal** address (`os_hris_employees.personal_email`)
with their sign-in details, so nobody has to hand over a temp password out of band.
Work mail is unreachable before first sign-in, which is why the personal address is used.

| Variable | Purpose |
|----------|---------|
| `HRIS_JOINER_INVITE_EMAIL` | `0` / `false` / `off` disables. **Default on.** |

What the hire receives:

- Sign-in name (UPN)
- Temp password when this run created the account, else a link to
  `passwordreset.microsoftonline.com`
- First sign-in steps: office.com → change password → MFA enrolment → Outlook/Teams check
- Portal link, to sign in with **Continue with Microsoft**

Transport: `sendPlatformEmail({ channel: 'system' })` — Graph shared mailbox, Resend fallback.
Tracking is forced **off** so credentials are never pixel-tracked or written to CRM history.

Guarantees:

- Never throws. A missing/invalid personal email downgrades to a step-evidence note
  telling IT to hand the details over manually; the joiner still succeeds.
- The temp password is passed straight to the mail body. It is **not** persisted, logged,
  or written into audit metadata or step evidence — only a masked recipient
  (`b****@gmail.com`) and a sent/not-sent flag are recorded.

Code: `src/lib/hris/joiner-invite.ts`, wired into `runGraphJoinerAssist()`
in `src/lib/hris/step-assists.ts`. Tests: `src/lib/hris/joiner-invite.test.ts`.

### Entity OS link — not the Tage parent

The invite links the hire to **the OS of the entity that hired them** (a Recruit 619
hire goes to the Recruit 619 OS). Linking everyone to `app.tagevc.com` sent
subsidiary staff to a surface their role cannot see.

Resolution: `entityOsUrl()` / `entityOsLabel()` in `@/lib/multi-sub/entity-registry`,
driven by the entity registry, so new entities need no code change. Unknown entities
fall back to an entity-scoped page on the parent app.

### Instant NDA enterprise access

Every entity — parent and subsidiaries — gets free Instant NDA enterprise accounts
through its email domain, so the invite includes an Instant NDA section for all hires.
Copy names the hiring entity and the hire's own domain, points at
`https://app.instantnda.us` (native apps are not live yet), and asks them to use it
for sensitive conversations. Instant NDA's own staff get "the product you are joining"
framing instead of "free account we give you".

Code: `src/lib/hris/instant-nda-access.ts`. Tests: `instant-nda-access.test.ts`.
`buildInstantNdaEmail()` also sends the section standalone to already-onboarded staff.

---

## Outbound transport

The Graph app registration holds the **`Mail.Send`** application permission
(admin-consented 2026-08-10), verified live: `POST /users/{id}/sendMail` returns
`202`. Graph is the primary transport for `sendPlatformEmail({ channel: 'system' })`,
including personal-email invites to external addresses.

Two supporting paths remain, no longer as permission workarounds:

1. **Resend fallback** — `sendPlatformEmail({ channel: 'system' })` treats a Graph send
   failure as a transport failure and retries through Resend rather than failing the
   whole send. Still worth keeping for per-mailbox failures (missing send-as on an
   alias, Exchange application access policy, throttling). Needs `RESEND_API_KEY`.
2. **Tenant mailbox delivery** — `deliverToTenantMailbox()` in
   `src/lib/platform-email/tenant-mailbox-delivery.ts` writes a message straight into a
   tenant mailbox's Inbox using `Mail.ReadWrite`, so internal-only notices can land
   unread in an Inbox without an SMTP hop. Tenant mailboxes only.

Full permission inventory: **`docs/ENTRA_GRAPH_PERMISSIONS.md`**.

---

## Distribution group (`sd.distro`)

Adds the hire to their **entity's** group, not just tenant-wide All Company.

| Variable | Purpose |
|----------|---------|
| `MS_GRAPH_DISTRO_GROUP_IDS` | `ENT-R619=<guid>,ENT-FIRM=<guid>` — skips the name lookup |
| `MS_GRAPH_CREATE_DISTRO_GROUPS` | Set `1` to create the group when none exists. **Default off.** |

`Group.ReadWrite.All` is granted (2026-08-10), so creation works. It stays opt-in because
it writes a new group into the tenant directory; with the flag off a missing group is
reported as a configuration gap and the step stays open for IT.

Graph can only create **Microsoft 365 (Unified)** groups. Distribution lists and
mail-enabled security groups are Exchange-only, so an existing DL must be wired up
through `MS_GRAPH_DISTRO_GROUP_IDS` rather than recreated.

Code: `src/lib/hris/distro-step.ts`. Tests: `distro-step.test.ts`.

---

## Visionary mailbox FullAccess (`bs.visionary_mailbox_access`)

Goal: Visionary (Josh) can **Open another mailbox** in Outlook for each hire.

| Variable | Purpose |
|----------|---------|
| `MS_GRAPH_VISIONARY_MAILBOX_UPN` | Default `joshmonroe@tagevc.com` |
| `MS_GRAPH_GRANT_VISIONARY_MAILBOX` | Set `1` to attempt live grants |

**Entra:** `Exchange.ManageAsApp` is granted and admin-consented (on the **Office 365
Exchange Online** resource, not Graph). Still blocked: the service principal holds no
Exchange directory role and the app registration has no certificate credential, so
app-only Exchange calls return 403. Graph itself has no `mailboxPermissions` route, so
this stays an interactive `Add-MailboxPermission` until both gaps close — see
`docs/ENTRA_GRAPH_PERMISSIONS.md`.

Existing employees: HR/IT can run the mailbox grant pass from server action
`grantExistingMailboxAction` (fail-soft per user).

Code: `grantVisionaryMailboxFullAccess()` + `grantVisionaryMailboxForExistingEmployees()`

---

## Email signature (`sd.email_sig`)

Onboarding step **Configure email signature & Teams background** is assisted via
`email_signature` hook → `runEmailSignatureAssist()` (`src/lib/hris/email-signature-step.ts`).

Builds entity-branded HTML (portfolio logo bar — parent + all siblings) from employee
`entity_id`. **Graph cannot write Outlook signatures** — assist returns dry-run /
NEED_HUMAN with EXO `Set-MailboxMessageConfiguration` steps. See `docs/EMAIL_SIGNATURES.md`.

SQL: `supabase/phase_email_signature_onboarding.sql`

| Variable | Purpose |
|----------|---------|
| `EMAIL_SIGNATURE_APPLY` | Set `1` to attempt live apply path (still NEED_HUMAN until EXO wired) |

Do not apply to break-glass accounts. Bulk mailbox sweeps require Josh confirmation.

---

## Human gates

- Destructive access revoke: confirm in UI
- DocuSign offer/NDA: explicit confirm (no silent send)
- Graph create users: opt-in env flag
- Org-wide email signature push: Josh confirmation + EXO admin

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
