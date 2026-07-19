# Tage VC — Microsoft 365 calendar, meetings, tasks, Teams chat, OneDrive & Mail setup

The portal connects each user’s **personal Outlook / Microsoft 365 mailbox** via Microsoft Graph OAuth.

| Route | Purpose |
|-------|---------|
| **`/sales/calendar`** | Agenda / week / month · **New Meeting** |
| **`/sales/todo`** | Master **Microsoft To Do** across portal lists (`Tage · {Portal}`), with portal filter chips |
| **`/sales/planner`** | Microsoft **Planner** plans & tasks |
| **`/sales/chat`** | Teams **1:1 and group chats** (conversation list, thread, compose, people picker) |
| **`/sales/files`** | **OneDrive** browse · upload · in-portal preview · rename/delete · org share (no download) |
| **`/sales/mail`** | **Outlook mail** inbox/folders · read · compose/reply/forward · search · archive/delete (in-portal) |

Available to **all authenticated portal users** (not a separate portal assignment). Each portal section embeds a scoped To Do panel that creates/uses a Microsoft list named **`Tage · {Portal name}`** (created on first use). Deal Sourcing follow-ups at `/sales/deal-sourcing/tasks` and lead cards also soft-sync into **Tage · Deal Sourcing** when Microsoft is connected.

Until Azure app registration + edge secrets are in place, the UI shows a clear “not configured” state. After secrets are set and functions are deployed, users click **Connect work calendar** / **Connect Microsoft**.

**After upgrading scopes**, every user must click **Reconnect** (Mail / Files / Chat / Calendar banner) so Microsoft issues tokens with the new permissions.

---

## What Josh must do in Azure / Entra

### 1. App registration

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) → **Identity** → **Applications** → **App registrations** → **New registration** (or open existing **Tage VC Portal Calendar**).
2. Name: `Tage VC Portal Calendar` (or similar).
3. Supported account types:
   - Prefer **Accounts in this organizational directory only** (single tenant `tagevc.com`), **or**
   - **Accounts in any organizational directory** if partners ever use guest accounts.
4. Redirect URI — platform **Web**:
   ```
   https://hqmobgtnedmhzipusert.supabase.co/functions/v1/microsoft-calendar-oauth-callback
   ```
   Replace the project ref if it ever changes (`supabase/.temp/project-ref`).
5. Register the app. Copy:
   - **Application (client) ID**
   - **Directory (tenant) ID** (use this instead of `common` for single-tenant)

### 2. Client secret

1. App → **Certificates & secrets** → **New client secret**.
2. Copy the **Value** once (this is `MS_GRAPH_CLIENT_SECRET`).

### 3. API permissions (delegated) — required for current portal features

App → **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**:

| Permission (exact name in Azure) | Required | Used for |
|----------------------------------|----------|----------|
| `User.Read` | **Yes** | Identify mailbox (`/me`) |
| `User.ReadBasic.All` | **Yes (chat resolve / directory)** | Resolve org users by email/UPN for Teams chat member binds (`/users`) |
| `Calendars.ReadWrite` | **Yes** | List events + **New Meeting** (optional Teams link on the calendar event) |
| `Tasks.ReadWrite` | **Yes** | Microsoft **To Do** + **Planner** task create/list/complete for the signed-in user |
| `People.Read` | **Yes** | Attendee / chat people type-ahead (`/me/people`) |
| `Contacts.Read` | **Yes** | Contact fallback for people search |
| `Chat.ReadWrite` | **Yes (Teams chat)** | List / create 1:1 & group chats, read messages |
| `ChatMessage.Send` | **Yes (Teams chat)** | Send chat messages |
| `Files.ReadWrite` | **Yes (OneDrive / Files)** | Browse / upload / preview / rename / delete / share **personal OneDrive** + shared folders the user can write (downloads disabled in portal; vault uses `Tage Portal/Downloads`) |
| `Mail.ReadWrite` | **Yes (Mail)** | List / read / move / delete mailbox messages & folders |
| `Mail.Send` | **Yes (Mail)** | Send / reply / reply-all / forward as the connected mailbox (own SMTP aliases as From need no extra scope) |
| `MailboxSettings.ReadWrite` | **Yes (Mail OOO)** | Read/update automatic replies, timezone, language via `/me/mailboxSettings` |
| `OnlineMeetings.ReadWrite` | **Yes (Teams video)** | Create / manage online meetings (join URL) from Chat + dedicated meeting API |
| `offline_access` | **Yes** | Refresh tokens (usually via OAuth scope string) |
| `openid` | **Yes** | OIDC |

**Company shared vault (document / recruiting Resumes):** prefer a SharePoint site library.

| Scope | When | Notes |
|-------|------|-------|
| `Sites.ReadWrite.All` | **Request for company vault** | Create/list Company Files + Resumes on a site drive. **Admin consent** + user **Reconnect**. Least privilege alternative: `Sites.Selected` if your tenant supports granting one site only. |
| `Sites.Read.All` | Optional read-only | Not enough to ensure/create Resumes |

**Without Sites scopes:** share a folder named **Company Files** with each portal user; Graph `sharedWithMe` + `Files.ReadWrite` can still write Resumes under that shared folder.

See `SETUP_SALESFORCE_RESUMES.md` for Recruit 619 → Salesforce sync (scaffold).

Then click **Grant admin consent for Tage…** so users are not blocked by consent prompts. **Chat, Files, directory (`User.ReadBasic.All`), and OnlineMeetings scopes require admin consent** in most tenants.

### Critical: users must Reconnect after Azure consent

Admin consent updates the **app registration**, not existing user refresh tokens. After adding or changing Graph permissions (or `MS_GRAPH_SCOPES`):

1. Update the `MS_GRAPH_SCOPES` secret (include **all** scopes — see below).
2. Redeploy oauth-start / oauth-callback / status (+ chat / online-meetings as needed).
3. Each user must click **Reconnect** (or Connect) in Calendar / Chat / Files so a new OAuth authorize round-trip mints a token with the new scopes.

Until they Reconnect, directory lookups (`/users`) and new APIs return **403** even though Azure shows the permission as granted.

### 4. Optional: Authentication extras

- Under **Authentication**, ensure the Web redirect URI above is listed.
- No SPA redirect is required; the browser hits the **edge callback**, which then redirects to the portal.

---

## Redirect URIs (checklist)

| Environment | Redirect URI |
|-------------|--------------|
| Production (Supabase edge callback) | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/microsoft-calendar-oauth-callback` |
| Portal after OAuth | Users land on `{SALES_PORTAL_URL}/sales/calendar`, `/sales/chat`, `/sales/files`, or `/sales/mail` (whichever started OAuth) |
| Local portal | `http://localhost:5173/sales/…` — set `SALES_PORTAL_URL=http://localhost:5173` when testing locally |

**Interim host:** Until `portal.tagevc.com` DNS is live, set `SALES_PORTAL_URL=https://tagevc-sales.vercel.app` so the OAuth callback returns users to a working portal. Switch back to `https://portal.tagevc.com` once the custom domain resolves.

You do **not** register `portal.tagevc.com`, the Vercel URL, or localhost as Microsoft redirect URIs unless you change the OAuth callback to the SPA. Current design: **only the Supabase function URL** is the Azure redirect URI.

---

## Edge function secrets

In Supabase → **Project Settings → Edge Functions → Secrets** (or CLI):

```bash
cd /Users/joshmonroe/Projects/tagevc-sales

# Generate a 32-byte key (64 hex chars):
openssl rand -hex 32

supabase secrets set \
  MS_GRAPH_CLIENT_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \
  MS_GRAPH_CLIENT_SECRET="your-client-secret-value" \
  MS_GRAPH_TENANT_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \
  MS_GRAPH_REDIRECT_URI="https://hqmobgtnedmhzipusert.supabase.co/functions/v1/microsoft-calendar-oauth-callback" \
  MS_TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  SALES_PORTAL_URL="https://tagevc-sales.vercel.app" \
  MS_GRAPH_SCOPES="openid offline_access User.Read User.ReadBasic.All Calendars.ReadWrite Tasks.ReadWrite People.Read Contacts.Read Chat.ReadWrite ChatMessage.Send Files.ReadWrite OnlineMeetings.ReadWrite Mail.ReadWrite Mail.Send MailboxSettings.ReadWrite"
  # Optional room finder (also add Place.Read.All in Azure + admin consent):
  # MS_GRAPH_SCOPES="… Place.Read.All"
  # Company shared Resumes (SharePoint) — add Sites.ReadWrite.All in Azure + admin consent + Reconnect:
  # MS_GRAPH_SCOPES="… Sites.ReadWrite.All"
  # MS_COMPANY_SITE_PATH="netorgft15674001.sharepoint.com"   # Tage tenant root site (no vanity domain yet)
  #   # or a dedicated sub-site once created: "netorgft15674001.sharepoint.com:/sites/CompanyFiles"
  # MS_COMPANY_CREATE_NESTED=1   # nests "Company Files" under the site's default document library
  # MS_COMPANY_DRIVE_ID= / MS_COMPANY_ROOT_ITEM_ID=   # alternative to site path
  # After portal.tagevc.com DNS works:
  # SALES_PORTAL_URL="https://portal.tagevc.com"
```

| Secret | Purpose |
|--------|---------|
| `MS_GRAPH_CLIENT_ID` | App registration client ID |
| `MS_GRAPH_CLIENT_SECRET` | Client secret value |
| `MS_GRAPH_TENANT_ID` | Directory ID (or `common`) |
| `MS_GRAPH_REDIRECT_URI` | Must **exactly** match Azure Web redirect URI |
| `MS_TOKEN_ENCRYPTION_KEY` | 32-byte key (64 hex or base64) — encrypts refresh/access tokens at rest |
| `SALES_PORTAL_URL` | Where OAuth callback sends the browser |
| `MS_GRAPH_SCOPES` | Optional override; **default** includes calendar, tasks, people, directory (`User.ReadBasic.All`), Teams chat, OneDrive Files, **OnlineMeetings.ReadWrite**, **Mail.ReadWrite** + **Mail.Send**, and **MailboxSettings.ReadWrite** |
| `MS_COMPANY_SITE_PATH` | Optional SharePoint site for Company Files / Resumes — Tage tenant root is `netorgft15674001.sharepoint.com` (OneDrive personal sites use the `-my` suffix; the root/team site does not) |
| `MS_COMPANY_CREATE_NESTED` | Set `1` to nest a `Company Files` folder under the site's default document library root instead of using the library root directly |
| `MS_COMPANY_DRIVE_ID` / `MS_COMPANY_ROOT_ITEM_ID` | Optional pin to a drive root when not using site path |

If you previously set `MS_GRAPH_SCOPES` without chat / files / mail / directory / online-meetings scopes, **update the secret** to include **all** existing scopes plus the new ones, redeploy functions, and have users **Reconnect**. Omitting calendar/task scopes from the refresh string can shrink the token and break Calendar.

If `MS_TOKEN_ENCRYPTION_KEY` is missing, tokens are stored with a `plain:` prefix (dev only — set the key before production use).

---

## Deploy edge functions

```bash
export PATH="/Users/joshmonroe/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/joshmonroe/Projects/tagevc-sales

supabase functions deploy microsoft-calendar-oauth-start
supabase functions deploy microsoft-calendar-oauth-callback
supabase functions deploy microsoft-calendar-status
supabase functions deploy microsoft-calendar-events
supabase functions deploy microsoft-calendar-disconnect
supabase functions deploy microsoft-calendar-create-event
supabase functions deploy microsoft-calendar-people-search
supabase functions deploy microsoft-calendar-location-suggest
supabase functions deploy microsoft-todo
supabase functions deploy microsoft-planner
supabase functions deploy microsoft-chat
supabase functions deploy microsoft-online-meetings
supabase functions deploy microsoft-files
supabase functions deploy microsoft-mail
supabase functions deploy salesforce-resume-sync
```

Document vault: on Microsoft connect and first Files/Mail use, the edge layer ensures `Tage Portal/Downloads` on the user’s OneDrive and (when configured) Company Files / Resumes. Mail “Save” writes into that vault — not local disk. See **Document vault** below and `SETUP_SALESFORCE_RESUMES.md`.

`microsoft-calendar-oauth-callback` has `verify_jwt = false` (browser redirect from Microsoft). All others require a portal session JWT.

**After adding directory / OnlineMeetings / Files:** also redeploy `microsoft-calendar-status` and oauth-start / oauth-callback so capability detection and the updated default scope string are live. Users must **Reconnect**.

---

## Database migrations

1. `0014_microsoft_calendar.sql` — `work_email`, connection + OAuth state tables, `set_my_work_email`
2. `0016_calendar_prefs_and_tasks.sql` — `calendar_default_view` (default **agenda**) + `set_my_calendar_default_view`
3. `0040_personal_calendar_feeds.sql` — encrypted Google/personal ICS feed URLs (portal overlay; Graph cannot see Outlook “Add personal calendars”)

Teams chat and OneDrive **reuse** the same `microsoft_calendar_connections` row — no new migration.

```bash
supabase db push
# or paste migrations into the SQL Editor
```

---

## User flow

1. Sign into the portal (Supabase email/password — unchanged).
2. Open **Calendar**, **Chat**, **Files**, or **Mail** in the header.
3. Optionally set **Work email** if portal login ≠ `@tagevc.com` mailbox.
4. Click **Connect** → Microsoft consent → return to the portal.
5. After an admin adds chat / files / mail scopes: **Reconnect** once so the token includes `Chat.ReadWrite`, `Files.ReadWrite`, `Mail.ReadWrite`, and `Mail.Send`.
6. **Chat**: pick an existing conversation, or **New chat** → people picker → 1:1 or group → compose. Soft-refreshes ~every 20s.
7. **Files**: browse **My files** (folders + breadcrumb), optional **Shared with me** (in-portal folder drill-down when drive ids are available), upload (≤4 MB), rename/delete, share via org people invite or org-only link. **Open** uses an in-portal Graph/Office Online iframe preview — **downloads are disabled**.
8. Calendar on `/sales/calendar`; To Do on `/sales/todo`; Planner on `/sales/planner`.

Admins (Josh) already have full portal access; calendar, chat, and files are global so every allowlisted user can connect their own mailbox.

---

## Teams chat limits (v1)

- **Requires Microsoft Teams licenses** for the signed-in user and chat participants.
- **Not a full Teams client** — no channels, team hubs, or meetings UI on `/sales/chat` (meetings stay on Calendar → New Meeting).
- **Admin consent** required for `Chat.ReadWrite` / `ChatMessage.Send`.
- Soft-refresh polling only (realtime / Graph change notifications later).
- **Remove from list:** `POST /chats/{id}/hideForUser` — soft-hides the chat for the signed-in user only (same idea as Teams “Remove from list”). The thread is **not** deleted for other members. Graph `DELETE /chats/{id}` is **admin-only** (`Chat.ManageDeletion.All`) and is not used. A hidden chat can reappear if you send (or take activity) in that chat again. **Meeting chats** often return 404 from `hideForUser`; the portal then soft-hides them in-session (`ui_dismiss`) without claiming a Teams-wide remove.
- **Search:** conversation list filters locally by title/topic/member name/email and last-message preview. In-thread **Find** matches keywords in the currently loaded messages (Graph `$top` max 50 per request; no cheap per-chat `$search`). Org-wide Microsoft Search (`/search/query` + `chatMessage`) is omitted in v1 to avoid extra cost/latency.

---

## OneDrive / Files limits (v1)

- **Not a full OneDrive desktop client** — no sync, offline, or multi-select bulk ops.
- **Document vault**
  - Personal: `Tage Portal/Downloads` (ensured on OAuth connect + first Files/Mail `ensure_vault`)
  - Company: SharePoint site / shared “Company Files” + `Resumes` (needs `Sites.ReadWrite.All` or a shared folder)
  - Mail attachments **Save to Downloads** / **Save to company Resumes** — no local browser download in the normal flow
  - Files UI tabs: Downloads (prominent), Company Shared, My files, Shared with me
- **Personal OneDrive** (`Files.ReadWrite`). Company library prefers **`Sites.ReadWrite.All`** (or `Sites.Selected`) — see above.
- **Upload max 4 MB** via the portal (Graph simple upload).
- **In-portal open** — `POST …/preview` (Graph) loads a short-lived embed URL in a portal modal iframe; if Graph preview fails for Office types, fall back to Office Online `action=embedview` on the item’s `webUrl` (still inside the portal shell). Raw download URLs are not returned to the UI (`download` action → 403).
- **No portal downloads** — files stay in-system; collaboration uses org-only invite / org link share flows.
- **External OneDrive deep-links** are avoided. Shared-folder browse stays in-portal via `/drives/{driveId}/items/...` when Graph returns drive + remote item ids; if those ids are missing, the UI shows an error instead of opening a new tab.
- **Sharing defaults to organization-only** links or email invite with sign-in required. Anonymous public links are rejected by the edge function.
- **Admin consent** + user **Reconnect** required after adding `Files.ReadWrite` (and again after adding Sites scopes for company vault).
- **Preview support (typical):** Office (Word/Excel/PowerPoint), PDF, common images, and other Graph previewable types. Archives / binaries / some niche types show an in-portal “unavailable” message with share guidance (no download link).
- **Salesforce:** Copy/upload button is a stub until Connected App secrets land — `SETUP_SALESFORCE_RESUMES.md`.

---


## Outlook Mail limits (v1)

- **Not a full Outlook client** — no inbox rules, PST export, or full calendar-from-mail.
- Folders: Inbox, Sent, Drafts, Archive, Deleted (well-known). Custom folder trees are out of scope for v1.
- Read / compose / reply / reply-all / forward in-portal. Soft “open in Outlook” is omitted; stay in the portal.
- **From aliases:** Compose UI loads `GET /me?$select=mail,userPrincipalName,proxyAddresses` (`User.Read`) and offers primary + SMTP aliases as **From**. Graph `sendMail` / reply / forward set `message.from` for the chosen alias. **Reply-To is not overridden** (replies stay on the From / mailbox). Own aliases need **no** `Mail.Send.Shared` or Exchange Send As. Sending as a *different* mailbox requires Exchange **Send As** + Graph **`Mail.Send.Shared`** (not enabled by default).
- **Send attachments:** multi-file picker on compose / reply / forward. New mail uses Graph `sendMail` with `fileAttachment`s; reply/forward with files uses `createReply` / `createReplyAll` / `createForward` → add attachments → send. Limits (portal + Graph simple attachment): **3 MB per file**, **20 MB total**, **10 files**. Clear errors when over. Audit logs `attachment_count` only (never file contents).
- **Receive attachments:** listed on opened messages; **in-portal preview** for images / PDF / text. **Save to Downloads** or **Save to company Resumes** (OneDrive/SharePoint vault — not local disk). Resume-like filenames prefer Company Resumes when that vault is available.
- **Inline images:** HTML bodies with `cid:` references are rewritten to data URLs when Graph provides inline `fileAttachment` bytes.
- Outbound: addresses outside `@tagevc.com` (plus the connected mailbox domain and alias domains) require an explicit confirm.
- **Outlook Settings** (`/sales/mail` → **Outlook Settings**):
  - **Portal email signature** stored on `sales_users` and appended when sending from portal Mail. Graph has **no** compose-signature API; Outlook desktop/mobile signatures stay separate.
  - **Automatic replies (OOO)** via Graph `mailboxSettings.automaticRepliesSetting` (requires `MailboxSettings.ReadWrite`).
  - **Timezone / language** shown read-only from `mailboxSettings`.
- **Admin consent** + user **Reconnect** required after adding `Mail.ReadWrite` / `Mail.Send` / `MailboxSettings.ReadWrite`.
- Soft-refresh polling only (Graph change notifications later).

## Desktop notifications (v1)

- Uses the **Browser Notification API** (no service worker required).
- **Calendar / To Do / Planner:** portal-wide while any portal tab is open (background poll ~60s).
- **Teams chat:** while **any** portal page is open (header-level poll ~30s + Chat page soft-refresh). Alerts for new incoming messages you did not send; first poll after enable seeds IDs so there is no backlog dump.
- **Mail:** while **any** portal page is open (header-level poll ~45s). Alerts for new unread Inbox messages; first poll seeds IDs so there is no backlog dump.
- Enable via **Enable desktop alerts** on Calendar (Settings) or Chat (Settings). Same browser permission.
- Permission grant/deny and each fired alert are written to **`audit_events`** (`notification_permission`, `notification_sent`). Josh’s rows remain `actor_protected` (only Josh can read them).
- Clicking a chat alert focuses the tab and opens `/sales/chat?chat=…`.
- Clicking a mail alert focuses the tab and opens `/sales/mail?msg=…`.

---

## Audit logging

Related activity is logged to `audit_events` (migrations 0010/0011). Everyone including Josh is recorded; Josh’s rows stay private via `actor_protected`.

| Event type | When |
|------------|------|
| `calendar_connect` | OAuth connect success |
| `calendar_disconnect` | Disconnect |
| `calendar_view` | UI fetch of events (not silent alert polls) |
| `meeting_create` | New Meeting |
| `people_search` | Attendee type-ahead query |
| `location_suggest` | Location suggestion query |
| `todo_create` / `todo_complete` | To Do mutations |
| `planner_view` / `planner_create` / `planner_complete` | Planner |
| `chat_list` | Teams conversation list (not silent polls) |
| `chat_open` | Open / load a chat thread |
| `chat_send` | Send a Teams message (chat id + truncated preview) |
| `chat_create` | Start 1:1 or group chat |
| `chat_hide` | Remove chat from list (Graph hideForUser) |
| `chat_search` | Conversation list filter or in-thread keyword find |
| `chat_hide` | Soft-hide / remove chat from signed-in user’s list |
| `online_meeting_create` | Teams online meeting created (Chat / API) |
| `online_meeting_list` | Upcoming Teams meetings listed |
| `files_browse` | List My Drive / Downloads / Company / Shared with me |
| `files_open` | In-portal preview / open a drive item |
| `files_download` | Legacy only — portal download action is disabled (403) |
| `files_upload` | Upload file (≤4 MB) |
| `files_save_downloads` / `files_save_company_resumes` | Upload into vault destinations |
| `files_vault_ensure` | Created/verified Tage Portal/Downloads (+ company Resumes when configured) |
| `files_salesforce_copy_stub` | Salesforce copy button (not wired) |
| `files_mkdir` | Create folder |
| `files_rename` | Rename item |
| `files_delete` | Delete item |
| `files_share` | Org link or invite-by-email |
| `mail_attachment_view` | In-portal attachment preview |
| `mail_save_downloads` / `mail_save_company_resumes` | Attachment saved into vault |
| `sf_resume_sync` | Recruit 619 resume sync job (scaffold) |
| `mail_search` | `$search` mailbox query |
| `mail_move` | Archive / move |
| `mail_delete` | Delete message |
| `mail_send` | Send / reply / forward (`attachment_count` when files attached; contents never logged) |
| `mail_open` | Open / read a message |
| `mail_list` | List folder messages (not silent polls) |
| `mail_folders` | List well-known mail folders |
| `notification_permission` | Browser permission prompt result |
| `notification_sent` | Desktop alert fired (deduped per session) |

---

## Feature matrix

| Feature | Status |
|---------|--------|
| List upcoming / range events | Yes |
| Agenda (default) / week / month | Yes |
| Per-user default view preference | Yes (`sales_users.calendar_default_view`) |
| Open event in Outlook on the web | Yes (`webLink`) |
| **New Meeting** (+ optional Teams link) | Yes (calendar event `isOnlineMeeting`) |
| **Start / schedule Teams video** | Yes (`/sales/chat`, `OnlineMeetings.ReadWrite`) |
| Attendee people/contacts type-ahead | Yes (`People.Read` + `Contacts.Read`; users must Reconnect) |
| Resolve org user for chat create | Yes (`User.ReadBasic.All` + people soft-fallback; **Reconnect** after consent) |
| Location suggestions (recent events) | Yes (uses calendar scopes) |
| Room finder | Optional (`Place.Read.All` + admin consent) |
| Microsoft To Do list / create / complete | Yes |
| Planner list plans / create / complete | Yes (needs existing plans) |
| **Teams 1:1 + group chat** | Yes (`/sales/chat`, `Chat.ReadWrite` + `ChatMessage.Send`) |
| Remove chat from list | Yes (`hideForUser` — soft-hide for signed-in user; not admin hard-delete) |
| Filter chats / find in thread | Yes (client-side; loaded messages ≤ ~50) |
| **OneDrive Files** | Yes (`/sales/files`, `Files.ReadWrite` — personal drive) |
| **Outlook Mail** | Yes (`/sales/mail`, `Mail.ReadWrite` + `Mail.Send`) |
| **Outlook Settings** | Yes (portal signature on `sales_users`; OOO + timezone via `MailboxSettings.ReadWrite`) |
| Desktop alerts (Mail, portal-wide) | Yes (Inbox unread; open tab + Notification permission) |
| Desktop alerts (portal-wide while tab open) | Yes (meetings + To Do / Planner) |
| Desktop alerts (Teams chat, portal-wide) | Yes (open tab + Notification permission; no push when closed) |
| Edit / delete events | Not in v1 |
| Shared / subscribed / secondary calendars | Yes — Graph lists `/me/calendars` (+ calendar groups); portal overlays with checkboxes |
| Personal / Google calendar (ICS) | Yes — paste Google **secret ICS URL** in Calendar settings (Outlook “Add personal calendars” is OWA-only and **not** in Graph) |
| Teams channels / full client | Not in v1 |
| SharePoint site libraries | Not in v1 — optional `Sites.Read.All` later |
| Full OneDrive sync client | Not in v1 |
| Full Outlook client / rules / PST | Not in v1 |
| Mail attachment download | Disabled (in-portal preview only) |
| Anonymous public file links | Disabled (org-only / invite) |
| Service worker / push when tab closed | Not in v1 |

---

## Security notes

- Refresh and access tokens live in `microsoft_calendar_connections` and are **never** selected by the browser client (no RLS policies for anon/authenticated on that table; edge uses service role).
- Tokens are encrypted with `MS_TOKEN_ENCRYPTION_KEY` when set.
- OAuth `state` rows expire in 15 minutes.
- Disconnect deletes the connection row (and pending OAuth states) for that user.
- Audit inserts for Graph actions use the service-role `insert_audit_event` helper so `actor_protected` is set correctly for Josh.
