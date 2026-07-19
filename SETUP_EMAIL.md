# Tage VC — Resend email setup (intake alerts)

Same pattern as Instant NDA: the **website form** POSTs to the `intake-lead` edge function; that function creates a deal in Supabase and emails you via **Resend**.

You do **not** need a brand-new Resend company account if Instant NDA’s Resend login can add another domain. You **do** need:

1. Resend able to send **from** `hello@tagevc.com` (domain verified)
2. Those secrets on the **Tage VC Supabase project** (not Instant NDA’s project)
3. Website env vars so the form can reach `intake-lead`

---

## Why the contact form errors today

The form needs these on the **website** (local `.env.local` and Vercel):

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_SITE_URL=https://tageventurecapital.com
```

If either Supabase public var is missing, the UI shows:
**“Intake is not configured…”** — that is env, not Resend.

Copy URL + anon key from Supabase → **Project Settings → API**.

---

## 1. Resend account & domain (`hello@tagevc.com`)

### Account choice

| Option | When to use |
|--------|-------------|
| **Reuse Instant NDA’s Resend account** | Simplest — one login, add `tagevc.com` as a second domain |
| **New Resend account for Tage VC** | If you want billing/API keys fully separated |

Either works. The API key must end up in **Tage VC’s** Supabase secrets.

### Verify sending domain

1. Go to [https://resend.com/domains](https://resend.com/domains) → **Add Domain** → `tagevc.com`  
   (or `tageventurecapital.com` if you prefer that as the From domain).
2. Add the DNS records Resend shows (TXT/CNAME). Do **not** remove existing MX for inbox mail unless Resend explicitly tells you to.
3. Wait until status is **Verified**.
4. You can then send as `Tage Venture Capital <hello@tagevc.com>`.

### Quick test without domain (temporary)

Until DNS is verified, you can use:

```
RESEND_FROM_EMAIL=Tage Venture Capital <onboarding@resend.dev>
```

Resend’s test sender only delivers to **the email you used to sign up for Resend**. Fine for smoke tests; not for production.

---

## 2. Supabase Edge Function secrets

In the **Tage VC** Supabase project → **Project Settings → Edge Functions → Secrets**:

| Secret | Value |
|--------|--------|
| `RESEND_API_KEY` | `re_…` from Resend → API Keys |
| `RESEND_FROM_EMAIL` | `Tage Venture Capital <hello@tagevc.com>` |
| `INTAKE_ALERT_EMAIL` | Inbox that should **receive** new-lead alerts — `hello@tagevc.com` if that mailbox exists / forwards to you, otherwise your personal email |
| `SALES_PORTAL_URL` | Production portal: `https://portal.tagevc.com` (link in alert emails) |

Also ensure `intake-lead` is **deployed** for this project.

```bash
# once Supabase CLI is installed and logged in
cd /Users/joshmonroe/Projects/tagevc-sales
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set \
  RESEND_API_KEY="re_..." \
  RESEND_FROM_EMAIL="Tage Venture Capital <hello@tagevc.com>" \
  INTAKE_ALERT_EMAIL="hello@tagevc.com" \
  SALES_PORTAL_URL="https://portal.tagevc.com"
supabase functions deploy intake-lead
```

Optional DB override (same effect as `INTAKE_ALERT_EMAIL`):

```sql
update public.sales_settings
set intake_alert_email = 'hello@tagevc.com'
where id = '00000000-0000-4000-8000-000000000001';
```

---

## 3. Website env (form → intake)

**Local** — `/Users/joshmonroe/Projects/tagevc-website/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Vercel** (website project) — same three vars; production `NEXT_PUBLIC_SITE_URL=https://tageventurecapital.com`. Redeploy after saving.

CORS for `intake-lead` already allows `tageventurecapital.com`, `tagevc.com`, and localhost.

---

## 4. Smoke test

1. Open `/contact` on the site.
2. Submit a test lead with your own email.
3. Expect:
   - Success message on the form
   - Row in `sales_leads` (portal Deal flow)
   - Alert email to `INTAKE_ALERT_EMAIL` from `hello@tagevc.com` (or test sender)

If the lead is created but no email arrives: check Supabase function logs for `Resend error:` and confirm domain verification + `RESEND_FROM_EMAIL`.

---

## Instant NDA vs Tage VC (mental model)

| | Instant NDA | Tage VC |
|--|-------------|---------|
| Product email | NDA PDFs to parties | New-lead alerts to you |
| From address | e.g. `notifications@instantnda.us` | `hello@tagevc.com` |
| Where secrets live | Instant NDA Supabase project | **Tage VC** Supabase project |
| Trigger | Sign / finalize functions | Website → `intake-lead` |

---

## Auth SMTP (password reset / magic link)

Intake alerts use Resend **HTTP** via Edge Function secrets. **Supabase Auth** emails need **custom SMTP** (same Resend account/domain):

- Host `smtp.resend.com`, port `465`, user `resend`, password = Resend API key
- From: `Tage Venture Capital <hello@tagevc.com>`
- Dashboard: project **Authentication → Emails → SMTP Settings**

See README §8. Do not commit the API key.

---

## Email analytics (opens / clicks)

**Deal tracked email** (Send tracked email on a lead) sends via **Microsoft Graph** from the user’s connected mailbox, saves to **Sent Items**, and records opens/clicks with a portal tracking pixel + link redirects (`mail-tracking` edge function). Replies land in Outlook and appear in the deal mail thread.

**Resend** analytics still applies to intake alerts, drips, and auth SMTP — those use Resend webhooks.

### Deal tracked email (Graph)

1. User must **connect Microsoft** with `Mail.ReadWrite` + `Mail.Send` (see `SETUP_CALENDAR.md`). After scope changes: admin consent + **Reconnect**.
2. Deploy migration `0039_mail_graph_tracking.sql` and functions `send-tracked-email`, `mail-tracking`.
3. No Resend setup required for deal tracked sends.

### Resend webhooks (intake / drips / auth)

### What Josh configures in Resend (dashboard)

1. **Domain tracking** — [Resend → Domains](https://resend.com/domains) → your sending domain → enable **Open tracking** and **Click tracking**. Add the tracking CNAME Resend shows (e.g. `links.…`) and verify. Without this, webhooks for opens/clicks will not fire.
2. **Webhook** — [Resend → Webhooks](https://resend.com/webhooks) → Add webhook:
   - Endpoint: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/resend-webhook`
   - Events (at least): `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`
3. Copy the webhook **signing secret** (`whsec_…`) into Supabase Edge secrets as `RESEND_WEBHOOK_SECRET`.
4. Deploy functions + migration:

```bash
supabase db push   # includes 0012 + 0039_mail_graph_tracking.sql
supabase functions deploy mail-tracking send-tracked-email resend-webhook intake-lead process-drips
supabase secrets set RESEND_WEBHOOK_SECRET="whsec_..."
```

### Where to view analytics

- Admin UI: **`/sales/admin/email`** (Email in admin nav)
- Per lead: Deal Sourcing → lead → **Send tracked email** panel (open/click counts)

### Limits (honest)

| Capability | Supported? |
|------------|------------|
| Who opened / how many times | Yes (pixel; image blockers under-count; some clients prefetch and over-count) |
| Link clicks | Yes (Resend rewrites `https://` links when click tracking is on) |
| True “forwarded to someone else” | **No** — industry-wide. Extra opens *might* mean a forwarder’s client loaded images, but you cannot prove it |
| Attachment opened | **No** — Resend does not report attachment opens |
| Outlook / M365 compose (untracked) | **Not tracked** — use **Send tracked email** on the lead for Graph + analytics |
| Deal tracked email (portal) | **Yes** — Graph send from your mailbox + portal pixel/link tracking |

### Microsoft 365 / Outlook

**Send tracked email** on a deal sends as your connected `@tagevc.com` (or work) address via Graph. Replies go to your Outlook inbox and sync into the deal mail panel.

Untracked mail composed directly in Outlook does not get open/click analytics.

Auth password-reset / magic-link emails use Resend SMTP; if the same domain has tracking + webhooks enabled, delivery/open events may appear as `webhook` source rows when the send was not recorded by an edge function.

