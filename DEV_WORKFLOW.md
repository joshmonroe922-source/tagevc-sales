# Dev workflow — Tage portal (tagevc-sales)

Local-first development. **Deploy only when Josh says "Deploy"** — do not auto-deploy on every small change.

| Environment | URL | How it updates |
|-------------|-----|----------------|
| **Local** | http://localhost:5173 | `npm run dev` |
| **Staging / preview** | Vercel preview URL (per branch or `deploy:preview`) | Push `staging` branch or `npm run deploy:preview` |
| **Production** | https://portal.tagevc.com | `npm run deploy` (only when Josh says "Deploy") |

GitHub: `joshmonroe922-source/tagevc-sales` · Vercel project: **tagevc-sales** (team **instant-nda**).

---

## Morning startup (local sandbox)

```bash
export PATH="/Users/joshmonroe/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/joshmonroe/Projects/tagevc-sales
cp .env.example .env.local   # first time only
# fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
npm install
npm run dev
```

Open http://localhost:5173/sales after sign-in.

**Day-to-day:** fix and verify on localhost. Deploy only when Josh explicitly says "Deploy".

---

## Environment files

| File | Purpose |
|------|---------|
| `.env.example` | Template — safe to commit |
| `.env.local` | Local Vite env (gitignored) |

Production env vars: **Vercel → tagevc-sales → Settings → Environment Variables**.

Supabase edge-function secrets: **Supabase dashboard → Project Settings → Edge Functions**.

---

## Staging on Vercel (branch previews)

Preferred pattern:

1. **Vercel dashboard** → **tagevc-sales** → **Settings** → **Git** — confirm GitHub repo is connected.
2. Ensure **Preview Deployments** are enabled (default when Git is connected).
3. Create and push a long-lived staging branch:

```bash
git checkout -b staging
git push -u origin staging
```

4. Vercel builds each push to `staging` and assigns a preview URL (e.g. `tagevc-sales-git-staging-instant-nda.vercel.app`). Optionally add a custom preview domain in Vercel.

**Manual preview** (CLI, no Git push):

```bash
npm run deploy:preview
```

---

## Supabase migrations (before deploy)

When a batch includes new SQL migrations under `supabase/migrations/`:

1. Open Supabase **SQL Editor** for project `hqmobgtnedmhzipusert`.
2. Run new migration files in numeric order (only files not yet applied).
3. Deploy affected edge functions if the batch touches `supabase/functions/`:

```bash
supabase functions deploy <function-name> --project-ref hqmobgtnedmhzipusert
```

See `SETUP_CALENDAR.md`, `SETUP_EMAIL.md`, etc. for function-specific deploy lists.

**Order:** migrations → edge functions → frontend `npm run deploy`.

### CRM full-text search (0047 + OS 0013) — review before apply

Do **not** `supabase db push` these until Josh reviews the SQL.

1. **Sales CRM** (`sales_contacts` / `sales_accounts` / `sales_leads` / `portal_tickets`):
   - Transactional: `supabase/migrations/0047_sales_crm_full_text_search.sql`
   - Optional zero-downtime GIN: `supabase/scripts/0047_sales_crm_search_indexes_concurrent.sql`
     (`CREATE INDEX CONCURRENTLY` — run each statement alone; cannot live in a txn)
2. **OS graph CRM** (`accounts` / `contacts` / `recruit_job_reqs`):
   - Transactional: `tagevc-os/supabase/migrations/spine/0013_crm_full_text_search.sql`
   - Concurrent companion: `tagevc-os/supabase/phase109_crm_full_text_search_indexes_concurrent.sql`

If you already applied GIN inside the transactional file, skip the matching concurrent statements.

---

## Deploy commands

| Command | Target | When |
|---------|--------|------|
| `npm run dev` | localhost | Always — primary dev loop |
| `npm run typecheck` | local | Before any deploy |
| `npm run build` | local dist/ | Optional local build check |
| `npm run deploy:preview` | Vercel preview | Staging verification |
| `npm run deploy` | **Production** | Only when Josh says **"Deploy Batch N"** |

### Before any deploy

1. Test on localhost.
2. Apply new Supabase migrations (if any).
3. Commit changes on the branch you intend to ship.
4. If a stale lock exists:

```bash
rmdir ".vercel/deploy.lock" 2>/dev/null || true
```

### Production deploy

```bash
git status   # commit or stash first
npm run deploy
```

Runs `tsc -b`, acquires `.vercel/deploy.lock`, then `vercel --prod`.

Alternative (equivalent after typecheck): `npx vercel --prod` — prefer `npm run deploy` for the lock.

---

## Agent rules

- **Never** run `npm run deploy`, `vercel --prod`, or `supabase db push` to production without Josh explicitly approving a batch.
- **Never** push to `main` without approval.
- Local edits, commits on feature branches, and localhost testing are fine.
- Use preview/staging for Vercel-only verification (env inlining, routing).

---

## Related docs

- `README.md` — portals, Supabase setup, feature map
- `SETUP_CHECKLIST.md` — go-live checklist
- `.env.example` — frontend env vars
