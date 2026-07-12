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
| `SALES_PORTAL_URL` | Your deployed sales portal URL (link in the alert email) |

Also ensure `intake-lead` is **deployed** for this project.

```bash
# once Supabase CLI is installed and logged in
cd /Users/joshmonroe/Projects/tagevc-sales
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set \
  RESEND_API_KEY="re_..." \
  RESEND_FROM_EMAIL="Tage Venture Capital <hello@tagevc.com>" \
  INTAKE_ALERT_EMAIL="hello@tagevc.com" \
  SALES_PORTAL_URL="https://YOUR_SALES_PORTAL"
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
