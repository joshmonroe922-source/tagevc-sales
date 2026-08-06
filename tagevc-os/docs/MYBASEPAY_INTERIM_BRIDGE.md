# MyBasePay interim admin bridge (Recruit 619)

**Status (2026-08-06):** Backoffice session mapped · company profile **Recruit 619** · interim auth = `POST /account-service/user/login` → JWT · workers = `GET /backoffice/workers/paged` · create = `POST /backoffice/workers` (gated) · `MYBASEPAY_LIVE=0` + `MYBASEPAY_ALLOW_CREATE=0` · **no contractor creates** until Josh approves. Official public API expected **October** — same `partner=mybasepay` + `ENT-R619` binding.

**Related:** `docs/PARTNER_SPINE.md` · burden seed `supabase/migrations/spine/0012_mbp_burden_seed.sql` · Gusto contrast: `docs/GUSTO_MULTI_ENTITY.md`.

## Intent

Temporary 2-way-ish sync until October API:

1. Auto-login to `https://backoffice.mybasepay.com`
2. Create contractors (workers) from Recruit 619 placements
3. Pull workers / assignments / timesheet status into Tage spine signals

Replace with official API behind the **same** partner key + entity binding. Fail-closed; keep `MYBASEPAY_LIVE=0` until login smoke + dry capability check.

## Confirmed model (R619-only · admin session · October API swap)

| Layer | Choice | Why |
|-------|--------|-----|
| Scope | **ENT-R619 only** until other entities opt in | Catalog `implementNow: ['ENT-R619']`; SQL disables other bindings |
| Auth (interim) | Admin email + password + `applicationType: 2` (Backoffice) → `api.mybasepay.com/account-service/user/login` → JWT (`jwt-token` in SPA) | Omit `applicationType` → opaque 500; MFA via `authCode` / `login-two-factor-auth` — ping if required |
| Auth (October) | Official API key / OAuth behind same resolve | Swap `connectionMode` to `api` without rebinding entity |
| Binding | `os_partner_entity_bindings` `partner_key='mybasepay'` · `external_account_id` = company label | Non-secret; profile shows **Recruit 619** |
| Live gate | `MYBASEPAY_LIVE=0` until write/sync proven | Create-worker + sync stay dry-run / fail-closed |
| Timesheets | Remain SoR in MyBasePay | Spine pulls status signals; does not become payroll SoR |

## Backoffice UI map (login smoke 2026-08-06)

| Surface | Path | Notes |
|---------|------|-------|
| Login | `/login` | Email + password; no MFA/CAPTCHA observed on smoke |
| Dashboard | `/?section=summary` | Customers, active assignments, timesheet %, ending soon |
| Customers | `/customers?section=approved` | Placement customers |
| Assignments | `/assignments?section=all` | My / Drafts / Templates / Partner assignments |
| Workers | `/workers?section=workers` | Empty on smoke; **Create new worker** modal |
| Contractor companies | Workers submenu | Separate from individual workers |
| Partners | `/partners` | Partner directory |
| Company profile | `/company-profile?section=primary` | Business name **Recruit 619**; member email (admin) |

### Create worker fields (modal)

Required: first name, last name, email, phone, worker type (`W2` · `IC` · `International IC` · `SC`), country, state, city, address, ZIP.

Do **not** submit this modal from automation until Josh approves a safe test contractor.

### Interim API paths (authenticated backoffice API)

| Method | Path | Use |
|--------|------|-----|
| POST | `/account-service/user/login` | `{ email, password, applicationType: 2 }` → `{ token, expireDate, authCode }` |
| POST | `/account-service/user/login-two-factor-auth` | MFA (NEED_HUMAN if required) |
| POST | `/account-service/user/token/refresh` | Refresh JWT |
| GET | `/backoffice/workers/paged?pageNumber=0` | Read-only list (smoke) |
| POST | `/backoffice/workers` | `createNewWorker` (gated by LIVE + ALLOW_CREATE) |
| GET | `/backoffice/account/full-profile` | Company profile |

API host default: `https://api.mybasepay.com` (`MYBASEPAY_API_BASE`).

## Env / vault (never commit values)

| Key | Purpose |
|-----|---------|
| `MYBASEPAY_ADMIN_EMAIL` | Interim backoffice login |
| `MYBASEPAY_ADMIN_PASSWORD` | Interim backoffice login |
| `MYBASEPAY_BASE_URL` | Backoffice UI — default `https://backoffice.mybasepay.com` |
| `MYBASEPAY_API_BASE` | API host — default `https://api.mybasepay.com` |
| `MYBASEPAY_EXTERNAL_ACCOUNT_ID` | Non-secret company label bootstrap (`Recruit 619`) |
| `MYBASEPAY_LIVE` | Fail-closed gate — keep `0` |
| `MYBASEPAY_ALLOW_CREATE` | Second gate — refuse creates even if LIVE=1 |
| `MYBASEPAY_API_KEY` | Reserved for October official API |
| `MYBASEPAY_WEBHOOK_SECRET` | Future webhook verify |

Store via Vercel encrypted env (prod / preview / development). Never put secrets in `os_partner_entity_bindings.config` or docs.

### Connect path (Josh / agent)

```bash
# From tagevc-os (linked Vercel project) — values from vault only
printf '%s' "$MYBASEPAY_ADMIN_EMAIL" | vercel env add MYBASEPAY_ADMIN_EMAIL production
printf '%s' "$MYBASEPAY_ADMIN_PASSWORD" | vercel env add MYBASEPAY_ADMIN_PASSWORD production
printf '%s' 'https://backoffice.mybasepay.com' | vercel env add MYBASEPAY_BASE_URL production
printf '%s' 'https://api.mybasepay.com' | vercel env add MYBASEPAY_API_BASE production
printf '%s' 'Recruit 619' | vercel env add MYBASEPAY_EXTERNAL_ACCOUNT_ID production
printf '0' | vercel env add MYBASEPAY_LIVE production
printf '0' | vercel env add MYBASEPAY_ALLOW_CREATE production
# Repeat for preview + development as needed
```

Login smoke (reads env; prints masked status only):

```bash
set -a && source .env.local && set +a
node scripts/mybasepay-login-smoke.mjs
```

## Code map

| Piece | Path |
|-------|------|
| Catalog | `src/lib/partners/catalog.ts` (`mybasepay`) |
| Resolve | `src/lib/partners/mybasepay-entity.ts` |
| Admin bridge | `src/lib/partners/mybasepay-admin-bridge.ts` |
| Admin session | `src/lib/partners/mybasepay-admin.ts` — login / list / gated create |
| Adapters | `src/lib/partners/adapters.ts` — create/sync dry-run; LIVE fails closed |
| Binding hook | `ensure_mybasepay_account_binding` |
| Tests | `src/lib/partners/mybasepay-entity.test.ts` |
| Smoke | `scripts/mybasepay-login-smoke.mjs` |
| Bind SQL | `scripts/mybasepay-bind-r619.sql` |

## Binding shape (non-secret)

```json
{
  "company_label": "Recruit 619",
  "connection": "admin_bridge",
  "base_url": "https://backoffice.mybasepay.com",
  "role": "eor_r619",
  "interim_until": "2026-10"
}
```

- `external_account_id` → `Recruit 619` until vendor exposes a stable numeric/UUID account id.

## LIVE flip checklist

1. Login smoke green (`scripts/mybasepay-login-smoke.mjs`)
2. Entity resolve ready for `ENT-R619`
3. Safe test worker plan approved by Josh (or October API available)
4. Write path implemented + tested on a disposable contractor
5. Only then `MYBASEPAY_LIVE=1`

## NEED_HUMAN / ping conditions

- MFA or CAPTCHA appears on login
- Password rotation / lockout
- October API credentials + docs land (swap connection mode)
- Approval to create a real test contractor
