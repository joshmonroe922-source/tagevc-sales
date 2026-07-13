# Tage VC — Microsoft 365 calendar setup

The portal calendar at **`/sales/calendar`** reads each user’s **personal Outlook / Microsoft 365 mailbox** via Microsoft Graph OAuth. It is available to **all authenticated portal users** (not a separate portal assignment).

Until Azure app registration + edge secrets are in place, the UI shows a clear “not configured” state. After secrets are set and functions are deployed, users click **Connect work calendar**.

---

## What Josh must do in Azure / Entra

### 1. App registration

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) → **Identity** → **Applications** → **App registrations** → **New registration**.
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

### 3. API permissions (delegated)

App → **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**:

| Permission | Required for v1 |
|------------|-----------------|
| `User.Read` | Yes (identify mailbox) |
| `Calendars.Read` | Yes (list events) |
| `offline_access` | Yes (refresh tokens) — usually granted via OAuth scope, not always listed the same way |
| `openid` | Yes (OIDC) |
| `Calendars.ReadWrite` | **No for v1** — add later if you want create/edit from the portal |

Click **Grant admin consent for Tage…** so users are not blocked by consent prompts (recommended for a company tenant).

### 4. Optional: Authentication extras

- Under **Authentication**, ensure the Web redirect URI above is listed.
- No SPA redirect is required; the browser hits the **edge callback**, which then redirects to the portal.

---

## Redirect URIs (checklist)

| Environment | Redirect URI |
|-------------|--------------|
| Production (Supabase edge callback) | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/microsoft-calendar-oauth-callback` |
| Portal after OAuth | Users land on `{SALES_PORTAL_URL}/sales/calendar` |
| Local portal | `http://localhost:5173/sales/calendar` — set `SALES_PORTAL_URL=http://localhost:5173` when testing locally |

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
  SALES_PORTAL_URL="https://tagevc-sales.vercel.app"
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
| `SALES_PORTAL_URL` | Where OAuth callback sends the browser (`/sales/calendar`) |
| `MS_GRAPH_SCOPES` | Optional override; default is `openid offline_access User.Read Calendars.Read` |

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
```

`microsoft-calendar-oauth-callback` has `verify_jwt = false` (browser redirect from Microsoft). All others require a portal session JWT.

---

## Database migration

Run `supabase/migrations/0014_microsoft_calendar.sql` (adds `sales_users.work_email`, connection + OAuth state tables, `set_my_work_email` RPC).

```bash
supabase db push
# or paste 0014 into the SQL Editor
```

---

## User flow

1. Sign into the portal (Supabase email/password — unchanged).
2. Open **Calendar** in the header (or `/sales/calendar`).
3. Optionally set **Work email** if portal login ≠ `@tagevc.com` mailbox.
4. Click **Connect work calendar** → Microsoft consent → return to the portal.
5. Month / week / agenda views load events from **that user’s** mailbox.

Admins (Josh) already have full portal access; calendar is global so every allowlisted user can connect their own mailbox.

---

## v1 limitations

| Feature | Status |
|---------|--------|
| List upcoming / range events | Yes |
| Month / week / agenda views | Yes |
| Open event in Outlook on the web | Yes (`webLink`) |
| Create events | **Not in v1** |
| Edit / delete events | **Not in v1** |
| Shared / room calendars | **Not in v1** — default calendar only |
| Teams meeting create | **Not in v1** |

To enable create/edit later: add `Calendars.ReadWrite`, expand scopes secret, and add write edge endpoints + UI.

---

## Security notes

- Refresh and access tokens live in `microsoft_calendar_connections` and are **never** selected by the browser client (no RLS policies for anon/authenticated on that table; edge uses service role).
- Tokens are encrypted with `MS_TOKEN_ENCRYPTION_KEY` when set.
- OAuth `state` rows expire in 15 minutes.
- Disconnect deletes the connection row (and pending OAuth states) for that user.
