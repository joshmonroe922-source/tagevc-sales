# Tage VC — Multi-portal ops app

Internal **Tage Venture Capital** portals: **Deal Sourcing** (pipeline, follow-ups, nurture), **Due Diligence**, **New Start Up** / **New Mergers & Acquisitions** onboarding, **Manage Portfolio** (Entity Ops), **Legal** (shared compliance), **Human Resources** (employees / onboarding / offboarding / HR compliance), **Reporting**, **Marketing** (blog/social), plus stub shells for Executive, Accounting, and Technology.  
Single-admin ready (Josh Monroe); schema supports multi-rep later. **No HubSpot.**

Companion public site: [`tagevc-website`](../tagevc-website) (Next.js) — Launch / Partner / Exit landings + blog synced from published posts. Eventual domain: **tageventurecapital.com**.

Stack: **Vite + React + TypeScript**, **Supabase** (Auth / Postgres / Storage / Edge Functions), **Resend**, deployable to **Vercel**.

**Git:** keep this repo **private** on GitHub (ops + deal data tooling).

## Quick start (local)

See **[DEV_WORKFLOW.md](./DEV_WORKFLOW.md)** for local sandbox, staging previews, batch deploy rules, and Supabase migration order.

```bash
cd /Users/joshmonroe/Projects/tagevc-sales
cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open [http://localhost:5173/sales](http://localhost:5173/sales) (portal picker) after sign-in. Open **Deal Sourcing** for pipeline tools, or go direct when assigned (e.g. [Deal flow](http://localhost:5173/sales/deal-sourcing/leads), [Entity Ops](http://localhost:5173/sales/ops)). Legacy `/sales/leads`, `/sales/tasks`, and `/sales/automation` redirect into Deal Sourcing.

Production host: **`https://portal.tagevc.com`** (Vercel custom domain + DNS).

## Entity Ops

Internal module for portfolio entities Josh launches or acquires — **not** on the public website.

| Route | Purpose |
|-------|---------|
| `/sales/ops` | Hub: portfolio companies (sales & operations) |
| `/sales/ops/entities/new` | Create entity; clone start-business or acquire-business checklist |
| `/sales/ops/entities/:id` | Checklist (filter by phase), folders/docs |
| `/sales/legal` | Legal shared services — cross-entity compliance (licenses & filings) |

### Migration

In Supabase **SQL Editor**, after `0001`–`0003`, run:

- `supabase/migrations/0004_entity_ops.sql`

Seeds:

- Checklist templates: **Start a business**, **Acquire a business**
- Default folders: Articles, Licenses, Tax, Contracts, Diligence, Banking, Insurance, IP, HR, Other
- RLS: active `sales_users` can CRUD all ops tables

### Storage bucket (`entity-docs`)

Document **uploads** need a private Supabase Storage bucket. Until it exists, the UI stays usable: link documents by URL and shows a clear empty/config message on upload failure.

1. Dashboard → **Storage** → **New bucket**
2. Name: `entity-docs` · **Private**
3. Run the storage policies commented at the top of `0004_entity_ops.sql` (active sales users read/upload/update/delete)

### Portfolio disclosure (website later)

Decision locked: **full disclosure, real names** on the public site when that surface ships. Entity Ops itself is operator-only.

## What Josh must do (Supabase + Resend)

The app is fully scaffolded. You still need cloud credentials:

### 1. Create a Supabase project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard) → **New project** (e.g. `tagevc-sales`).
2. Copy **Project URL** and **anon public** key → `.env.local` (and website `.env.local`).
3. In **SQL Editor**, run in order:
   - `supabase/migrations/0001_sales_platform.sql` — deals (`sales_leads`), tasks, drips, activity, RLS, Josh admin seed
   - `supabase/migrations/0002_content_social.sql` — blog, social, content activity, SEO seed posts
   - `supabase/migrations/0003_blog_public_read.sql` — **anon SELECT** on published `blog_posts` (required for the public website)
   - `supabase/migrations/0004_entity_ops.sql` — Entity Ops tables, templates, default folders, RLS
   - `supabase/migrations/0007_portals.sql` — portal catalog, user assignments, admin full-access seed
   - `supabase/migrations/0008_new_start_acquire_portals.sql` — New Start Up + New Mergers & Acquisitions
   - `supabase/migrations/0013_due_diligence_and_ma_rename.sql` — Due Diligence portal + M&A display rename

### 2. Create Josh’s Auth user

1. **Authentication → Users → Add user**  
   - Email: `josh@tagevc.com` or `joshmonroe@tagevc.com` (must match `sales_users` allowlist)  
   - Set a password (or use magic link later)
2. Confirm the migration inserted:

```sql
select email, role, active from sales_users;
-- josh@tagevc.com | admin | true
-- joshmonroe@tagevc.com | admin | true
-- house@tagevc.com | rep | true (house account)
```

### 3. Deploy Edge Functions

```bash
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
supabase functions deploy intake-lead
supabase functions deploy process-drips
supabase functions deploy update-lead
supabase functions deploy generate-content
supabase functions deploy process-scheduled-content
```

### 4. Set function secrets

In Dashboard → **Edge Functions → Secrets** (or CLI):

| Secret | Purpose |
|--------|---------|
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM_EMAIL` | e.g. `Tage Venture Capital <hello@tagevc.com>` (use `onboarding@resend.dev` for testing) |
| `INTAKE_ALERT_EMAIL` | Inbox for new-lead alerts (default `hello@tagevc.com`) |
| `SALES_PORTAL_URL` | Production: `https://portal.tagevc.com` (or Vercel preview URL for testing) |
| `DRIP_CRON_SECRET` | Long random string — auth for `process-drips` cron |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret (`whsec_…`) for open/click analytics — see **`SETUP_EMAIL.md`** |
| `CONTENT_CRON_SECRET` | Long random string — auth for `process-scheduled-content` cron |
| `DIGEST_CRON_SECRET` | Long random string — auth for `process-morning-digest` cron (see **`SETUP_MORNING_DIGEST.md`**) |
| `XAI_API_KEY` | Grok — Think Tank + morning digest win-the-day note |
| `OPENAI_API_KEY` | Optional — AI blog/social generation (template fallback if unset) |
| `OPENAI_MODEL` | Optional — default `gpt-4o-mini` |
| `MS_GRAPH_*` | Microsoft 365 calendar OAuth — see **`SETUP_CALENDAR.md`** |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### 5. Resend

1. Create account at [resend.com](https://resend.com).
2. For production, verify `tagevc.com` (or your sending domain) and use `hello@tagevc.com`. See **`SETUP_EMAIL.md`**.
3. Until then, Resend only delivers to your own signup email.
4. For open/click analytics: enable domain open + click tracking, add the `resend-webhook` endpoint, set `RESEND_WEBHOOK_SECRET`. View at `/sales/admin/email`.

### 6. Schedule cron jobs

**Founder nurture (drips)** — every 30 minutes:

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/process-drips" \
  -H "x-drip-secret: $DRIP_CRON_SECRET"
```

**Content scheduler** (blog publish + social mock/live publish) — every 15–30 minutes:

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/process-scheduled-content" \
  -H "x-content-secret: $CONTENT_CRON_SECRET"
```

Use Supabase scheduled functions, GitHub Actions, or any cron. Admins can also click **Run due drips now** / **Run scheduler** in the portal.

**Morning digest** (Today briefing + Grok win-the-day) — every **15 minutes** (sends only when local time is ~6:00–6:14):

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/process-morning-digest" \
  -H "x-digest-secret: $DIGEST_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

See **`SETUP_MORNING_DIGEST.md`** for timezone logic, opt-out, and sandbox test commands.

### 7. Auth redirect URLs

Supabase → **Authentication → URL Configuration**:

- **Site URL:** portal origin — local `http://localhost:5173` or production `https://portal.tagevc.com`
- **Redirect URLs** (add all that apply):
  - `http://localhost:5173/**`
  - `http://localhost:5173/sales/reset-password` (password reset)
  - `http://localhost:5173/sales` (magic link → portal picker)
  - `https://portal.tagevc.com/**`
  - `https://portal.tagevc.com/sales/reset-password`
  - `https://portal.tagevc.com/sales`

Password reset uses `resetPasswordForEmail` → email link → `/sales/reset-password` → `updateUser({ password })`.

### 8. Auth email delivery (password reset / magic link)

**Auth emails** (password reset, magic link, confirmations) are separate from Edge Function mail (`RESEND_API_KEY` secrets). Auth uses **custom SMTP** on the Supabase project.

**Configured for `tagevc-sales` (`hqmobgtnedmhzipusert`):**

| Setting | Value |
|--|--|
| Provider | Resend SMTP |
| Host | `smtp.resend.com` |
| Port | `465` (SSL) |
| Username | `resend` |
| Password | Same Resend API key as `RESEND_API_KEY` (Auth SMTP password field — **not** readable via `supabase secrets list`) |
| Sender | `Tage Venture Capital <hello@tagevc.com>` |

Subject lines for recovery / confirmation / magic link mention **Tage Venture Capital**.

**Dashboard path** (re-check or rotate the key):

1. [Supabase Dashboard](https://supabase.com/dashboard/project/hqmobgtnedmhzipusert) → **Authentication** → **Emails** → **SMTP Settings**
   (also under **Project Settings → Authentication → SMTP** on some UI versions)
2. Enable custom SMTP; paste the Resend API key as the SMTP password; keep From email `hello@tagevc.com` / name `Tage Venture Capital`.

**Verify:** Login → Forgot password → confirm the message From is `hello@tagevc.com` (not `supabase.co`).

Edge Function alerts still use Resend HTTP + secrets (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) — see **`SETUP_EMAIL.md`**. Those do **not** replace Auth SMTP.

## Env vars (frontend)

See `.env.example`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_RINGCENTRAL_CLIENT_ID=   # optional — softphone/SMS; see SETUP_RINGCENTRAL.md
```

Never commit `.env.local` or service-role keys.

## Features

| Area | Behavior |
|------|----------|
| **Deal flow** | UI maps `sales_leads` → deals. Stages: New → Qualified → Call Booked → Diligence → Term Sheet → Closed Won / Lost / Passed. Pipeline + list. Theses: **Launch / Partner / Exit**. |
| **Deal detail** | Edit fields, stage moves (`update-lead`), notes, follow-ups, activity. |
| **Entity Ops** | Portfolio entities: start/acquire checklists, folders, docs (Storage or URL). Optional link to a deal. Compliance lives under **Legal**. |
| **Follow-ups** | Per-deal + standalone; due dates; complete/incomplete. |
| **Founder nurture** | `new-lead-nurture`: Day 0 internal reminder, Day 2 follow-up task, Day 7 nurture reminder. Enrollment on website intake. |
| **Deal flow reports** | Counts by stage/thesis, win rate, charts, recent deals. |
| **Content hub** | AI/template generate blog + social drafts; activity feed. |
| **Blog** | SEO posts with schedule/publish; seeds in `content/seeds/*.md` + migration. Public site reads published rows (RLS). |
| **Social** | Compose · Calendar · Queue · **Approvals** · Drafts · Published. Mock publish until OAuth phase 2. |
| **Auth** | Supabase email/password, magic link, or forgot-password reset; allowlist via `sales_users`. |

## Content & Social → public website

1. Publish a post in **Content → Blog** (or seed via migration).
2. With `0003_blog_public_read.sql` applied, `tagevc-website` fetches `blog_posts` where `status = published`.
3. Fallback: website can render markdown from `content/seeds` if Supabase is unset.
4. Social posts promote the same theses; approval queue gates publish when you submit for approval.

## OAuth phase 2 (live social publish)

Until connected, `process-scheduled-content` **mock-publishes** (marks published, stores placeholder URLs). To go live later, set secrets and wire adapters:

| Secret | Platform |
|--------|----------|
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X (Twitter) |
| `META_APP_ID` / `META_APP_SECRET` | Facebook / Instagram |

Store per-account tokens in a future `social_connections` table (not required for v1 mock mode).

## Website intake API

**Endpoint:** `POST https://<PROJECT_REF>.supabase.co/functions/v1/intake-lead`

**CORS:** `tagevc.com`, `tageglobal.com` (+ www), localhost for dev.

**Headers:**

```
Content-Type: application/json
Authorization: Bearer <SUPABASE_ANON_KEY>
apikey: <SUPABASE_ANON_KEY>
```

**Body:**

```json
{
  "name": "Jane Founder",
  "email": "jane@startup.com",
  "phone": "+1…",
  "company": "Startup Inc",
  "deal_path": "launch",
  "source": "website_form",
  "notes": "Interested in Launch path",
  "enroll_drip": true
}
```

- `deal_path`: `launch` | `partner` | `exit`
- `source`: `website_form` | `manual` | `referral`
- Creates a deal in **New**, assigns via round-robin, emails Josh, enrolls nurture unless `enroll_drip: false`.

### Next.js marketing site (`tagevc-website`)

Contact forms POST to `intake-lead` (see website README). Blog pages read published posts with the anon key after migration `0003`.

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel project env, then redeploy. Point DNS **`portal.tagevc.com`** at the Vercel deployment (custom domain), then add `https://portal.tagevc.com` to Supabase Auth Site URL / Redirect URLs and ensure intake CORS includes it (already listed in `_shared/cors.ts`).

**RingCentral (softphone + SMS):** after creating a Developer Console app, set `VITE_RINGCENTRAL_CLIENT_ID` on Vercel and redeploy. Register redirect URI `https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/redirect.html`. Full steps: **`SETUP_RINGCENTRAL.md`**. Until the client ID is set, Call/SMS stay disabled with a soft “not configured” hint.

`vercel.json` rewrites SPA routes to `index.html`.

## Project layout

```
src/                      Multi-portal UI (/sales/*; Deal Sourcing under /sales/deal-sourcing/*)
content/seeds/            Markdown export of SEO blog seeds
supabase/migrations       0001 sales · … · 0016 calendar prefs / tasks
supabase/functions        intake-lead, process-drips, update-lead,
                          generate-content, process-scheduled-content,
                          microsoft-calendar-* · microsoft-todo · microsoft-planner · microsoft-chat
```

## Multi-portal access

After login, `/sales` shows a **portal picker**. Users only see portals assigned in `sales_user_portals`. **Admins always get every portal** (UI + `user_has_portal()`), and migration `0007` seeds all active admins onto all portals.

**Calendar** (`/sales/calendar`), **To Do** (`/sales/todo`), **Planner** (`/sales/planner`), **Teams chat** (`/sales/chat`), **Files** (`/sales/files`), and **Mail** (`/sales/mail`) are **global tools** for every authenticated portal user (Outlook meetings, To Do, Planner, Teams chat, OneDrive, and Outlook mailbox via Graph). See **`SETUP_CALENDAR.md`**. Desktop alerts (Browser Notification API) cover meeting/task reminders, incoming Teams chat, and new Inbox mail portal-wide while a portal tab stays open.

| Portal | Live routes | Notes |
|--------|-------------|--------|
| Deal Sourcing | `/sales/deal-sourcing/leads`, `/tasks`, `/automation` | Former sales platform (pipeline + nurture). Old `/sales/leads` etc. redirect here. |
| Due Diligence | `/sales/due-diligence` | Diligence workspace placeholder (checklist outline). |
| New Start Up | `/sales/new-start-up` | Onboarding → Entity Ops `start-business` template. |
| New Mergers & Acquisitions | `/sales/new-acquisition` | Onboarding → Entity Ops `acquire-business` (slug kept for URLs). |
| Manage Portfolio | `/sales/ops/*` | Entity Ops |
| Reporting | `/sales/reports` | Deal-flow metrics |
| Marketing | `/sales/content/*` | Blog + social |
| Legal | `/sales/legal` | Cross-entity compliance |
| Human Resources | `/sales/hr/*` | Employees, onboarding/offboarding, HR compliance (see `SETUP_HR.md`) |
| Executive / Accounting / Technology | `/sales/portals/:slug` | Stub shells |
| *(global)* Calendar | `/sales/calendar` | Outlook meetings (per-user OAuth; New Meeting + Teams link) |
| *(global)* To Do | `/sales/todo` | Microsoft To Do (`/sales/to-do` redirects here) |
| *(global)* Planner | `/sales/planner` | Microsoft Planner |
| *(global)* Chat | `/sales/chat` | Teams 1:1 / group chat + Start/schedule video (`OnlineMeetings.ReadWrite`; Reconnect after Azure consent) |
| *(global)* Files | `/sales/files` | OneDrive browse / preview / share (same OAuth; downloads disabled; needs `Files.ReadWrite` + Reconnect) |
| *(global)* Mail | `/sales/mail` | Outlook inbox / compose / reply; **Outlook Settings** (portal signature + OOO). Needs `Mail.ReadWrite` + `Mail.Send` + `MailboxSettings.ReadWrite` + Reconnect |

Assign portals: `/sales/admin/portals` (admin only). Production host: **`portal.tagevc.com`**.

## Multi-rep later

- Add rows to `sales_users` (`role`: `rep` | `manager` | `admin`).
- Round-robin already prefers active non-house reps.
- Tighten RLS from “all sales users see all” to assignment-scoped policies when you hire.

## Scripts

| Command | |
|---------|--|
| `npm run dev` | Local Vite |
| `npm run build` | Production build |
| `npm run preview` | Preview build |

## Blockers / notes

- Supabase project + Resend keys **cannot** be created from this repo without your dashboard login — scaffold is complete; paste keys into `.env.local`.
- Until Resend domain is verified, alert emails may only reach your Resend account email.
- Drip + content crons must be scheduled externally (or use in-app run buttons).
- Live social OAuth is **phase 2**; mock mode is intentional for v1.
