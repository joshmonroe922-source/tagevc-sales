# Josh setup checklist — Tage VC deal sourcing + content

## Core Deal Sourcing / deal flow

1. [ ] Create Supabase project `tagevc-sales`
2. [ ] Run `supabase/migrations/0001_sales_platform.sql` in SQL Editor
3. [ ] Run `supabase/migrations/0002_content_social.sql` (blog + social + SEO seeds)
4. [ ] Run `supabase/migrations/0003_blog_public_read.sql` (anon read published posts → website)
5. [ ] Run `supabase/migrations/0004_entity_ops.sql` (Entity Ops tables + checklist seeds)
6. [ ] Run `supabase/migrations/0007_portals.sql` (portal catalog + assignments; seeds all admins on every portal)
6b. [ ] Run `0008_new_start_acquire_portals.sql`, then `0013_due_diligence_and_ma_rename.sql` (Due Diligence + New Mergers & Acquisitions display name; admins re-seeded)
7. [ ] Create private Storage bucket `entity-docs` + storage RLS policies (see top of `0004_entity_ops.sql`)
8. [ ] Create Auth user (`josh@tagevc.com` or `joshmonroe@tagevc.com`) and set password in Dashboard
9. [ ] Confirm `sales_users` has Josh as admin (admins always get all portals in the app)
10. [ ] Copy URL + anon key into `tagevc-sales/.env.local` and `tagevc-website/.env.local`
11. [ ] Deploy edge functions: `intake-lead`, `process-drips`, `update-lead`, `generate-content`, `process-scheduled-content`, `resend-webhook`, `send-tracked-email`
12. [x] Auth SMTP (password reset From `hello@tagevc.com`): Dashboard **Authentication → Emails → SMTP Settings** — Resend `smtp.resend.com:465`, user `resend`, password = same Resend API key (see README §8)
13. [ ] Set secrets (see `SETUP_EMAIL.md`):
       ```bash
       supabase secrets set \
         RESEND_API_KEY="re_..." \
         RESEND_FROM_EMAIL="Tage Venture Capital <hello@tagevc.com>" \
         INTAKE_ALERT_EMAIL="hello@tagevc.com" \
         SALES_PORTAL_URL="https://portal.tagevc.com" \
         DRIP_CRON_SECRET="..." \
         CONTENT_CRON_SECRET="..." \
         RESEND_WEBHOOK_SECRET="whsec_..."
       ```
14. [ ] Optional: `OPENAI_API_KEY` (+ `OPENAI_MODEL`) for AI content generation
15. [ ] Email analytics: apply `0012_email_analytics.sql`; enable Resend domain open/click tracking; webhook → `…/functions/v1/resend-webhook` (events in SETUP_EMAIL.md); confirm `/sales/admin/email`
16. [ ] Schedule cron POST to `process-drips` every 30 min (`x-drip-secret`)
17. [ ] Schedule cron POST to `process-scheduled-content` every 15–30 min (`x-content-secret`)
18. [ ] `npm run dev` → sign in → `/sales` portal picker → open Deal Sourcing / Manage Portfolio
19. [ ] Open **Manage Portfolio** → create entity from start/acquire template → check off items; open **Legal** to add compliance
20. [ ] Test intake with curl (see README)
21. [ ] Deploy portal to Vercel; set Vite env vars; attach custom domain **`portal.tagevc.com`**
22. [ ] Supabase Auth Site URL + Redirect URLs include `https://portal.tagevc.com` (and `/sales`, `/sales/reset-password`)
23. [ ] Ensure GitHub remotes for `tagevc-sales` and `tagevc-website` are **private**

## Content & Social

24. [ ] Confirm 5 seeded blog posts appear under Content → Blog
25. [ ] Publish / schedule a social draft; use Approvals tab if submitting for approval
26. [ ] Click **Run scheduler** once to verify mock publish path
27. [ ] Phase 2 (later): LinkedIn / X / Meta OAuth secrets for live publish

## Public website (`tagevc-website`)

28. [ ] `cd ../tagevc-website && cp .env.example .env.local` (same Supabase URL + anon key)
29. [ ] `npm install && npm run dev` → home, Launch/Partner/Exit, `/blog`, contact form
30. [ ] Confirm blog list loads from Supabase (or seed markdown fallback)
31. [ ] Submit contact form → deal appears in Deal flow + Josh alert email
32. [ ] Deploy website to Vercel; set `NEXT_PUBLIC_SUPABASE_*` + intake URL/key
33. [ ] Point `tageventurecapital.com` (eventual) at website; add origin to intake CORS if needed

## RingCentral softphone + SMS

34. [ ] Create RingCentral Developer app (SPA / PKCE) — see **`SETUP_RINGCENTRAL.md`**
35. [ ] Add OAuth redirect URI:
      `https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/redirect.html`
36. [ ] Set `VITE_RINGCENTRAL_CLIENT_ID` on Vercel (Production) and redeploy
37. [ ] Confirm Embeddable login + microphone on `https://portal.tagevc.com`
38. [ ] Confirm Contact / deal **Call** and **SMS** buttons
39. [ ] US SMS: ensure SMS-capable number + **10DLC** brand/campaign when ready

## Portfolio entity shell (Batch 2) — see `SETUP_PORTFOLIO_ENTITIES.md`

40. [ ] Apply migration `0042_portfolio_entity_shell.sql`
41. [ ] Deploy edge function `think-tank-chat`; set `XAI_API_KEY` (+ optional `XAI_MODEL`)
42. [ ] Set `OWNER_OVERSIGHT_EMAIL` (Josh) for silent Think Tank journal oversight emails
43. [ ] Confirm entity tabs (Leadership / Think Tank / Financial / KPIs / Platform) on all portfolio companies
44. [ ] Confirm Instant NDA Platform → `https://instantnda.us/sales/login`
45. [ ] Confirm Recruit 619 Platform SSO; Recruiters/Managers no longer in portfolio nav
46. [ ] Morning digest: apply `0043_morning_digest_prefs.sql`; deploy `process-morning-digest`; set `DIGEST_CRON_SECRET` (see `SETUP_MORNING_DIGEST.md`)
47. [ ] Schedule cron POST to `process-morning-digest` every **15 min** (`x-digest-secret`) — timezone-aware 6:00 AM Today briefing
48. [ ] **Do not prod-deploy until Josh says “Deploy Batch 2”**
