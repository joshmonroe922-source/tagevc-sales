# Morning digest (6:00 AM Today briefing)

Every active portal user with **Morning digest** enabled (default **on**) receives an email around **6:00 AM in their timezone**:

1. A **Today summary** — same sources as `/sales/today` (Outlook calendar, Teams online meetings, Master To Do due/overdue)
2. A short **win-the-day** note from their **personal AI assistant** (analysis by **Grok** / xAI)
3. Sent via **Resend** to their portal login email (`sales_users.email`)

---

## How scheduling works

| Piece | Detail |
|-------|--------|
| Edge function | `process-morning-digest` |
| Auth | Header `x-digest-secret: $DIGEST_CRON_SECRET` **or** admin/manager Bearer token |
| **Recommended scheduler** | **GitHub Actions** (`.github/workflows/morning-digest.yml`) |
| Recommended cadence | **Every 15 minutes** (covers the 6:00–6:14 local window) |
| Timezone filter | For each user, resolve IANA TZ → if local hour is **6** and minute **&lt; 15**, consider sending |
| Dedup | `sales_users.morning_digest_last_sent_on` stores local `YYYY-MM-DD`; one send per user per local day |
| Opt-out | `morning_digest_enabled = false` (Today → settings → Morning digest) |

Timezone resolution order (server):

1. `sales_users.timezone` (set when user picks a timezone in Today/Calendar settings)
2. Outlook `mailboxSettings.timeZone` (if Microsoft connected)
3. Default `America/Indiana/Indianapolis`

### Recommended: GitHub Actions

Workflow: [`.github/workflows/morning-digest.yml`](../.github/workflows/morning-digest.yml)

- **Schedule:** `*/15 * * * *` (every 15 minutes)
- **Manual test:** Actions → **Morning digest cron** → **Run workflow** (`workflow_dispatch`)
- **Auth:** GitHub repo secret `DIGEST_CRON_SECRET` must match the Supabase Edge Function secret of the same name

**One-time setup**

1. GitHub → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
2. Name: `DIGEST_CRON_SECRET`
3. Value: same string as Supabase Edge secret `DIGEST_CRON_SECRET` (Dashboard → Edge Functions → Secrets, or your synced `.env.local`)
4. Commit/push the workflow file (already in repo once merged), then smoke-test via **Run workflow**

The workflow POSTs with `DIGEST_CRON_SECRET` passed via `env:` (not inlined into the script). That matters when the secret contains shell metacharacters (`"`, `&`, `<`, etc.) — inlining `${{ secrets.DIGEST_CRON_SECRET }}` into the curl line causes bash exit code **2**.

Equivalent local curl:

```bash
curl -X POST "https://hqmobgtnedmhzipusert.supabase.co/functions/v1/process-morning-digest" \
  -H "x-digest-secret: $DIGEST_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

(Alternatives like Supabase Cron or cron-job.org work with the same curl shape, but **GitHub Actions is the recommended path** for this project.)

Run every **15 minutes**. Hourly also works but may miss users whose 6:00 window falls between hourly ticks depending on alignment — prefer 15 min.

---

## Secrets / env

Set as **Supabase Edge Function secrets** (not Vite):

| Secret | Required | Purpose |
|--------|----------|---------|
| `DIGEST_CRON_SECRET` | Yes for cron | Auth for scheduled POST |
| `RESEND_API_KEY` | Yes | Send digest email |
| `RESEND_FROM_EMAIL` | Recommended | e.g. `Tage Venture Capital <hello@tagevc.com>` |
| `XAI_API_KEY` | Recommended | Grok win-the-day note (fallback static note if missing) |
| `XAI_MODEL` | Optional | Default `grok-3-mini` |
| `PUBLIC_APP_URL` / `SITE_URL` / `SALES_PORTAL_URL` | Recommended | “Open Today” link |
| Microsoft Graph secrets | For rich Today content | Same as calendar (`MS_GRAPH_*`, `MS_TOKEN_ENCRYPTION_KEY`) |

Migration: `0043_morning_digest_prefs.sql`

```bash
# local / linked project
supabase db push   # or apply 0043 in SQL editor
supabase functions deploy process-morning-digest
```

---

## Local / sandbox test (no production deploy required)

1. Apply migration `0043` on your **sandbox** Supabase project.
2. Set secrets: `DIGEST_CRON_SECRET`, `RESEND_API_KEY`, `XAI_API_KEY`, Graph secrets as needed.
3. Deploy **only** the digest function to sandbox (or `supabase functions serve`).
4. Force a dry run for your user:

```bash
curl -X POST "http://127.0.0.1:54321/functions/v1/process-morning-digest" \
  -H "x-digest-secret: $DIGEST_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true,"force":true,"email":"you@tagevc.com"}'
```

5. Send a real test email (still force, bypasses 6 AM window):

```bash
curl -X POST "https://<SANDBOX_REF>.supabase.co/functions/v1/process-morning-digest" \
  -H "x-digest-secret: $DIGEST_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"force":true,"email":"you@tagevc.com"}'
```

| Body field | Effect |
|------------|--------|
| `dry_run: true` | Build summary + Grok note; **do not** send email |
| `force: true` | Ignore 6:00 window (and still mark sent day unless dry_run) |
| `email` | Limit to one portal login |

---

## Opt-out UI

**Today** → open settings (side panel) → **Morning digest** → uncheck “Email me a daily morning briefing”.

Timezone for the 6 AM window is the same control under **Time zone** (persisted to `sales_users.timezone`).

---

## Deploy readiness (when Josh says deploy)

1. Apply `0043_morning_digest_prefs.sql` on production.
2. Set `DIGEST_CRON_SECRET` on Supabase Edge **and** GitHub Actions secret `DIGEST_CRON_SECRET` (same value).
3. `supabase functions deploy process-morning-digest`
4. Confirm GitHub Actions workflow is on `main` (schedule `*/15 * * * *`).
5. Smoke-test: Actions → **Morning digest cron** → **Run workflow**, or curl with `force` + your email.
6. Do **not** rely on the schedule until secrets and migration are live.

**Batch 2 note:** implement and test on sandbox first; production deploy only when explicitly requested.
