# Josh setup checklist — Tage VC deal sourcing + content

## Core sales / deal flow

1. [ ] Create Supabase project `tagevc-sales`
2. [ ] Run `supabase/migrations/0001_sales_platform.sql` in SQL Editor
3. [ ] Run `supabase/migrations/0002_content_social.sql` (blog + social + SEO seeds)
4. [ ] Run `supabase/migrations/0003_blog_public_read.sql` (anon read published posts → website)
5. [ ] Run `supabase/migrations/0004_entity_ops.sql` (Entity Ops tables + checklist seeds)
6. [ ] Create private Storage bucket `entity-docs` + storage RLS policies (see top of `0004_entity_ops.sql`)
7. [ ] Create Auth user `josh@tagevc.com` (password or magic link)
8. [ ] Confirm `sales_users` has Josh as admin
9. [ ] Copy URL + anon key into `tagevc-sales/.env.local` and `tagevc-website/.env.local`
10. [ ] Deploy edge functions: `intake-lead`, `process-drips`, `update-lead`, `generate-content`, `process-scheduled-content`
11. [ ] Set secrets: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `INTAKE_ALERT_EMAIL`, `SALES_PORTAL_URL`, `DRIP_CRON_SECRET`, `CONTENT_CRON_SECRET`
12. [ ] Optional: `OPENAI_API_KEY` (+ `OPENAI_MODEL`) for AI content generation
13. [ ] Schedule cron POST to `process-drips` every 30 min (`x-drip-secret`)
14. [ ] Schedule cron POST to `process-scheduled-content` every 15–30 min (`x-content-secret`)
15. [ ] `npm run dev` in sales → sign in → add a test deal in Deal flow
16. [ ] Open **Entity Ops** → create entity from start/acquire template → check off items; add compliance
17. [ ] Test intake with curl (see README)
18. [ ] Deploy sales portal to Vercel + set Vite env vars
19. [ ] Ensure GitHub remotes for `tagevc-sales` and `tagevc-website` are **private**

## Content & Social

20. [ ] Confirm 5 seeded blog posts appear under Content → Blog
21. [ ] Publish / schedule a social draft; use Approvals tab if submitting for approval
22. [ ] Click **Run scheduler** once to verify mock publish path
23. [ ] Phase 2 (later): LinkedIn / X / Meta OAuth secrets for live publish

## Public website (`tagevc-website`)

24. [ ] `cd ../tagevc-website && cp .env.example .env.local` (same Supabase URL + anon key)
25. [ ] `npm install && npm run dev` → home, Launch/Partner/Exit, `/blog`, contact form
26. [ ] Confirm blog list loads from Supabase (or seed markdown fallback)
27. [ ] Submit contact form → deal appears in Deal flow + Josh alert email
28. [ ] Deploy website to Vercel; set `NEXT_PUBLIC_SUPABASE_*` + intake URL/key
29. [ ] Point `tageventurecapital.com` (eventual) at website; add origin to intake CORS if needed